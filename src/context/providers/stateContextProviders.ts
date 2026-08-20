import type { EnvironmentCandidate, EnvironmentKey } from '../../discovery/types';
import type {
    ContextProvider,
    ContextProviderResult,
    ContextQuality,
    ContextRequest,
    EnvironmentContext,
} from '../types';

export interface ContextStateSample {
    value: unknown;
    timestamp: number;
}

export interface ContextStateReader {
    read(stateIds: string[]): Promise<Record<string, ContextStateSample | undefined>>;
}

function provenance(
    providerId: string,
    path: string,
    sample: ContextStateSample,
    sourceId: string,
    quality: ContextQuality = 'measured',
): ContextProviderResult['provenance'] {
    return {
        [path]: {
            providerId,
            quality,
            confidence: quality === 'measured' ? 0.95 : 0.75,
            timestamp: sample.timestamp,
            sourceId,
        },
    };
}

function normalizedEnvironmentValue(key: EnvironmentKey, value: unknown): number | boolean | undefined {
    if (key === 'precipitation') {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value > 0;
        }
        return undefined;
    }
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

class MappedEnvironmentProvider implements ContextProvider {
    public constructor(
        public readonly id: string,
        private readonly reader: ContextStateReader,
        private readonly candidates: EnvironmentCandidate[],
        private readonly sourceKind?: EnvironmentCandidate['sourceKind'],
    ) {}

    public isAvailable(): Promise<boolean> {
        return Promise.resolve(
            this.candidates.some(candidate => !this.sourceKind || candidate.sourceKind === this.sourceKind),
        );
    }

    public async getContext(_request: ContextRequest): Promise<ContextProviderResult> {
        const selected = this.candidates.filter(
            candidate => candidate.selected && (!this.sourceKind || candidate.sourceKind === this.sourceKind),
        );
        const samples = await this.reader.read(selected.map(candidate => candidate.stateId));
        const environment: EnvironmentContext = {};
        const resultProvenance: ContextProviderResult['provenance'] = {};
        for (const candidate of selected) {
            const sample = samples[candidate.stateId];
            if (!sample) {
                continue;
            }
            const value = normalizedEnvironmentValue(candidate.key, sample.value);
            if (value === undefined) {
                continue;
            }
            Object.assign(environment, { [candidate.key]: value });
            Object.assign(
                resultProvenance,
                provenance(this.id, `environment.${candidate.key}`, sample, candidate.stateId),
            );
        }
        return { context: Object.keys(environment).length ? { environment } : {}, provenance: resultProvenance };
    }
}

export class EnvironmentContextProvider extends MappedEnvironmentProvider {
    public constructor(reader: ContextStateReader, candidates: EnvironmentCandidate[]) {
        super(
            'environment',
            reader,
            candidates.filter(candidate => candidate.sourceKind !== 'weather'),
        );
    }
}

export class WeatherContextProvider extends MappedEnvironmentProvider {
    public constructor(reader: ContextStateReader, candidates: EnvironmentCandidate[]) {
        super('weather', reader, candidates, 'weather');
    }
}

export class PresenceContextProvider implements ContextProvider {
    public readonly id = 'presence';

    public constructor(
        private readonly reader: ContextStateReader,
        private readonly stateIds: string[],
    ) {}

    public isAvailable(): Promise<boolean> {
        return Promise.resolve(this.stateIds.length > 0);
    }

    public async getContext(_request: ContextRequest): Promise<ContextProviderResult> {
        const samples = await this.reader.read(this.stateIds);
        const usable = this.stateIds.flatMap(stateId => {
            const sample = samples[stateId];
            return sample ? [{ stateId, sample }] : [];
        });
        if (!usable.length) {
            return { context: {}, provenance: {} };
        }
        const personsHome = usable.reduce((sum, { sample }) => {
            if (typeof sample.value === 'boolean') {
                return sum + Number(sample.value);
            }
            return typeof sample.value === 'number' && Number.isFinite(sample.value)
                ? sum + Math.max(0, Math.floor(sample.value))
                : sum;
        }, 0);
        const timestamp = Math.max(...usable.map(({ sample }) => sample.timestamp));
        const sourceId = usable.map(item => item.stateId).join(',');
        return {
            context: { presence: { home: personsHome > 0, personsHome } },
            provenance: {
                ...provenance(this.id, 'presence.home', { value: personsHome > 0, timestamp }, sourceId, 'inferred'),
                ...provenance(this.id, 'presence.personsHome', { value: personsHome, timestamp }, sourceId, 'inferred'),
            },
        };
    }
}

export class DeviceContextProvider implements ContextProvider {
    public readonly id = 'device';
    private readonly allowed: Set<string>;

    public constructor(
        private readonly reader: ContextStateReader,
        allowedStateIds: string[],
        private readonly maxStates = 25,
    ) {
        this.allowed = new Set(allowedStateIds);
    }

    public isAvailable(): Promise<boolean> {
        return Promise.resolve(this.allowed.size > 0);
    }

    public async getContext(request: ContextRequest): Promise<ContextProviderResult> {
        const requested = [...new Set(request.relatedStateIds ?? [])]
            .filter(stateId => this.allowed.has(stateId))
            .slice(0, Math.max(1, Math.min(100, this.maxStates)));
        const samples = await this.reader.read(requested);
        const states: Record<string, unknown> = {};
        const resultProvenance: ContextProviderResult['provenance'] = {};
        for (const stateId of requested) {
            const sample = samples[stateId];
            if (!sample) {
                continue;
            }
            states[stateId] = sample.value;
            Object.assign(resultProvenance, provenance(this.id, `states.${stateId}`, sample, stateId));
        }
        return { context: Object.keys(states).length ? { states } : {}, provenance: resultProvenance };
    }
}
