import { expect } from 'chai';
import type { Observation } from '../observation/types';
import type { PatternSuggestion } from '../suggestions/types';
import { observationTriggersSuggestion } from './matching';

function suggestion(): PatternSuggestion {
    return {
        id: '0123456789abcdef',
        patternId: '0123456789abcdef',
        status: 'approved',
        eligible: true,
        triggerStateId: 'presence',
        actionStateId: 'light',
        expectedAction: true,
        rooms: ['kitchen'],
        conditions: [{ feature: 'room.illuminanceBand', value: 'dark' }],
        opportunities: 12,
        matches: 11,
        confidence: 0.9,
        confidenceComponents: {
            smoothedMatchRate: 0.9,
            sampleMaturity: 0.8,
            repeatability: 1,
            recency: 1,
            feedbackAdjustment: 0,
        },
        actionWindowMs: 120_000,
        explanation: 'fixture',
        createdAt: 1,
        updatedAt: 2,
    };
}

function observation(): Observation {
    return {
        sequence: 1,
        stateId: 'presence',
        value: true,
        previousValue: false,
        timestamp: 1,
        receivedAt: 1,
        ack: true,
        quality: 0,
        deleted: false,
        semanticType: 'presence',
        rooms: ['kitchen'],
        functions: [],
        context: {
            timestamp: 1,
            time: { hour: 20, minute: 0, weekday: 1, isWeekend: false },
            states: { lux: 5 },
            provenance: {},
            failures: [],
        },
    };
}

describe('approved pattern trigger matching', () => {
    const descriptors = [{ id: 'lux', semanticType: 'illuminance', rooms: ['kitchen'] }];

    it('matches the kitchen trigger only when its learned local lux condition holds', () => {
        expect(observationTriggersSuggestion(observation(), suggestion(), descriptors)).to.equal(true);
        const bright = observation();
        bright.context!.states = { lux: 500 };
        expect(observationTriggersSuggestion(bright, suggestion(), descriptors)).to.equal(false);
    });

    it('rejects ineligible, unapproved and externally commanded transitions', () => {
        expect(
            observationTriggersSuggestion(observation(), { ...suggestion(), status: 'candidate' }, descriptors),
        ).to.equal(false);
        const external = observation();
        external.attribution = {
            kind: 'external-command',
            source: 'system.adapter.logic.0',
            confidence: 0.8,
            reason: 'foreign_command',
        };
        expect(observationTriggersSuggestion(external, suggestion(), descriptors)).to.equal(false);
    });
});
