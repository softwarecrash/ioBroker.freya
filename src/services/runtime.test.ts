import { expect } from 'chai';
import { SmartBrainRuntime, type RuntimePort } from './runtime';

describe('SmartBrainRuntime', () => {
    it('publishes only safe, adapter-owned Phase 1 status', async () => {
        const writes: Array<[string, ioBroker.StateValue]> = [];
        const warnings: string[] = [];
        const port: RuntimePort = {
            setState: (id, value) => {
                writes.push([id, value]);
                return Promise.resolve();
            },
            warn: message => warnings.push(message),
        };
        const runtime = new SmartBrainRuntime(port, {
            autonomyLevel: 0,
            learningEnabled: false,
            historyInstance: 'none',
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
        const runtime = new SmartBrainRuntime(
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
                unsafeConfigurationIgnored: false,
            },
        );

        await runtime.start();
        await runtime.start();
        await runtime.stop();
        await runtime.stop();

        expect(writes).to.have.length(10);
    });
});
