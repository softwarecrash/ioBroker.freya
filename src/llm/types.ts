export type LlmProviderKind = 'disabled' | 'rules' | 'ollama' | 'openai' | 'openai-compatible';

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
    };
}

export interface LlmAnalysis {
    summary: string;
    riskLevel: 'low' | 'medium' | 'high';
    concerns: string[];
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
