import { expect } from 'chai';
import type { ContextSnapshot } from '../context/types';
import { PatternEngine } from '../patterns/patternEngine';
import type { LearnableState } from '../patterns/types';
import { HistoricalLearningService, enrichHistoricalContext } from './historicalLearningService';
import type { HistoryEntry } from './types';

const day = 24 * 60 * 60 * 1_000;
const base = Date.UTC(2026, 7, 10, 18);
const states: LearnableState[] = [
    { id: 'presence', semanticType: 'presence', valueType: 'boolean', rooms: ['kitchen'] },
    { id: 'light', semanticType: 'light', valueType: 'boolean', rooms: ['kitchen'], canBeSuggested: true },
    { id: 'lux', semanticType: 'illuminance', valueType: 'number', rooms: ['kitchen'] },
];

function snapshot(timestamp: number): ContextSnapshot {
    const date = new Date(timestamp);
    return {
        timestamp,
        time: { hour: date.getUTCHours(), minute: date.getUTCMinutes(), weekday: date.getUTCDay(), isWeekend: false },
        provenance: {},
        failures: [],
    };
}

describe('HistoricalLearningService', () => {
    it('replays bounded multi-day evidence without dispatching actions', async () => {
        const histories = new Map<string, HistoryEntry[]>([
            [
                'presence',
                [
                    { timestamp: base - 1_000, value: false, ack: true },
                    ...Array.from({ length: 8 }, (_, index) => ({
                        timestamp: base + Math.floor(index / 3) * day + (index % 3) * 60 * 60_000,
                        value: index % 2 === 0,
                        ack: true,
                    })),
                ],
            ],
            [
                'light',
                [
                    { timestamp: base - 1_000, value: false, ack: true },
                    ...Array.from({ length: 8 }, (_, index) => ({
                        timestamp: base + Math.floor(index / 3) * day + (index % 3) * 60 * 60_000 + 10_000,
                        value: index % 2 === 0,
                        ack: true,
                    })),
                ],
            ],
            ['lux', [{ timestamp: base - 2_000, value: 5, ack: true }]],
        ]);
        const engine = new PatternEngine(states, { enabled: true });
        const service = new HistoricalLearningService(
            {
                query: stateId => Promise.resolve(histories.get(stateId) ?? []),
            },
            engine,
            (timestamp, values) => Promise.resolve(enrichHistoricalContext(snapshot(timestamp), values, states, [])),
            states,
            'system.adapter.freya.0',
            { maxStates: 10, maxEntriesPerState: 100, maxEvents: 1_000, maxConcurrent: 2 },
        );

        const summary = await service.run(base - 5_000, base + 3 * day);
        const onPattern = engine.patterns(base + 3 * day).find(pattern => pattern.expectedAction);
        const storedOnPattern = engine.snapshot().find(record => record.expectedAction);

        expect(summary).to.include({ queriedStates: 3, failedStates: 0 });
        expect(summary.replayedEvents).to.be.greaterThan(10);
        expect(onPattern?.matches).to.equal(4);
        expect(
            storedOnPattern?.examples.every(example => example.features.values['room.illuminanceBand'] === 'dark'),
        ).to.equal(true);

        await service.run(base - 5_000, base + 3 * day);
        expect(engine.snapshot().find(record => record.expectedAction)?.examples).to.have.length(
            storedOnPattern?.examples.length ?? 0,
        );
    });

    it('continues when one history state fails and rejects foreign command/confirmation pairs', async () => {
        const engine = new PatternEngine(states, { enabled: true });
        const service = new HistoricalLearningService(
            {
                query: stateId => {
                    if (stateId === 'lux') {
                        return Promise.reject(new Error('unavailable'));
                    }
                    return Promise.resolve([
                        { timestamp: base, value: false, ack: true },
                        {
                            timestamp: base + 1_000,
                            value: true,
                            ack: false,
                            source: 'system.adapter.script.0',
                        },
                        { timestamp: base + 2_000, value: true, ack: true, source: 'system.adapter.device.0' },
                    ]);
                },
            },
            engine,
            timestamp => Promise.resolve(snapshot(timestamp)),
            states,
            'system.adapter.freya.0',
            { maxStates: 10, maxEntriesPerState: 100, maxEvents: 1_000, maxConcurrent: 2 },
        );

        const summary = await service.run(base, base + 10_000);

        expect(summary.failedStates).to.equal(1);
        expect(engine.patterns(base + 10_000)).to.be.empty;
    });
});
