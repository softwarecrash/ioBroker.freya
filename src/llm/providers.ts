import { LLM_ANALYSIS_SCHEMA, analysisPrompt, parseLlmAnalysis } from './contract';
import type { JsonHttpTransport } from './httpTransport';
import type { LlmAnalysis, LlmPatternDisclosure, LlmProvider, LlmProviderKind } from './types';

function object(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function endpoint(base: string, path: string, localOnly: boolean): string {
    let url: URL;
    try {
        url = new URL(base);
    } catch {
        throw new Error('llm_endpoint_invalid');
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('llm_endpoint_invalid');
    }
    if (localOnly && !loopback) {
        throw new Error('llm_endpoint_not_local');
    }
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
        throw new Error('llm_endpoint_invalid');
    }
    url.pathname = `${url.pathname.replace(/\/$/, '')}${path}`;
    return url.toString();
}

export class DisabledLlmProvider implements LlmProvider {
    public readonly kind = 'disabled';
    public readonly external = false;

    public analyze(): Promise<LlmAnalysis> {
        return Promise.reject(new Error('llm_disabled'));
    }
}

export class RulesOnlyLlmProvider implements LlmProvider {
    public readonly kind = 'rules';
    public readonly external = false;

    public analyze(disclosure: LlmPatternDisclosure): Promise<LlmAnalysis> {
        const pattern = disclosure.pattern;
        const percent = Math.round(pattern.confidence * 100);
        return Promise.resolve({
            summary: `The pattern matched ${pattern.matches} of ${pattern.opportunities} opportunities with ${percent}% confidence and ${pattern.conditionCount} selected context conditions.`,
            riskLevel: pattern.confidence >= 0.8 ? 'low' : pattern.confidence >= 0.65 ? 'medium' : 'high',
            concerns: pattern.opportunities < 20 ? ['Evidence is still limited.'] : [],
        });
    }
}

abstract class RemoteLlmProvider implements LlmProvider {
    public abstract readonly kind: LlmProviderKind;
    public abstract readonly external: boolean;

    public constructor(
        protected readonly transport: JsonHttpTransport,
        protected readonly model: string,
        protected readonly timeoutMs: number,
    ) {
        if (!model) {
            throw new Error('llm_model_missing');
        }
    }

    public abstract analyze(disclosure: LlmPatternDisclosure, signal?: AbortSignal): Promise<LlmAnalysis>;
}

export class OllamaLlmProvider extends RemoteLlmProvider {
    public readonly kind = 'ollama';
    public readonly external = false;
    private readonly url: string;

    public constructor(transport: JsonHttpTransport, baseUrl: string, model: string, timeoutMs: number) {
        super(transport, model, timeoutMs);
        this.url = endpoint(baseUrl, '/api/generate', true);
    }

    public async analyze(disclosure: LlmPatternDisclosure, signal?: AbortSignal): Promise<LlmAnalysis> {
        const response = object(
            await this.transport.post(
                this.url,
                {
                    model: this.model,
                    prompt: analysisPrompt(disclosure),
                    stream: false,
                    format: LLM_ANALYSIS_SCHEMA,
                    options: { temperature: 0 },
                },
                {},
                this.timeoutMs,
                signal,
            ),
        );
        return parseLlmAnalysis(response?.response);
    }
}

export class OpenAiLlmProvider extends RemoteLlmProvider {
    public readonly kind = 'openai';
    public readonly external = true;

    public constructor(
        transport: JsonHttpTransport,
        model: string,
        timeoutMs: number,
        private readonly apiKey: string,
    ) {
        super(transport, model, timeoutMs);
    }

    public async analyze(disclosure: LlmPatternDisclosure, signal?: AbortSignal): Promise<LlmAnalysis> {
        if (!this.apiKey) {
            throw new Error('llm_api_key_missing');
        }
        const response = object(
            await this.transport.post(
                'https://api.openai.com/v1/responses',
                {
                    model: this.model,
                    store: false,
                    input: analysisPrompt(disclosure),
                    text: {
                        format: {
                            type: 'json_schema',
                            name: 'smartbrain_pattern_analysis',
                            strict: true,
                            schema: LLM_ANALYSIS_SCHEMA,
                        },
                    },
                },
                { authorization: `Bearer ${this.apiKey}` },
                this.timeoutMs,
                signal,
            ),
        );
        const output = Array.isArray(response?.output) ? response.output : [];
        const message = output.map(object).find(item => item?.type === 'message');
        const content = Array.isArray(message?.content) ? message.content : [];
        const outputText = content.map(object).find(item => item?.type === 'output_text');
        return parseLlmAnalysis(outputText?.text);
    }
}

export class OpenAiCompatibleLlmProvider extends RemoteLlmProvider {
    public readonly kind = 'openai-compatible';
    public readonly external: boolean;
    private readonly url: string;

    public constructor(
        transport: JsonHttpTransport,
        baseUrl: string,
        model: string,
        timeoutMs: number,
        private readonly apiKey: string,
    ) {
        super(transport, model, timeoutMs);
        this.url = endpoint(baseUrl, '/v1/chat/completions', false);
        this.external = !['localhost', '127.0.0.1', '[::1]'].includes(new URL(this.url).hostname);
    }

    public async analyze(disclosure: LlmPatternDisclosure, signal?: AbortSignal): Promise<LlmAnalysis> {
        const headers: Record<string, string> = this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
        const response = object(
            await this.transport.post(
                this.url,
                {
                    model: this.model,
                    messages: [{ role: 'user', content: analysisPrompt(disclosure) }],
                    temperature: 0,
                    response_format: {
                        type: 'json_schema',
                        json_schema: { name: 'smartbrain_pattern_analysis', strict: true, schema: LLM_ANALYSIS_SCHEMA },
                    },
                },
                headers,
                this.timeoutMs,
                signal,
            ),
        );
        const choices = Array.isArray(response?.choices) ? response.choices : [];
        const first = object(choices[0]);
        const message = object(first?.message);
        return parseLlmAnalysis(message?.content);
    }
}
