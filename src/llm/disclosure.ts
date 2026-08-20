import type { PatternSuggestion } from '../suggestions/types';
import type { DisclosurePreview, LlmPatternDisclosure, LlmProviderKind } from './types';

/** Build an allow-listed payload with no state IDs, names, raw values or person data. */
export function buildPatternDisclosure(suggestion: PatternSuggestion, requestId: string): LlmPatternDisclosure {
    return {
        requestId: requestId.slice(0, 80),
        pattern: {
            conditionCount: suggestion.conditions.length,
            conditions: suggestion.conditions.slice(0, 3).map(condition => ({
                feature: condition.feature,
                value: condition.value,
            })),
            confidence: Math.round(suggestion.confidence * 1_000) / 1_000,
            opportunities: Math.max(0, Math.min(100_000, suggestion.opportunities)),
            matches: Math.max(0, Math.min(100_000, suggestion.matches)),
            actionWindowSeconds: Math.max(1, Math.min(3_600, Math.round(suggestion.actionWindowMs / 1_000))),
            roomCount: Math.min(suggestion.rooms.length, 20),
        },
    };
}

export function disclosurePreview(
    provider: LlmProviderKind,
    payload: LlmPatternDisclosure,
    external: boolean,
    endpointOrigin?: string,
): DisclosurePreview {
    return {
        provider,
        external,
        endpointOrigin,
        fields: [
            'requestId',
            'pattern.conditionCount',
            'pattern.conditions',
            'pattern.confidence',
            'pattern.opportunities',
            'pattern.matches',
            'pattern.actionWindowSeconds',
            'pattern.roomCount',
        ],
        payload,
    };
}
