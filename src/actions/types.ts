import type { StatePermissions } from '../discovery/types';
import type { SuggestionStatus } from '../suggestions/types';

export type AutonomyLevel = 0 | 1 | 2 | 3;

export type SafetyReasonCode =
    | 'autonomy_denied'
    | 'pattern_missing'
    | 'pattern_not_approved'
    | 'pattern_ineligible'
    | 'pattern_target_mismatch'
    | 'confidence_too_low'
    | 'conditions_not_satisfied'
    | 'request_expired'
    | 'request_window_invalid'
    | 'context_stale'
    | 'target_missing'
    | 'target_not_state'
    | 'target_not_writable'
    | 'control_permission_denied'
    | 'target_blocked'
    | 'cooldown_active'
    | 'value_type_invalid'
    | 'value_range_invalid'
    | 'value_enum_invalid';

export interface FrozenActionRequest {
    readonly correlationId: string;
    readonly patternId: string;
    readonly targetStateId: string;
    readonly value: ioBroker.StateValue;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly contextTimestamp: number;
}

export interface SafetyPatternView {
    id: string;
    actionStateId: string;
    status: SuggestionStatus;
    eligible: boolean;
    confidence: number;
}

export interface ActionTargetMetadata {
    exists: boolean;
    objectType?: ioBroker.ObjectType;
    write?: boolean;
    valueType?: ioBroker.CommonType;
    min?: number;
    max?: number;
    states?: ioBroker.StateCommon['states'];
}

export interface SafetyEnvironment {
    now: number;
    autonomyLevel: AutonomyLevel;
    pattern?: SafetyPatternView;
    permissions: StatePermissions;
    target: ActionTargetMetadata;
    targetBlocked: boolean;
    cooldownUntil: number;
    conditionsSatisfied: boolean;
    minimumConfidence: number;
    maximumContextAgeMs: number;
    maximumRequestWindowMs: number;
}

export interface SafetyDecision {
    allowed: boolean;
    reasons: SafetyReasonCode[];
    checkedAt: number;
    correlationId: string;
}

export type ActionAuditStage = 'requested' | 'denied' | 'write_started' | 'succeeded' | 'failed';

export interface ActionAuditRecord {
    id: string;
    correlationId: string;
    patternId: string;
    targetStateId: string;
    timestamp: number;
    stage: ActionAuditStage;
    reasons: SafetyReasonCode[];
    errorCode?: string;
}

export interface ActionResult {
    correlationId: string;
    executed: boolean;
    reasons: SafetyReasonCode[];
    errorCode?: string;
}
