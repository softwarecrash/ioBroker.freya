import { expect } from 'chai';
import { createRuntimeConfig } from '../config/runtimeConfig';
import type { ContextEngine } from '../context/contextEngine';
import type { LearnedPattern } from '../patterns/types';
import { SuggestionService } from '../suggestions/suggestionService';
import { IoBrokerActionEnvironment } from './ioBrokerActionEnvironment';
import type { FrozenActionRequest } from './types';

describe('IoBrokerActionEnvironment', () => {
    it('re-reads target metadata, current conditions, permissions, blocks and cooldown', async () => {
        const suggestions = new SuggestionService();
        const learned: LearnedPattern = {
            id: '0123456789abcdef',
            triggerStateId: 'alias.0.room.motion',
            actionStateId: 'alias.0.room.light',
            expectedAction: true,
            actionWindowMs: 120_000,
            suggestionEligible: true,
            rooms: ['room'],
            conditions: [{ feature: 'environment.illuminanceBand', value: 'dark' }],
            opportunities: 12,
            matches: 11,
            distinctDays: 6,
            positiveFeedback: 0,
            negativeFeedback: 0,
            confidence: 0.9,
            confidenceComponents: {
                smoothedMatchRate: 0.9,
                sampleMaturity: 0.8,
                repeatability: 1,
                recency: 1,
                feedbackAdjustment: 0,
            },
            heldOutImprovement: 0.2,
            firstSeen: 1,
            lastSeen: 2,
            status: 'candidate',
            explanation: 'fixture',
        };
        suggestions.synchronize([learned], 1);
        suggestions.transition(learned.id, 'approved', 'system.adapter.admin.0', 2);
        let objectReads = 0;
        let stateReads = 0;
        const context = {
            snapshot: ({ timestamp }: { timestamp: number }) =>
                Promise.resolve({
                    timestamp,
                    time: { hour: 12, minute: 0, weekday: 4, isWeekend: false },
                    environment: { outsideIlluminance: 5 },
                    states: { 'alias.0.room.lux': 5 },
                    provenance: {},
                    failures: [],
                }),
        } as unknown as ContextEngine;
        const config = createRuntimeConfig({
            autonomyLevel: 3,
            actionCooldownSeconds: 60,
            blockedStateIds: [{ stateId: 'alias.0.blocked' }],
        });
        const provider = new IoBrokerActionEnvironment(
            {
                getForeignObjectAsync: () => {
                    objectReads++;
                    return Promise.resolve({
                        _id: learned.actionStateId,
                        type: 'state',
                        common: { name: 'Light', type: 'boolean', read: true, write: true, role: 'switch.light' },
                        native: {},
                    });
                },
                getForeignStateAsync: () => {
                    stateReads++;
                    return Promise.resolve({ val: false, ack: true, ts: Date.now(), lc: Date.now(), from: 'test' });
                },
            },
            config,
            suggestions,
            context,
            new Map([[learned.actionStateId, { observe: true, learn: true, suggest: true, control: true }]]),
            [{ id: 'alias.0.room.lux', semanticType: 'illuminance', rooms: ['room'] }],
        );
        const now = Date.now();
        const request: FrozenActionRequest = {
            correlationId: 'correlation-1',
            patternId: learned.id,
            targetStateId: learned.actionStateId,
            value: true,
            createdAt: now,
            expiresAt: now + 10_000,
            contextTimestamp: now,
            authorization: 'automatic',
        };

        const first = await provider.inspect(request);
        expect(first.conditionsSatisfied).to.equal(true);
        expect(first.target).to.include({ exists: true, objectType: 'state', write: true, valueType: 'boolean' });
        expect(first.permissions.control).to.equal(true);
        expect(first.targetBlocked).to.equal(false);
        provider.markExecuted(learned.actionStateId, first.now);
        const second = await provider.inspect(request);
        expect(second.cooldownUntil).to.equal(first.now + 60_000);
        expect(objectReads).to.equal(2);
        expect(stateReads).to.equal(2);
    });

    it('reconstructs a same-room illuminance condition during last-moment validation', async () => {
        const suggestions = new SuggestionService();
        const learned: LearnedPattern = {
            id: 'fedcba9876543210',
            triggerStateId: 'presence',
            actionStateId: 'light',
            expectedAction: true,
            actionWindowMs: 120_000,
            suggestionEligible: true,
            rooms: ['kitchen'],
            conditions: [{ feature: 'room.illuminanceBand', value: 'dark' }],
            opportunities: 12,
            matches: 11,
            distinctDays: 6,
            positiveFeedback: 0,
            negativeFeedback: 0,
            confidence: 0.9,
            confidenceComponents: {
                smoothedMatchRate: 0.9,
                sampleMaturity: 0.8,
                repeatability: 1,
                recency: 1,
                feedbackAdjustment: 0,
            },
            heldOutImprovement: 0.2,
            firstSeen: 1,
            lastSeen: 2,
            status: 'candidate',
            explanation: 'fixture',
        };
        suggestions.synchronize([learned], 1);
        suggestions.transition(learned.id, 'approved', 'system.adapter.admin.0', 2);
        const provider = new IoBrokerActionEnvironment(
            {
                getForeignObjectAsync: () =>
                    Promise.resolve({
                        _id: 'light',
                        type: 'state',
                        common: { name: 'Light', type: 'boolean', read: true, write: true, role: 'switch.light' },
                        native: {},
                    }),
                getForeignStateAsync: () => Promise.resolve({ val: false, ack: true, ts: 1, lc: 1, from: 'test' }),
            },
            createRuntimeConfig({ autonomyLevel: 3 }),
            suggestions,
            {
                snapshot: ({ timestamp }: { timestamp: number }) =>
                    Promise.resolve({
                        timestamp,
                        time: { hour: 20, minute: 0, weekday: 1, isWeekend: false },
                        states: { lux: 5 },
                        provenance: {},
                        failures: [],
                    }),
            } as unknown as ContextEngine,
            new Map([['light', { observe: true, learn: true, suggest: true, control: true }]]),
            [{ id: 'lux', semanticType: 'illuminance', rooms: ['kitchen'] }],
        );
        const now = Date.now();
        const environment = await provider.inspect({
            correlationId: 'condition-test',
            patternId: learned.id,
            targetStateId: 'light',
            value: true,
            createdAt: now,
            expiresAt: now + 5_000,
            contextTimestamp: now,
            authorization: 'automatic',
        });
        expect(environment.conditionsSatisfied).to.equal(true);
        expect(environment.target.currentValue).to.equal(false);
    });
});
