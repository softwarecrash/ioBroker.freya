import { expect } from 'chai';
import { IoBrokerCoordinateSource } from './ioBrokerCoordinateSource';

describe('IoBrokerCoordinateSource', () => {
    it('uses a complete valid manual override without querying ioBroker', async () => {
        let queried = false;
        const adapter = {
            getForeignObjectAsync: () => {
                queried = true;
                return Promise.resolve(null);
            },
        } as unknown as ioBroker.Adapter;

        expect(await new IoBrokerCoordinateSource(adapter, 40, -74).resolve()).to.deep.equal({
            latitude: 40,
            longitude: -74,
            sourceId: 'manual',
        });
        expect(queried).to.equal(false);
    });

    it('falls back to configured ioBroker system coordinates', async () => {
        const adapter = {
            getForeignObjectAsync: () => Promise.resolve({ common: { latitude: 48, longitude: 11 }, type: 'config' }),
        } as unknown as ioBroker.Adapter;

        expect(await new IoBrokerCoordinateSource(adapter).resolve()).to.deep.equal({
            latitude: 48,
            longitude: 11,
            sourceId: 'system',
        });
    });
});
