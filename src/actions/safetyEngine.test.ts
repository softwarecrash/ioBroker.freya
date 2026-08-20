import { expect } from 'chai';
import { SafetyEngine } from './safetyEngine';
import type { FrozenActionRequest, SafetyEnvironment, SafetyReasonCode } from './types';

const NOW = 10_000;

function request(overrides: Partial<FrozenActionRequest> = {}): FrozenActionRequest {
    return {
        correlationId: 'correlation-1',
        patternId: '0123456789abcdef',
        targetStateId: 'alias.0.room.light',
        value: true,
        createdAt: NOW - 100,
        expiresAt: NOW + 5_000,
        contextTimestamp: NOW - 50,
        ...overrides,
    };
}

function environment(overrides: Partial<SafetyEnvironment> = {}): SafetyEnvironment {
    return {
        now: NOW,
        autonomyLevel: 3,
        pattern: {
            id: '0123456789abcdef',
            actionStateId: 'alias.0.room.light',
            status: 'approved',
            eligible: true,
            confidence: 0.9,
        },
        permissions: { observe: true, learn: true, suggest: true, control: true },
        target: { exists: true, objectType: 'state', write: true, valueType: 'boolean' },
        targetBlocked: false,
        cooldownUntil: 0,
        conditionsSatisfied: true,
        minimumConfidence: 0.7,
        maximumContextAgeMs: 60_000,
        maximumRequestWindowMs: 30_000,
        ...overrides,
    };
}

describe('SafetyEngine', () => {
    const safety = new SafetyEngine();

    it('allows only a fully revalidated request', () => {
        expect(safety.validate(request(), environment())).to.deep.include({ allowed: true, reasons: [] });
    });

    const denials: Array<[SafetyReasonCode, FrozenActionRequest, SafetyEnvironment]> = [
        ['autonomy_denied', request(), environment({ autonomyLevel: 2 })],
        ['pattern_missing', request(), environment({ pattern: undefined })],
        [
            'pattern_not_approved',
            request(),
            environment({ pattern: { ...environment().pattern!, status: 'candidate' } }),
        ],
        ['pattern_ineligible', request(), environment({ pattern: { ...environment().pattern!, eligible: false } })],
        [
            'pattern_target_mismatch',
            request(),
            environment({ pattern: { ...environment().pattern!, actionStateId: 'alias.0.other' } }),
        ],
        ['confidence_too_low', request(), environment({ pattern: { ...environment().pattern!, confidence: 0.6 } })],
        ['conditions_not_satisfied', request(), environment({ conditionsSatisfied: false })],
        ['request_expired', request({ expiresAt: NOW - 1 }), environment()],
        ['request_window_invalid', request({ expiresAt: NOW + 60_000 }), environment()],
        ['context_stale', request({ contextTimestamp: NOW - 60_001 }), environment()],
        ['target_missing', request(), environment({ target: { exists: false } })],
        ['target_not_state', request(), environment({ target: { ...environment().target, objectType: 'channel' } })],
        ['target_not_writable', request(), environment({ target: { ...environment().target, write: false } })],
        [
            'control_permission_denied',
            request(),
            environment({ permissions: { observe: true, learn: true, suggest: true, control: false } }),
        ],
        ['target_blocked', request(), environment({ targetBlocked: true })],
        ['cooldown_active', request(), environment({ cooldownUntil: NOW + 1 })],
        ['value_type_invalid', request({ value: 1 }), environment()],
        [
            'value_range_invalid',
            request({ value: 11 }),
            environment({ target: { exists: true, objectType: 'state', write: true, valueType: 'number', max: 10 } }),
        ],
        [
            'value_enum_invalid',
            request({ value: 2 }),
            environment({
                target: {
                    exists: true,
                    objectType: 'state',
                    write: true,
                    valueType: 'number',
                    states: { 0: 'off', 1: 'on' },
                },
            }),
        ],
    ];

    for (const [reason, actionRequest, actionEnvironment] of denials) {
        it(`denies with ${reason}`, () => {
            const decision = safety.validate(actionRequest, actionEnvironment);
            expect(decision.allowed).to.equal(false);
            expect(decision.reasons).to.include(reason);
        });
    }
});
