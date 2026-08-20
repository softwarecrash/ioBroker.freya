import { expect } from 'chai';
import {
    DeviceContextProvider,
    EnvironmentContextProvider,
    PresenceContextProvider,
    type ContextStateReader,
} from './stateContextProviders';
import type { EnvironmentCandidate } from '../../discovery/types';

describe('state-backed context providers', () => {
    const reader: ContextStateReader = {
        read: stateIds =>
            Promise.resolve(
                Object.fromEntries(
                    stateIds.map(stateId => [
                        stateId,
                        {
                            value: stateId.endsWith('presence') ? true : stateId.endsWith('temperature') ? 18.5 : 42,
                            timestamp: 100,
                        },
                    ]),
                ),
            ),
    };

    it('reads only the selected semantic environment source', async () => {
        const candidates: EnvironmentCandidate[] = [
            {
                key: 'outsideTemperature',
                stateId: 'fixture.0.temperature',
                score: 1,
                sourceKind: 'physical',
                selected: true,
                pinned: false,
            },
            {
                key: 'outsideTemperature',
                stateId: 'fixture.0.weather',
                score: 0.8,
                sourceKind: 'weather',
                selected: false,
                pinned: false,
            },
        ];
        const result = await new EnvironmentContextProvider(reader, candidates).getContext({ timestamp: 200 });

        expect(result.context.environment).to.deep.equal({ outsideTemperature: 18.5 });
        expect(result.provenance['environment.outsideTemperature']).to.include({
            quality: 'measured',
            sourceId: 'fixture.0.temperature',
        });
    });

    it('aggregates configured presence sources conservatively', async () => {
        const result = await new PresenceContextProvider(reader, ['fixture.0.presence']).getContext({ timestamp: 200 });

        expect(result.context.presence).to.deep.equal({ home: true, personsHome: 1 });
    });

    it('enforces both the allow-list and device-state bound', async () => {
        const result = await new DeviceContextProvider(reader, ['fixture.0.a', 'fixture.0.b'], 1).getContext({
            timestamp: 200,
            relatedStateIds: ['fixture.0.denied', 'fixture.0.a', 'fixture.0.b'],
        });

        expect(result.context.states).to.deep.equal({ 'fixture.0.a': 42 });
    });
});
