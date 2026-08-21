import { expect } from 'chai';
import { IoBrokerDiscoverySource } from './ioBrokerDiscoverySource';

describe('IoBrokerDiscoverySource', () => {
    it('normalizes metadata, enum assignments and ancestors without reading values', async () => {
        const requests: Array<{ pattern: unknown; type?: string }> = [];
        const stateObjects = {
            'alias.0.Kitchen.light.ceiling.power': {
                _id: 'alias.0.Kitchen.light.ceiling.power',
                type: 'state',
                common: { name: 'Power', type: 'boolean', role: 'switch.light', read: true, write: true },
                native: {},
            },
            'fixture.0.device.temperature': {
                _id: 'fixture.0.device.temperature',
                type: 'state',
                common: {
                    name: 'Temperature',
                    type: 'number',
                    role: 'value.temperature',
                    unit: '°C',
                    read: true,
                    write: false,
                },
                native: { deviceType: 'climate', secret: 'must-not-be-copied' },
            },
            'smartbrain.0.info.status': {
                _id: 'smartbrain.0.info.status',
                type: 'state',
                common: { name: 'Own status', type: 'string', read: true, write: false },
                native: {},
            },
        } as unknown as Record<string, ioBroker.StateObject>;
        const ancestorObjects = {
            'alias.0.Kitchen': {
                _id: 'alias.0.Kitchen',
                type: 'folder',
                common: { name: 'Kitchen' },
                native: {},
            },
            'fixture.0.device': {
                _id: 'fixture.0.device',
                type: 'device',
                common: { name: { en: 'Garden sensor' } },
                native: {},
            },
        } as unknown as Record<string, ioBroker.Object>;
        const enumGroups = {
            rooms: {
                'enum.rooms.kitchen': {
                    _id: 'enum.rooms.kitchen',
                    type: 'enum',
                    common: { name: 'Kitchen', members: ['alias.0.Kitchen'] },
                    native: {},
                },
                'enum.rooms.garden': {
                    _id: 'enum.rooms.garden',
                    type: 'enum',
                    common: { name: 'Garden', members: ['fixture.0.device'] },
                    native: {},
                },
            },
            functions: {
                'enum.functions.climate': {
                    _id: 'enum.functions.climate',
                    type: 'enum',
                    common: { name: 'Climate', members: ['fixture.0.device.temperature'] },
                    native: {},
                },
            },
        } as unknown as Record<string, Record<string, ioBroker.EnumObject>>;
        const adapter = {
            namespace: 'smartbrain.0',
            getForeignObjectsAsync: (pattern: string | string[], type?: string) => {
                requests.push({ pattern, type });
                return Promise.resolve(Array.isArray(pattern) ? ancestorObjects : stateObjects);
            },
            getEnumsAsync: (groups: string[]) => {
                expect(groups).to.deep.equal(['rooms', 'functions']);
                return Promise.resolve(enumGroups);
            },
        } as unknown as ioBroker.Adapter;

        const result = await new IoBrokerDiscoverySource(adapter).load(100);

        expect(requests[0]).to.deep.equal({ pattern: '*', type: 'state' });
        expect(requests[1].pattern).to.be.an('array').that.includes('alias.0.Kitchen');
        expect(result).to.include({ totalAvailable: 2, truncated: false });
        expect(result.descriptors.find(item => item.id === 'fixture.0.device.temperature')).to.deep.include({
            id: 'fixture.0.device.temperature',
            name: 'Temperature',
            role: 'value.temperature',
            unit: '°C',
            rooms: ['Garden'],
            functions: ['Climate'],
            ancestorNames: ['Garden sensor'],
            nativeHints: ['climate'],
        });
        expect(result.descriptors.find(item => item.id === 'alias.0.Kitchen.light.ceiling.power')).to.deep.include({
            rooms: ['Kitchen'],
        });
    });

    it('does not request ancestors for an empty bounded state result', async () => {
        let ancestorRequest = false;
        const adapter = {
            namespace: 'smartbrain.0',
            getForeignObjectsAsync: (pattern: string | string[]) => {
                if (Array.isArray(pattern)) {
                    ancestorRequest = true;
                }
                return Promise.resolve({});
            },
            getEnumsAsync: () => Promise.resolve({}),
        } as unknown as ioBroker.Adapter;

        const result = await new IoBrokerDiscoverySource(adapter).load(100);

        expect(ancestorRequest).to.equal(false);
        expect(result).to.deep.equal({ descriptors: [], totalAvailable: 0, truncated: false });
    });
});
