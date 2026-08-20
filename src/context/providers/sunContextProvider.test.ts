import { expect } from 'chai';
import { SunContextProvider } from './sunContextProvider';

describe('SunContextProvider', () => {
    const provider = new SunContextProvider({
        resolve: () => Promise.resolve({ latitude: 52.52, longitude: 13.405, sourceId: 'manual' }),
    });

    it('calculates position, rise/set and relative time locally', async () => {
        const timestamp = Date.parse('2026-06-21T10:00:00.000Z');
        const result = await provider.getContext({ timestamp });
        const sun = result.context.sun;

        expect(sun?.phase).to.equal('day');
        expect(sun?.elevation).to.be.greaterThan(50);
        expect(sun?.azimuth).to.be.within(0, 360);
        expect(sun?.sunrise).to.be.lessThan(timestamp);
        expect(sun?.sunset).to.be.greaterThan(timestamp);
        expect(sun?.minutesSinceSunrise).to.be.greaterThan(0);
        expect(sun?.minutesUntilSunset).to.be.greaterThan(0);
        expect(result.provenance['sun.elevation']).to.include({ sourceId: 'manual', quality: 'calculated' });
    });
});
