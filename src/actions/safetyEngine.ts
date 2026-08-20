import type {
    ActionTargetMetadata,
    FrozenActionRequest,
    SafetyDecision,
    SafetyEnvironment,
    SafetyReasonCode,
} from './types';

function valueReasons(value: ioBroker.StateValue, target: ActionTargetMetadata): SafetyReasonCode[] {
    if (!target.valueType) {
        return ['value_type_invalid'];
    }
    const expectedType = target.valueType === 'mixed' ? undefined : target.valueType;
    if (expectedType && typeof value !== expectedType) {
        return ['value_type_invalid'];
    }
    if (
        typeof value === 'number' &&
        (!Number.isFinite(value) || value < (target.min ?? -Infinity) || value > (target.max ?? Infinity))
    ) {
        return ['value_range_invalid'];
    }
    if (target.states && !Object.prototype.hasOwnProperty.call(target.states, String(value))) {
        return ['value_enum_invalid'];
    }
    return [];
}

/** Pure, deterministic, deny-by-default last-moment action validation. */
export class SafetyEngine {
    public validate(request: FrozenActionRequest, environment: SafetyEnvironment): SafetyDecision {
        const reasons: SafetyReasonCode[] = [];
        if (environment.autonomyLevel !== 3) {
            reasons.push('autonomy_denied');
        }
        if (!environment.pattern) {
            reasons.push('pattern_missing');
        } else {
            if (environment.pattern.status !== 'approved') {
                reasons.push('pattern_not_approved');
            }
            if (!environment.pattern.eligible) {
                reasons.push('pattern_ineligible');
            }
            if (
                environment.pattern.actionStateId !== request.targetStateId ||
                environment.pattern.id !== request.patternId
            ) {
                reasons.push('pattern_target_mismatch');
            }
            if (environment.pattern.confidence < environment.minimumConfidence) {
                reasons.push('confidence_too_low');
            }
        }
        if (!environment.conditionsSatisfied) {
            reasons.push('conditions_not_satisfied');
        }
        if (request.expiresAt < environment.now) {
            reasons.push('request_expired');
        }
        if (
            request.expiresAt <= request.createdAt ||
            request.expiresAt - request.createdAt > environment.maximumRequestWindowMs
        ) {
            reasons.push('request_window_invalid');
        }
        if (
            request.contextTimestamp > environment.now + 1_000 ||
            environment.now - request.contextTimestamp > environment.maximumContextAgeMs
        ) {
            reasons.push('context_stale');
        }
        if (!environment.target.exists) {
            reasons.push('target_missing');
        } else {
            if (environment.target.objectType !== 'state') {
                reasons.push('target_not_state');
            }
            if (environment.target.write !== true) {
                reasons.push('target_not_writable');
            }
            reasons.push(...valueReasons(request.value, environment.target));
        }
        if (!environment.permissions.control) {
            reasons.push('control_permission_denied');
        }
        if (environment.targetBlocked) {
            reasons.push('target_blocked');
        }
        if (environment.cooldownUntil > environment.now) {
            reasons.push('cooldown_active');
        }
        return {
            allowed: reasons.length === 0,
            reasons: [...new Set(reasons)],
            checkedAt: environment.now,
            correlationId: request.correlationId,
        };
    }
}
