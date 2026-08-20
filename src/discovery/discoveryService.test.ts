import { expect } from 'chai';
import { DiscoveryService, type DiscoverySource } from './discoveryService';
import type { StateDescriptor } from './types';

const descriptors: StateDescriptor[] = [
    {
        id: 'fixture.0.light.state',
        name: 'Room light',
        role: 'switch.light',
        valueType: 'boolean',
        read: true,
        write: true,
        rooms: ['Room'],
        functions: ['Lighting'],
        ancestorNames: [],
        nativeHints: [],
    },
    {
        id: 'fixture.0.generic.state',
        name: 'Generic value',
        role: 'value',
        valueType: 'number',
        read: true,
        write: false,
        rooms: [],
        functions: [],
        ancestorNames: [],
        nativeHints: [],
    },
];

describe('DiscoveryService', () => {
    it('builds aggregate counts and bounded pages', async () => {
        const source: DiscoverySource = {
            load: () => Promise.resolve({ descriptors, totalAvailable: 3, truncated: true }),
        };
        const service = new DiscoveryService(source, { maxStates: 2, policies: [], environmentMappings: [] });
        const result = await service.run();

        expect(result.summary).to.include({
            totalAvailable: 3,
            scanned: 2,
            classified: 1,
            unknown: 1,
            truncated: true,
        });
        expect(service.page(0, 1).items).to.have.length(1);
        expect(service.page(0, 1, 'generic').items[0].semanticType).to.equal('unknown');
        expect(service.page(0, 1000).pageSize).to.equal(100);
    });
});
