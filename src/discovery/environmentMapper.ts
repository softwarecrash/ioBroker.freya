import type {
    EnvironmentCandidate,
    EnvironmentKey,
    EnvironmentMappingInput,
    SemanticClassification,
    StateDescriptor,
} from './types';

const TYPE_TO_KEY: Partial<Record<SemanticClassification['type'], EnvironmentKey>> = {
    temperature: 'outsideTemperature',
    illuminance: 'outsideIlluminance',
    humidity: 'humidity',
    cloudCover: 'cloudCover',
    precipitation: 'precipitation',
    windSpeed: 'windSpeed',
};

const ENVIRONMENT_KEYS: EnvironmentKey[] = [
    'outsideTemperature',
    'outsideIlluminance',
    'humidity',
    'cloudCover',
    'precipitation',
    'windSpeed',
];

function sourceKind(descriptor: StateDescriptor): EnvironmentCandidate['sourceKind'] {
    const text = [...descriptor.functions, ...descriptor.rooms, ...descriptor.ancestorNames]
        .join(' ')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    if (/weather|wetter|forecast|vorhersage/.test(text)) {
        return 'weather';
    }
    if (/outside|outdoor|aussen|garten|garden/.test(text)) {
        return 'physical';
    }
    if (/derived|calculated|berechnet/.test(text)) {
        return 'derived';
    }
    return 'unknown';
}

/** Rank semantic environment sources without adapter-specific state IDs. */
export function mapEnvironmentCandidates(
    entries: Array<{ descriptor: StateDescriptor; classification: SemanticClassification }>,
    overrides: EnvironmentMappingInput[],
): Record<EnvironmentKey, EnvironmentCandidate[]> {
    const result: Record<EnvironmentKey, EnvironmentCandidate[]> = {
        outsideTemperature: [],
        outsideIlluminance: [],
        humidity: [],
        cloudCover: [],
        precipitation: [],
        windSpeed: [],
    };
    const overrideByPair = new Map(overrides.map(item => [`${item.key}\0${item.stateId}`, item]));
    const overridesByState = new Map<string, EnvironmentMappingInput[]>();
    for (const override of overrides) {
        const stateOverrides = overridesByState.get(override.stateId) ?? [];
        stateOverrides.push(override);
        overridesByState.set(override.stateId, stateOverrides);
    }

    for (const { descriptor, classification } of entries) {
        if (!descriptor.read) {
            continue;
        }
        const automaticKey = TYPE_TO_KEY[classification.type];
        const keys = new Set<EnvironmentKey>([
            ...(automaticKey ? [automaticKey] : []),
            ...(overridesByState.get(descriptor.id)?.map(item => item.key) ?? []),
        ]);
        for (const key of keys) {
            const kind = sourceKind(descriptor);
            const override = overrideByPair.get(`${key}\0${descriptor.id}`);
            const sourceWeight = kind === 'physical' ? 0.3 : kind === 'weather' ? 0.2 : kind === 'derived' ? 0.1 : 0;
            const priorityWeight = override ? Math.max(-0.5, Math.min(0.5, override.priority / 200)) : 0;
            const semanticWeight = key === automaticKey ? classification.confidence : 0.55;
            result[key].push({
                key,
                stateId: descriptor.id,
                score: Number(Math.min(1.5, semanticWeight + sourceWeight + priorityWeight).toFixed(3)),
                sourceKind: kind,
                selected: false,
                pinned: override?.pinned === true,
            });
        }
    }

    for (const key of ENVIRONMENT_KEYS) {
        result[key].sort(
            (a, b) => Number(b.pinned) - Number(a.pinned) || b.score - a.score || a.stateId.localeCompare(b.stateId),
        );
        if (result[key][0]) {
            result[key][0].selected = true;
        }
    }
    return result;
}
