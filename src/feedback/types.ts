import type { SafetyReasonCode } from '../actions/types';

export type FeedbackOutcome = 'positive' | 'negative' | 'neutral' | 'unknown';
export type FeedbackSource = 'explicit' | 'implicit';

export interface PersistedActionRecord {
    correlationId: string;
    patternId: string;
    targetStateId: string;
    expectedValue: ioBroker.StateValue;
    requestedAt: number;
    completedAt?: number;
    executed: boolean;
    reasons: SafetyReasonCode[];
    errorCode?: string;
    feedback?: {
        outcome: FeedbackOutcome;
        source: FeedbackSource;
        timestamp: number;
        actor?: string;
        reason?: string;
    };
}

export interface FeedbackSummary {
    actionCount: number;
    pendingCount: number;
    positiveCount: number;
    negativeCount: number;
    neutralCount: number;
    unknownCount: number;
    lastFeedbackTimestamp: number;
}

export interface FeedbackTotals {
    positive: number;
    negative: number;
}
