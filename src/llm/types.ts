export type LlmProviderKind = 'disabled' | 'rules' | 'ollama' | 'ollama-remote' | 'openai' | 'openai-compatible';

export interface LlmPatternDisclosure {
    requestId: string;
    pattern: {
        conditionCount: number;
        conditions: Array<{ feature: string; value: string | number | boolean }>;
        confidence: number;
        opportunities: number;
        matches: number;
        actionWindowSeconds: number;
        roomCount: number;
        triggerType?: string;
        targetType?: string;
        expectedAction?: boolean;
        distinctDays?: number;
        evidence?: Array<{
            feature: string;
            value: string | number | boolean;
            opportunities: number;
            matches: number;
        }>;
    };
}

export interface LlmAnalysis {
    summary: string;
    riskLevel: 'low' | 'medium' | 'high';
    concerns: string[];
}

/** Bounded statistical fields that may be sent to an advisory model; no state IDs or names. */
export interface LlmPatternInput {
    rooms: string[];
    conditions: Array<{ feature: string; value: string | number | boolean }>;
    confidence: number;
    opportunities: number;
    matches: number;
    actionWindowMs: number;
    triggerType?: string;
    targetType?: string;
    expectedAction?: boolean;
    distinctDays?: number;
    evidence?: Array<{
        feature: string;
        value: string | number | boolean;
        opportunities: number;
        matches: number;
    }>;
}

export interface LlmProvider {
    readonly kind: LlmProviderKind;
    readonly external: boolean;
    analyze(disclosure: LlmPatternDisclosure, signal?: AbortSignal): Promise<LlmAnalysis>;
}

export interface DisclosurePreview {
    provider: LlmProviderKind;
    external: boolean;
    endpointOrigin?: string;
    fields: string[];
    payload: LlmPatternDisclosure;
}
