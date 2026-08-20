import { expect } from 'chai';
import { TimeContextProvider } from './timeContextProvider';

describe('TimeContextProvider', () => {
    it('uses the requested timestamp and configured timezone', async () => {
        const timestamp = Date.parse('2026-08-22T22:15:00.000Z');
        const result = await new TimeContextProvider('Europe/Berlin').getContext({ timestamp });

        expect(result.context.time).to.deep.equal({ hour: 0, minute: 15, weekday: 0, isWeekend: true });
        expect(result.provenance['time.hour']).to.include({ providerId: 'time', timestamp });
    });
});
