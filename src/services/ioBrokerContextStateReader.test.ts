import { expect } from 'chai';
import { IoBrokerContextStateReader } from './ioBrokerContextStateReader';

describe('IoBrokerContextStateReader', () => {
    it('never requests a state outside its explicit allow-list', async () => {
        let requested: string[] = [];
        const adapter = {
            getForeignStatesAsync: (stateIds: string[]) => {
                requested = stateIds;
                return Promise.resolve({
                    'fixture.0.allowed': { val: 42, ack: true, ts: 100, lc: 100, q: 0, from: 'fixture.0' },
                });
            },
        } as unknown as ioBroker.Adapter;
        const reader = new IoBrokerContextStateReader(adapter, ['fixture.0.allowed']);

        const result = await reader.read(['fixture.0.denied', 'fixture.0.allowed']);

        expect(requested).to.deep.equal(['fixture.0.allowed']);
        expect(result).to.deep.equal({ 'fixture.0.allowed': { value: 42, timestamp: 100 } });
    });
});
