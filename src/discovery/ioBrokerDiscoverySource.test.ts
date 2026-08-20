import { expect } from 'chai';
import { IoBrokerDiscoverySource } from './ioBrokerDiscoverySource';

describe('IoBrokerDiscoverySource', () => {
    it('normalizes metadata, enum assignments and ancestors without reading values', async () => {
        let requestedPattern = '';
        const objects = {
            'fixture.0.device': {
                _id: 'fixture.0.device',
                type: 'device',
                common: { name: { en: 'Garden sensor' } },
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
            'enum.rooms.garden': {
                _id: 'enum.rooms.garden',
                type: 'enum',
                common: { name: 'Garden', members: ['fixture.0.device'] },
                native: {},
            },
            'enum.functions.climate': {
                _id: 'enum.functions.climate',
                type: 'enum',
                common: { name: 'Climate', members: ['fixture.0.device.temperature'] },
                native: {},
            },
        } as unknown as Record<string, ioBroker.Object>;
        const adapter = {
            namespace: 'smartbrain.0',
            getForeignObjectsAsync: (pattern: string) => {
                requestedPattern = pattern;
                return Promise.resolve(objects);
            },
        } as unknown as ioBroker.Adapter;

        const result = await new IoBrokerDiscoverySource(adapter).load(100);

        expect(requestedPattern).to.equal('*');
        expect(result).to.include({ totalAvailable: 1, truncated: false });
        expect(result.descriptors[0]).to.deep.include({
            id: 'fixture.0.device.temperature',
            name: 'Temperature',
            role: 'value.temperature',
            unit: '°C',
            rooms: ['Garden'],
            functions: ['Climate'],
            ancestorNames: ['Garden sensor'],
            nativeHints: ['climate'],
        });
    });
});
