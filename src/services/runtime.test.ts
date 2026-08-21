import { expect } from 'chai';
import { FreyaRuntime, type RuntimePort } from './runtime';

describe('FreyaRuntime', () => {
    it('publishes only safe, adapter-owned runtime status', async () => {
        const writes: Array<[string, ioBroker.StateValue]> = [];
        const warnings: string[] = [];
        const port: RuntimePort = {
            setState: (id, value) => {
                writes.push([id, value]);
                return Promise.resolve();
            },
            warn: message => warnings.push(message),
        };
        const runtime = new FreyaRuntime(port, {
            autonomyLevel: 0,
            learningEnabled: false,
            historyInstance: 'none',
            discoveryEnabled: true,
            discoveryMaxStates: 20_000,
            statePolicies: [],
            environmentMappings: [],
            minimumActionConfidence: 0.7,
            actionCooldownSeconds: 300,
            blockedStateIds: [],
            llmProvider: 'rules',
            llmModel: '',
            llmBaseUrl: 'http://127.0.0.1:11434',
            llmApiKey: '',
            llmTimeoutSeconds: 20,
            feedbackWindowSeconds: 120,
            unsafeConfigurationIgnored: false,
        });

        await runtime.start();

        expect(writes).to.deep.include.members([
            ['info.autonomyLevel', 0],
            ['learning.enabled', false],
            ['info.status', 'observe-only'],
            ['info.connection', true],
        ]);
        expect(writes.every(([id]) => !id.includes('.0.') && !id.startsWith('system.'))).to.equal(true);
        expect(warnings).to.be.empty;

        await runtime.stop();
        expect(writes.slice(-2)).to.deep.equal([
            ['info.status', 'stopped'],
            ['info.connection', false],
        ]);
    });

    it('is idempotent when started or stopped repeatedly', async () => {
        const writes: Array<[string, ioBroker.StateValue]> = [];
        const runtime = new FreyaRuntime(
            {
                setState: (id, value) => {
                    writes.push([id, value]);
                    return Promise.resolve();
                },
                warn: () => undefined,
            },
            {
                autonomyLevel: 0,
                learningEnabled: false,
                historyInstance: 'none',
                discoveryEnabled: true,
                discoveryMaxStates: 20_000,
                statePolicies: [],
                environmentMappings: [],
                minimumActionConfidence: 0.7,
                actionCooldownSeconds: 300,
                blockedStateIds: [],
                llmProvider: 'rules',
                llmModel: '',
                llmBaseUrl: 'http://127.0.0.1:11434',
                llmApiKey: '',
                llmTimeoutSeconds: 20,
                feedbackWindowSeconds: 120,
                unsafeConfigurationIgnored: false,
            },
        );

        await runtime.start();
        await runtime.start();
        await runtime.stop();
        await runtime.stop();

        expect(writes).to.have.length(29);
    });

    it('publishes the distinct individual-approval runtime mode', async () => {
        const writes: Array<[string, ioBroker.StateValue]> = [];
        await new FreyaRuntime(
            {
                setState: (id, value) => {
                    writes.push([id, value]);
                    return Promise.resolve();
                },
                warn: () => undefined,
            },
            {
                autonomyLevel: 2,
                learningEnabled: true,
                historyInstance: 'none',
                discoveryEnabled: true,
                discoveryMaxStates: 20_000,
                statePolicies: [],
                environmentMappings: [],
                minimumActionConfidence: 0.7,
                actionCooldownSeconds: 300,
                blockedStateIds: [],
                llmProvider: 'rules',
                llmModel: '',
                llmBaseUrl: 'http://127.0.0.1:11434',
                llmApiKey: '',
                llmTimeoutSeconds: 20,
                feedbackWindowSeconds: 120,
                unsafeConfigurationIgnored: false,
            },
        ).start();
        expect(writes).to.deep.include.members([
            ['learning.enabled', true],
            ['info.status', 'individual-approval'],
        ]);
    });
});
