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
    value = true,
    rooms = ['living'],
): Observation {
    return {
        sequence: timestamp,
        stateId,
        value,
        previousValue: !value,
        timestamp,
        receivedAt: timestamp,
        ack: true,
        quality: 0,
        deleted: false,
        semanticType,
        rooms,
        functions: [],
        context: snapshot,
    };
}

describe('PatternEngine', () => {
    it('does not learn its own actions or generic external commands as user behavior', () => {
        const engine = new PatternEngine(
            [
                { id: 'motion', semanticType: 'motion', valueType: 'boolean', rooms: ['living'] },
                { id: 'light', semanticType: 'light', valueType: 'boolean', rooms: ['living'] },
            ],
            { enabled: true, actionWindowMs: 60_000 },
        );
        const trigger = observation('motion', 'motion', 1_000);
        engine.observe(trigger);
        const ownAction = observation('light', 'light', 2_000);
        ownAction.attribution = {
            kind: 'smartbrain',
            source: 'system.adapter.smartbrain.0',
            confidence: 1,
            reason: 'self_source',
        };
        engine.observe(ownAction);
        const externalAction = observation('light', 'light', 3_000, undefined, false);
        externalAction.attribution = {
            kind: 'external-command',
            source: 'system.adapter.any-logic.0',
            confidence: 0.8,
            reason: 'foreign_command',
        };
        engine.observe(externalAction);
        expect(engine.patterns(4_000)).to.have.length(0);
    });

    it('learns an explainable dark-context trigger-to-light candidate', () => {
        const engine = new PatternEngine(
            [
                { id: 'sensor.motion', semanticType: 'motion', valueType: 'boolean', rooms: ['living'] },
                {
                    id: 'lamp.on',
                    semanticType: 'light',
                    valueType: 'boolean',
                    rooms: ['living'],
                    canBeSuggested: true,
                },
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
        expect(pattern.suggestionEligible).to.equal(true);
    });

    it('uses a same-room illuminance state as context without exposing its state id', () => {
        const engine = new PatternEngine(
            [
                { id: 'kitchen.presence', semanticType: 'presence', valueType: 'boolean', rooms: ['kitchen'] },
                { id: 'kitchen.light', semanticType: 'light', valueType: 'boolean', rooms: ['kitchen'] },
                { id: 'kitchen.lux', semanticType: 'illuminance', valueType: 'number', rooms: ['kitchen'] },
            ],
            { enabled: true, actionWindowMs: 60_000 },
        );
        const start = Date.UTC(2026, 0, 1);
        for (let index = 0; index < 24; index++) {
            const timestamp = start + index * DAY_MS;
            const dark = index % 2 === 0;
            const snapshot = context(timestamp, true);
            snapshot.environment = { outsideIlluminance: 5_000 };
            snapshot.states = { 'kitchen.lux': dark ? 5 : 500 };
            engine.observe(observation('kitchen.presence', 'presence', timestamp, snapshot, true, ['kitchen']));
            if (dark) {
                engine.observe(observation('kitchen.light', 'light', timestamp + 5_000, undefined, true, ['kitchen']));
            } else {
                engine.flush(timestamp + 61_000);
            }
        }

        const [pattern] = engine.patterns(start + 24 * DAY_MS);
        expect(pattern.status).to.equal('candidate');
        expect(pattern.conditions).to.include.deep.members([{ feature: 'room.illuminanceBand', value: 'dark' }]);
        expect(pattern.conditions.some(item => item.feature === 'environment.illuminanceBand')).to.equal(false);
        expect(JSON.stringify(pattern.conditions)).not.to.contain('kitchen.lux');
    });

    it('learns presence-off to light-off separately from presence-on to light-on', () => {
        const engine = new PatternEngine(
            [
                {
                    id: 'kitchen.presence',
                    semanticType: 'presence',
                    valueType: 'boolean',
                    rooms: ['kitchen'],
                    canBeSuggested: false,
                },
                {
                    id: 'kitchen.light',
                    semanticType: 'light',
                    valueType: 'boolean',
                    rooms: ['kitchen'],
                    canBeSuggested: true,
                },
            ],
            { enabled: true, actionWindowMs: 60_000 },
        );
        const start = Date.UTC(2026, 0, 1);
        for (let index = 0; index < 12; index++) {
            const timestamp = start + index * DAY_MS;
            engine.observe(
                observation('kitchen.presence', 'presence', timestamp, context(timestamp, true), true, ['kitchen']),
            );
            engine.observe(observation('kitchen.light', 'light', timestamp + 1_000, undefined, true, ['kitchen']));
            engine.observe(
                observation('kitchen.presence', 'presence', timestamp + 120_000, context(timestamp, true), false, [
                    'kitchen',
                ]),
            );
            engine.observe(observation('kitchen.light', 'light', timestamp + 121_000, undefined, false, ['kitchen']));
        }

        const patterns = engine.patterns(start + 12 * DAY_MS);
        expect(patterns).to.have.length(2);
        expect(patterns.map(pattern => pattern.expectedAction).sort()).to.deep.equal([false, true]);
        expect(patterns.every(pattern => pattern.status === 'candidate' && pattern.suggestionEligible)).to.equal(true);
        expect(patterns.find(pattern => !pattern.expectedAction)?.explanation).to.contain('became false');
    });

    it('does not interpret a motion-off transition as an action opportunity', () => {
        const engine = new PatternEngine(
            [
                { id: 'motion', semanticType: 'motion', valueType: 'boolean', rooms: ['hall'] },
                { id: 'light', semanticType: 'light', valueType: 'boolean', rooms: ['hall'] },
            ],
            { enabled: true },
        );
        engine.observe(observation('motion', 'motion', 1, context(1, true), false, ['hall']));
        expect(engine.summary(2).pendingOpportunities).to.equal(0);
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
        expect(engine.setFeedbackCounts(pattern.id, 0, 10)).to.equal(true);
        const [adjusted] = engine.patterns(start + 12 * DAY_MS);
        expect(adjusted.negativeFeedback).to.equal(10);
        expect(adjusted.confidenceComponents.feedbackAdjustment).to.equal(-0.15);
        expect(adjusted.confidence).to.be.lessThan(pattern.confidence);
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
