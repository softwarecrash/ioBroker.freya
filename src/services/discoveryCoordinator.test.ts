import { expect } from 'chai';
import { DiscoveryService, type DiscoverySource } from '../discovery/discoveryService';
import { DiscoveryCoordinator } from './discoveryCoordinator';

describe('DiscoveryCoordinator', () => {
    it('publishes aggregates only after a successful metadata scan', async () => {
        const source: DiscoverySource = {
            load: () =>
                Promise.resolve({
                    descriptors: [],
                    totalAvailable: 0,
                    truncated: false,
                }),
        };
        const writes: Array<[string, ioBroker.StateValue]> = [];
        const info: string[] = [];
        const coordinator = new DiscoveryCoordinator(
            new DiscoveryService(source, { maxStates: 100, policies: [], environmentMappings: [] }),
            {
                setState: (id, value) => {
                    writes.push([id, value]);
                    return Promise.resolve();
                },
                info: message => info.push(message),
                warn: () => undefined,
            },
        );

        await coordinator.run();

        expect(writes[0]).to.deep.equal(['discovery.status', 'scanning']);
        expect(writes.slice(-1)[0]).to.deep.equal(['discovery.status', 'completed']);
        expect(
            writes.map(([id]) => id).every(id => id.startsWith('discovery.') || id.startsWith('permissions.')),
        ).to.equal(true);
        expect(info[0]).to.include('Completed metadata scan');
    });

    it('reports an error and propagates the discovery failure', async () => {
        const source: DiscoverySource = {
            load: () => Promise.reject(new Error('fixture failure')),
        };
        const writes: Array<[string, ioBroker.StateValue]> = [];
        const warnings: string[] = [];
        const coordinator = new DiscoveryCoordinator(
            new DiscoveryService(source, { maxStates: 100, policies: [], environmentMappings: [] }),
            {
                setState: (id, value) => {
                    writes.push([id, value]);
                    return Promise.resolve();
                },
                info: () => undefined,
                warn: message => warnings.push(message),
            },
        );

        let failure: Error | undefined;
        try {
            await coordinator.run();
        } catch (error) {
            failure = error as Error;
        }

        expect(failure?.message).to.equal('fixture failure');
        expect(writes.slice(-1)[0]).to.deep.equal(['discovery.status', 'error']);
        expect(warnings[0]).to.include('fixture failure');
    });
});
