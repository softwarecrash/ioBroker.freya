import type { ConfidenceComponents, PatternCondition } from '../patterns/types';

export type SuggestionStatus = 'candidate' | 'approved' | 'disabled';

export interface PatternSuggestion {
    id: string;
    patternId: string;
    status: SuggestionStatus;
    eligible: boolean;
    triggerStateId: string;
    actionStateId: string;
    expectedAction: boolean;
    rooms: string[];
    conditions: PatternCondition[];
    opportunities: number;
    matches: number;
    confidence: number;
    confidenceComponents: ConfidenceComponents;
    actionWindowMs: number;
    explanation: string;
    createdAt: number;
    updatedAt: number;
}

export type ActivityType =
    | 'candidate_created'
    | 'candidate_withdrawn'
    | 'status_changed'
    | 'status_rejected'
    | 'learning_reset'
    | 'pattern_deleted';

export interface ActivityRecord {
    id: string;
    timestamp: number;
    type: ActivityType;
    patternId: string;
    actor: string;
    outcome: 'accepted' | 'rejected';
    previousStatus?: SuggestionStatus;
    newStatus?: SuggestionStatus;
    reason: string;
}

export interface SuggestionSummary {
    candidates: number;
    approved: number;
    disabled: number;
    ineligible: number;
    activityCount: number;
    lastActivityTimestamp: number;
}

export interface TransitionResult {
    accepted: boolean;
    changed: boolean;
    reason: string;
    suggestion?: PatternSuggestion;
}
