import { expect } from 'chai';
import type { ContextEngine } from '../context/contextEngine';
import type { ContextRequest } from '../context/types';
import type { Observation, ObservationMetadata } from './types';
import { ObservationEngine } from './observationEngine';

const metadata: ObservationMetadata = {
    semanticType: 'light',
    role: 'switch.light',
    rooms: ['Fixture room'],
    functions: ['Lighting'],
    relatedStateIds: [],
};

function state(value: ioBroker.StateValue, timestamp: number): ioBroker.State {
    return { val: value, ack: true, ts: timestamp, lc: timestamp, from: 'system.adapter.fixture.0', q: 0 };
}

function contextEngine(): ContextEngine {
    return {
        snapshot: (request: ContextRequest) =>
            Promise.resolve({
                timestamp: request.timestamp,
                time: { hour: 12, minute: 0, weekday: 1, isWeekend: false },
                provenance: {},
                failures: [],
            }),
    } as unknown as ContextEngine;
}

describe('ObservationEngine', () => {
    it('deduplicates unchanged states and preserves event order and previous values', async () => {
        const observations: Observation[] = [];
        let complete: (() => void) | undefined;
        const completed = new Promise<void>(resolve => (complete = resolve));
        const engine = new ObservationEngine(
            contextEngine(),
            {
                onObservation: observation => {
                    observations.push(observation);
                    if (observations.length === 2) {
                        complete?.();
                    }
                    return Promise.resolve();
                },
                onError: () => undefined,
                debug: () => undefined,
            },
            1,
            { maxQueue: 10, maxRetained: 10 },
        );
        engine.prime({ 'fixture.0.light': state(false, 1) });

        expect(engine.ingest('fixture.0.light', state(false, 1), metadata)).to.equal(false);
        expect(
            engine.ingest('fixture.0.light', state(true, 2), metadata, {
                kind: 'device-originated',
                source: 'system.adapter.fixture.0',
                confidence: 0.7,
                reason: 'unsolicited_acknowledged_change',
            }),
        ).to.equal(true);
        expect(engine.ingest('fixture.0.light', state(false, 3), metadata)).to.equal(true);
        await completed;

        expect(observations.map(item => item.sequence)).to.deep.equal([1, 2]);
        expect(observations.map(item => item.previousValue)).to.deep.equal([false, true]);
        expect(observations.map(item => item.value)).to.deep.equal([true, false]);
        expect(observations[0].attribution?.kind).to.equal('device-originated');
        await engine.stop();
    });

    it('distinguishes a deleted state from a null state value', async () => {
        const observations: Observation[] = [];
        let complete: (() => void) | undefined;
        const completed = new Promise<void>(resolve => (complete = resolve));
        const engine = new ObservationEngine(
            contextEngine(),
            {
                onObservation: observation => {
                    observations.push(observation);
                    if (observations.length === 2) {
                        complete?.();
                    }
                    return Promise.resolve();
                },
                onError: () => undefined,
                debug: () => undefined,
            },
            1,
            { maxQueue: 10, maxRetained: 10 },
        );

        engine.ingest('fixture.0.light', state(null, 2), metadata);
        engine.ingest('fixture.0.light', null, metadata);
        await completed;

        expect(observations.map(item => item.deleted)).to.deep.equal([false, true]);
        await engine.stop();
    });

    it('retains only the configured number of observations', async () => {
        let count = 0;
        let complete: (() => void) | undefined;
        const completed = new Promise<void>(resolve => (complete = resolve));
        const engine = new ObservationEngine(
            contextEngine(),
            {
                onObservation: () => {
                    if (++count === 3) {
                        complete?.();
                    }
                    return Promise.resolve();
                },
                onError: () => undefined,
                debug: () => undefined,
            },
            1,
            { maxQueue: 10, maxRetained: 2 },
        );

        engine.ingest('fixture.0.light', state(1, 1), metadata);
        engine.ingest('fixture.0.light', state(2, 2), metadata);
        engine.ingest('fixture.0.light', state(3, 3), metadata);
        await completed;

        expect(engine.summary().retainedObservations).to.equal(2);
        expect(engine.page(0, 100).items.map(item => item.value)).to.deep.equal([3, 2]);
        await engine.stop();
    });

    it('drops the oldest queued event under overload while preserving processed order', async () => {
        const observations: Observation[] = [];
        let releaseFirst: (() => void) | undefined;
        const firstBlocked = new Promise<void>(resolve => (releaseFirst = resolve));
        let snapshotCount = 0;
        const slowContext = {
            snapshot: async (request: ContextRequest) => {
                if (++snapshotCount === 1) {
                    await firstBlocked;
                }
                return {
                    timestamp: request.timestamp,
                    time: { hour: 12, minute: 0, weekday: 1, isWeekend: false },
                    provenance: {},
                    failures: [],
                };
            },
        } as unknown as ContextEngine;
        let complete: (() => void) | undefined;
        const completed = new Promise<void>(resolve => (complete = resolve));
        const engine = new ObservationEngine(
            slowContext,
            {
                onObservation: observation => {
                    observations.push(observation);
                    if (observations.length === 3) {
                        complete?.();
                    }
                    return Promise.resolve();
                },
                onError: () => undefined,
                debug: () => undefined,
            },
            1,
            { maxQueue: 2, maxRetained: 10 },
        );

        engine.ingest('fixture.0.light', state(1, 1), metadata);
        engine.ingest('fixture.0.light', state(2, 2), metadata);
        engine.ingest('fixture.0.light', state(3, 3), metadata);
        engine.ingest('fixture.0.light', state(4, 4), metadata);
        expect(engine.summary().droppedEvents).to.equal(1);
        releaseFirst?.();
        await completed;

        expect(observations.map(item => item.sequence)).to.deep.equal([1, 3, 4]);
        await engine.stop();
    });

    it('rejects new events after shutdown', async () => {
        const engine = new ObservationEngine(
            contextEngine(),
            { onObservation: () => Promise.resolve(), onError: () => undefined, debug: () => undefined },
            1,
            { maxQueue: 2, maxRetained: 2 },
        );

        await engine.stop();

        expect(engine.ingest('fixture.0.light', state(true, 1), metadata)).to.equal(false);
    });

    it('bounds string state values before fingerprinting and retention', async () => {
        let retained: Observation | undefined;
        let complete: (() => void) | undefined;
        const completed = new Promise<void>(resolve => (complete = resolve));
        const engine = new ObservationEngine(
            contextEngine(),
            {
                onObservation: observation => {
                    retained = observation;
                    complete?.();
                    return Promise.resolve();
                },
                onError: () => undefined,
                debug: () => undefined,
            },
            1,
            { maxQueue: 2, maxRetained: 2 },
        );

        engine.ingest('fixture.0.text', state('x'.repeat(5_000), 1), metadata);
        await completed;

        expect(retained?.value).to.equal('x'.repeat(4_096));
        await engine.stop();
    });
});
