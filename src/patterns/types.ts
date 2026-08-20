import type { ContextSnapshot } from '../context/types';
import type { SemanticType } from '../discovery/types';

export type PatternFeatureKey =
    | 'time.halfHour'
    | 'time.weekend'
    | 'location.room'
    | 'sun.elevationBand'
    | 'sun.sunriseOffset'
    | 'sun.sunsetOffset'
    | 'environment.illuminanceBand'
    | 'environment.temperatureBand'
    | 'presence.home';

export type PatternFeatureValue = string | number | boolean;

export interface PatternFeatures {
    values: Partial<Record<PatternFeatureKey, PatternFeatureValue>>;
}

export interface PatternCondition {
    feature: PatternFeatureKey;
    value: PatternFeatureValue;
}

export interface PatternExample {
    timestamp: number;
    matched: boolean;
    features: PatternFeatures;
}

export interface LearnableState {
    id: string;
    semanticType: SemanticType;
    valueType?: ioBroker.CommonType;
    rooms: string[];
    canSuggest?: boolean;
}

export interface PatternSelection {
    conditions: PatternCondition[];
    heldOutImprovement: number;
    baselineRate: number;
    selectedRate: number;
    support: number;
}

export interface ConfidenceComponents {
    smoothedMatchRate: number;
    sampleMaturity: number;
    repeatability: number;
    recency: number;
    feedbackAdjustment: number;
}

export interface LearnedPattern {
    id: string;
    triggerStateId: string;
    actionStateId: string;
    expectedAction: true;
    actionWindowMs: number;
    suggestionEligible: boolean;
    rooms: string[];
    conditions: PatternCondition[];
    opportunities: number;
    matches: number;
    distinctDays: number;
    positiveFeedback: number;
    negativeFeedback: number;
    confidence: number;
    confidenceComponents: ConfidenceComponents;
    heldOutImprovement: number;
    firstSeen: number;
    lastSeen: number;
    status: 'learning' | 'candidate';
    explanation: string;
}

export interface PendingOpportunity {
    key: string;
    triggerStateId: string;
    actionStateId: string;
    timestamp: number;
    expiresAt: number;
    rooms: string[];
    context?: ContextSnapshot;
}

export interface PatternSummary {
    enabled: boolean;
    learningPatterns: number;
    candidates: number;
    pendingOpportunities: number;
    retainedExamples: number;
    lastEvaluationTimestamp: number;
}
