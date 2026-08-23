import type { Observation } from '../observation/types';
import type { PatternSuggestion } from '../suggestions/types';
import { extractPatternFeatures } from './features';
import type { PatternCondition } from './types';

export interface ContextStateDescriptor {
    id: string;
    semanticType: string;
    rooms: string[];
}

const NON_ACTIONABLE_ORIGINS = new Set(['self', 'external-command', 'confirmation']);

export function localIlluminance(
    states: Record<string, unknown> | undefined,
    rooms: string[],
    descriptors: ContextStateDescriptor[],
): number | undefined {
    if (!states) {
        return undefined;
    }
    return descriptors
        .filter(
            state =>
                state.semanticType === 'illuminance' &&
                state.rooms.some(room => rooms.includes(room)) &&
                typeof states[state.id] === 'number' &&
                Number.isFinite(states[state.id]),
        )
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(state => states[state.id] as number)[0];
}

export function conditionsMatchSnapshot(
    context: Observation['context'],
    rooms: string[],
    conditions: PatternCondition[],
    descriptors: ContextStateDescriptor[],
): boolean {
    const features = extractPatternFeatures(context, rooms, localIlluminance(context?.states, rooms, descriptors));
    return conditions.every(condition => features.values[condition.feature] === condition.value);
}

/** Match only a fresh behavioral trigger transition against an approved suggestion. */
export function observationTriggersSuggestion(
    observation: Observation,
    suggestion: PatternSuggestion,
    descriptors: ContextStateDescriptor[],
): boolean {
    return (
        suggestion.status === 'approved' &&
        suggestion.eligible &&
        observation.stateId === suggestion.triggerStateId &&
        !observation.deleted &&
        typeof observation.value === 'boolean' &&
        observation.value === suggestion.expectedAction &&
        observation.previousValue !== observation.value &&
        !NON_ACTIONABLE_ORIGINS.has(observation.attribution?.kind ?? 'unknown') &&
        conditionsMatchSnapshot(observation.context, suggestion.rooms, suggestion.conditions, descriptors)
    );
}
