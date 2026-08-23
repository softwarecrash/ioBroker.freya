import { expect } from 'chai';
import type { PatternSuggestion } from '../suggestions/types';
import { parseLlmAnalysis } from './contract';
import { buildPatternDisclosure, disclosurePreview } from './disclosure';
import { boundedJson, type JsonHttpTransport } from './httpTransport';
import { LlmService } from './llmService';
import {
    DisabledLlmProvider,
    OllamaLlmProvider,
    OpenAiCompatibleLlmProvider,
    OpenAiLlmProvider,
    RulesOnlyLlmProvider,
} from './providers';

function suggestion(): PatternSuggestion {
    return {
        id: '0123456789abcdef',
        patternId: '0123456789abcdef',
        status: 'approved',
        eligible: true,
        triggerStateId: 'private.trigger.id',
        actionStateId: 'private.action.id',
        expectedAction: true,
        rooms: ['Private Room Name'],
        conditions: [{ feature: 'sun.sunsetOffset', value: -15 }],
        opportunities: 30,
        matches: 27,
        confidence: 0.9,
        confidenceComponents: {
            smoothedMatchRate: 0.9,
            sampleMaturity: 1,
            repeatability: 1,
            recency: 1,
            feedbackAdjustment: 0,
        },
        actionWindowMs: 120_000,
        explanation: 'private explanation',
        createdAt: 1,
        updatedAt: 2,
    };
}

class RecordingTransport implements JsonHttpTransport {
    public calls: Array<{ url: string; body: unknown; headers: Record<string, string>; timeoutMs: number }> = [];

    public constructor(private readonly response: unknown) {}

    public post(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
        this.calls.push({ url, body, headers, timeoutMs });
        return Promise.resolve(this.response);
    }
}

describe('LLM advisory boundary', () => {
    const disclosure = buildPatternDisclosure(suggestion(), 'request-1');
    const analysis = { summary: 'A bounded explanation.', riskLevel: 'low', concerns: [] };

    it('discloses only allow-listed aggregate pattern data', () => {
        const serialized = JSON.stringify(disclosure);
        expect(serialized).not.to.contain('private.trigger.id');
        expect(serialized).not.to.contain('private.action.id');
        expect(serialized).not.to.contain('Private Room Name');
        expect(serialized).not.to.contain('private explanation');
        expect(disclosurePreview('openai', disclosure, true, 'https://api.openai.com')).to.include({
            external: true,
            endpointOrigin: 'https://api.openai.com',
        });
    });

    it('strictly rejects executable or malformed response fields', () => {
        expect(() => parseLlmAnalysis({ ...analysis, targetStateId: 'state.0.target', value: true })).to.throw(
            'llm_response_schema_invalid',
        );
        expect(() => parseLlmAnalysis({ ...analysis, concerns: 'none' })).to.throw('llm_response_schema_invalid');
        expect(() => parseLlmAnalysis('{private remote text')).to.throw('llm_response_json_invalid');
        const parsed = parseLlmAnalysis(analysis);
        expect(parsed).not.to.have.any.keys('targetStateId', 'value', 'execute', 'approved');
    });

    it('bounds transport responses and normalizes invalid JSON', async () => {
        expect(await boundedJson(new Response(JSON.stringify(analysis)))).to.deep.equal(analysis);
        for (const [response, code] of [
            [new Response('failure', { status: 500 }), 'llm_http_500'],
            [new Response('{invalid'), 'llm_response_json_invalid'],
            [new Response('x'.repeat(1_001)), 'llm_response_too_large'],
        ] as const) {
            let actual = '';
            try {
                await boundedJson(response, 1_000);
            } catch (error) {
                actual = (error as Error).message;
            }
            expect(actual).to.equal(code);
        }
    });

    it('keeps Disabled and Rules Only local and deterministic', async () => {
        let disabledError = '';
        try {
            await new DisabledLlmProvider().analyze();
        } catch (error) {
            disabledError = (error as Error).message;
        }
        expect(disabledError).to.equal('llm_disabled');
        const rules = await new RulesOnlyLlmProvider().analyze(disclosure);
        expect(rules).to.include({ riskLevel: 'low' });
        expect(rules.summary).to.contain('27 of 30');
    });

    it('tests a provider connection with a data-free synthetic disclosure', async () => {
        const service = new LlmService(new RulesOnlyLlmProvider());
        expect(await service.testConnection('connection-test')).to.deep.equal({
            ok: true,
            provider: 'rules',
            external: false,
            endpointOrigin: undefined,
        });
    });

    it('uses local-only non-streaming structured Ollama requests', async () => {
        const transport = new RecordingTransport({ response: JSON.stringify(analysis) });
        const result = await new OllamaLlmProvider(transport, 'http://127.0.0.1:11434', 'gemma3', 5_000).analyze(
            disclosure,
        );
        expect(result).to.deep.equal(analysis);
        expect(transport.calls[0]).to.include({ url: 'http://127.0.0.1:11434/api/generate', timeoutMs: 5_000 });
        expect(transport.calls[0].body).to.deep.include({ model: 'gemma3', stream: false });
        expect(() => new OllamaLlmProvider(transport, 'http://192.168.1.2:11434', 'gemma3', 5_000)).to.throw(
            'llm_endpoint_not_local',
        );
    });

    it('uses OpenAI Responses with protected auth, no storage and strict schema', async () => {
        const transport = new RecordingTransport({
            output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(analysis) }] }],
        });
        const result = await new OpenAiLlmProvider(transport, 'configured-model', 4_000, 'test-secret').analyze(
            disclosure,
        );
        expect(result).to.deep.equal(analysis);
        expect(transport.calls[0].url).to.equal('https://api.openai.com/v1/responses');
        expect(transport.calls[0].headers.authorization).to.equal('Bearer test-secret');
        expect(transport.calls[0].body).to.deep.include({ model: 'configured-model', store: false });
    });

    it('supports an HTTPS OpenAI-compatible endpoint and rejects unsafe URLs', async () => {
        const transport = new RecordingTransport({
            choices: [{ message: { content: JSON.stringify(analysis) } }],
        });
        const provider = new OpenAiCompatibleLlmProvider(
            transport,
            'https://llm.example.test/base',
            'configured-model',
            4_000,
            '',
        );
        expect(await provider.analyze(disclosure)).to.deep.equal(analysis);
        expect(transport.calls[0].url).to.equal('https://llm.example.test/base/v1/chat/completions');
        expect(
            () => new OpenAiCompatibleLlmProvider(transport, 'http://llm.example.test', 'model', 4_000, ''),
        ).to.throw('llm_endpoint_invalid');
        expect(
            () => new OpenAiCompatibleLlmProvider(transport, 'https://user:pass@llm.example.test', 'model', 4_000, ''),
        ).to.throw('llm_endpoint_invalid');
    });
});
