import { expect } from 'chai';
import type { ContextSnapshot } from '../context/types';
import type { Observation } from '../observation/types';
import { PatternEngine } from './patternEngine';

const DAY_MS = 24 * 60 * 60 * 1_000;

function context(timestamp: number, dark: boolean): ContextSnapshot {
    const hour = dark ? 19 : 12;
    return {
        timestamp,
        time: { hour, minute: 0, weekday: new Date(timestamp).getUTCDay(), isWeekend: false },
        sun: { elevation: dark ? -3 : 30, minutesUntilSunset: dark ? 15 : 180 },
        environment: { outsideIlluminance: dark ? 5 : 5_000, outsideTemperature: timestamp % 2 ? 5 : 25 },
        presence: { home: true },
        provenance: {},
        failures: [],
    };
}

function observation(
    stateId: string,
    semanticType: Observation['semanticType'],
    timestamp: number,
    snapshot?: ContextSnapshot,
): Observation {
    return {
        sequence: timestamp,
        stateId,
        value: true,
        previousValue: false,
        timestamp,
        receivedAt: timestamp,
        ack: true,
        quality: 0,
        deleted: false,
        semanticType,
        rooms: ['living'],
        functions: [],
        context: snapshot,
    };
}

describe('PatternEngine', () => {
    it('learns an explainable dark-context trigger-to-light candidate', () => {
        const engine = new PatternEngine(
            [
                { id: 'sensor.motion', semanticType: 'motion', valueType: 'boolean', rooms: ['living'] },
                { id: 'lamp.on', semanticType: 'light', valueType: 'boolean', rooms: ['living'] },
            ],
            { enabled: true, actionWindowMs: 60_000 },
        );
        const start = Date.UTC(2026, 0, 1);
        for (let index = 0; index < 24; index++) {
            const timestamp = start + index * DAY_MS;
            const dark = index % 2 === 0;
            engine.observe(observation('sensor.motion', 'motion', timestamp, context(timestamp, dark)));
            if (dark) {
                engine.observe(observation('lamp.on', 'light', timestamp + 5_000));
            } else {
                engine.flush(timestamp + 61_000);
            }
        }

        const [pattern] = engine.patterns(start + 24 * DAY_MS);
        expect(pattern.status).to.equal('candidate');
        expect(pattern.conditions).to.include.deep.members([{ feature: 'environment.illuminanceBand', value: 'dark' }]);
        expect(pattern.conditions.some(item => item.feature === 'environment.temperatureBand')).to.equal(false);
        expect(pattern.opportunities).to.equal(12);
        expect(pattern.matches).to.equal(12);
        expect(pattern.explanation).to.contain('environment.illuminanceBand = dark');
    });

    it('remains inert when disabled and never correlates rooms that do not overlap', () => {
        const disabled = new PatternEngine(
            [
                { id: 'motion', semanticType: 'motion', valueType: 'boolean', rooms: ['hall'] },
                { id: 'light', semanticType: 'light', valueType: 'boolean', rooms: ['hall'] },
            ],
            { enabled: false },
        );
        disabled.observe(observation('motion', 'motion', 1, context(1, true)));
        expect(disabled.summary(2).retainedExamples).to.equal(0);

        const separated = new PatternEngine(
            [
                { id: 'motion', semanticType: 'motion', valueType: 'boolean', rooms: ['hall'] },
                { id: 'light', semanticType: 'light', valueType: 'boolean', rooms: ['kitchen'] },
            ],
            { enabled: true },
        );
        separated.observe(observation('motion', 'motion', 1, context(1, true)));
        expect(separated.summary(2).pendingOpportunities).to.equal(0);
    });

    it('can promote a reliable pattern without adding unnecessary context conditions', () => {
        const engine = new PatternEngine(
            [
                { id: 'motion', semanticType: 'motion', valueType: 'boolean', rooms: ['hall'] },
                { id: 'light', semanticType: 'light', valueType: 'boolean', rooms: ['hall'] },
            ],
            { enabled: true },
        );
        const start = Date.UTC(2026, 0, 1);
        for (let index = 0; index < 12; index++) {
            const timestamp = start + index * DAY_MS;
            engine.observe(observation('motion', 'motion', timestamp, context(timestamp, true)));
            engine.observe(observation('light', 'light', timestamp + 1_000));
        }
        const [pattern] = engine.patterns(start + 12 * DAY_MS);
        expect(pattern.status).to.equal('candidate');
        expect(pattern.conditions).to.deep.equal([]);
    });

    it('ages stale patterns out of bounded memory', () => {
        const engine = new PatternEngine(
            [
                { id: 'motion', semanticType: 'motion', valueType: 'boolean', rooms: ['hall'] },
                { id: 'light', semanticType: 'light', valueType: 'boolean', rooms: ['hall'] },
            ],
            { enabled: true, actionWindowMs: 5_000, inactiveRetentionMs: DAY_MS },
        );
        engine.observe(observation('motion', 'motion', 1, context(1, true)));
        engine.flush(6_001);
        expect(engine.patterns(6_001)).to.have.length(1);
        expect(engine.patterns(2 * DAY_MS)).to.have.length(0);
    });

    it('hard-bounds simultaneous pending opportunities', () => {
        const states = [
            { id: 'motion', semanticType: 'motion' as const, valueType: 'boolean' as const, rooms: ['hall'] },
            ...Array.from({ length: 20 }, (_, index) => ({
                id: `light.${index}`,
                semanticType: 'light' as const,
                valueType: 'boolean' as const,
                rooms: ['hall'],
            })),
        ];
        const engine = new PatternEngine(states, { enabled: true, maxPendingOpportunities: 10 });
        engine.observe(observation('motion', 'motion', 1, context(1, true)));
        expect(engine.summary(2).pendingOpportunities).to.equal(10);
    });
});
