import { copyFile, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PatternFeatureKey, PatternFeatureValue, PersistedPatternRecord } from '../patterns/types';
import type { PatternSuggestion } from '../suggestions/types';

export interface LearningSnapshot {
    patterns: PersistedPatternRecord[];
    suggestions: PatternSuggestion[];
}

interface PersistedDocument extends LearningSnapshot {
    schemaVersion: 1;
}

const FEATURE_KEYS = new Set<PatternFeatureKey>([
    'time.halfHour',
    'time.weekend',
    'location.room',
    'sun.elevationBand',
    'sun.sunriseOffset',
    'sun.sunsetOffset',
    'room.illuminanceBand',
    'environment.illuminanceBand',
    'environment.temperatureBand',
    'presence.home',
]);

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function boundedString(value: unknown, maximum: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function featureValue(value: unknown): value is PatternFeatureValue {
    return typeof value === 'boolean' || typeof value === 'string' || finite(value);
}

function featureValues(value: unknown): value is Partial<Record<PatternFeatureKey, PatternFeatureValue>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    return Object.entries(value).every(
        ([key, item]) => FEATURE_KEYS.has(key as PatternFeatureKey) && featureValue(item),
    );
}

function rooms(value: unknown): value is string[] {
    return (
        Array.isArray(value) &&
        value.length <= 20 &&
        value.every(room => typeof room === 'string' && room.length > 0 && room.length <= 120)
    );
}

function validPattern(value: unknown): value is PersistedPatternRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Partial<PersistedPatternRecord>;
    return (
        boundedString(record.key, 1_100) &&
        boundedString(record.triggerStateId, 500) &&
        boundedString(record.actionStateId, 500) &&
        rooms(record.rooms) &&
        Array.isArray(record.examples) &&
        record.examples.length <= 2_000 &&
        record.examples.every(
            example =>
                typeof example === 'object' &&
                example !== null &&
                finite(example.timestamp) &&
                typeof example.matched === 'boolean' &&
                typeof example.features === 'object' &&
                example.features !== null &&
                featureValues(example.features.values),
        ) &&
        finite(record.firstSeen) &&
        finite(record.lastSeen) &&
        finite(record.positiveFeedback) &&
        finite(record.negativeFeedback) &&
        typeof record.expectedAction === 'boolean'
    );
}

function validSuggestion(value: unknown): value is PatternSuggestion {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const suggestion = value as Partial<PatternSuggestion>;
    const components = suggestion.confidenceComponents;
    return (
        typeof suggestion.id === 'string' &&
        /^[a-f0-9]{16}$/.test(suggestion.id) &&
        suggestion.patternId === suggestion.id &&
        ['candidate', 'approved', 'disabled'].includes(String(suggestion.status)) &&
        typeof suggestion.eligible === 'boolean' &&
        boundedString(suggestion.triggerStateId, 500) &&
        boundedString(suggestion.actionStateId, 500) &&
        typeof suggestion.expectedAction === 'boolean' &&
        rooms(suggestion.rooms) &&
        Array.isArray(suggestion.conditions) &&
        suggestion.conditions.length <= 10 &&
        suggestion.conditions.every(
            condition =>
                typeof condition === 'object' &&
                condition !== null &&
                FEATURE_KEYS.has(condition.feature) &&
                featureValue(condition.value),
        ) &&
        finite(suggestion.opportunities) &&
        finite(suggestion.matches) &&
        finite(suggestion.confidence) &&
        typeof components === 'object' &&
        components !== null &&
        finite(components.smoothedMatchRate) &&
        finite(components.sampleMaturity) &&
        finite(components.repeatability) &&
        finite(components.recency) &&
        finite(components.feedbackAdjustment) &&
        finite(suggestion.actionWindowMs) &&
        typeof suggestion.explanation === 'string' &&
        suggestion.explanation.length <= 4_000 &&
        finite(suggestion.createdAt) &&
        finite(suggestion.updatedAt)
    );
}

function copySnapshot(snapshot: LearningSnapshot): LearningSnapshot {
    return {
        patterns: snapshot.patterns.map(pattern => ({
            ...pattern,
            rooms: [...pattern.rooms],
            examples: pattern.examples.map(example => ({
                ...example,
                features: { values: { ...example.features.values } },
            })),
        })),
        suggestions: snapshot.suggestions.map(suggestion => ({
            ...suggestion,
            rooms: [...suggestion.rooms],
            conditions: suggestion.conditions.map(condition => ({ ...condition })),
            confidenceComponents: { ...suggestion.confidenceComponents },
        })),
    };
}

function decode(body: string): LearningSnapshot {
    let value: Partial<PersistedDocument>;
    try {
        value = JSON.parse(body) as Partial<PersistedDocument>;
    } catch {
        throw new Error('learning_repository_json_invalid');
    }
    if (
        value.schemaVersion !== 1 ||
        !Array.isArray(value.patterns) ||
        value.patterns.length > 1_000 ||
        !value.patterns.every(validPattern) ||
        !Array.isArray(value.suggestions) ||
        value.suggestions.length > 1_000 ||
        !value.suggestions.every(validSuggestion)
    ) {
        throw new Error('learning_repository_schema_invalid');
    }
    return copySnapshot({ patterns: value.patterns, suggestions: value.suggestions });
}

/** Atomic schema-versioned persistence for learned evidence and approval state. */
export class LearningRepository {
    private queue: Promise<void> = Promise.resolve();

    public constructor(private readonly filename: string) {}

    public async load(): Promise<LearningSnapshot> {
        try {
            return decode(await readFile(this.filename, 'utf8'));
        } catch (primaryError) {
            if ((primaryError as NodeJS.ErrnoException).code === 'ENOENT') {
                return { patterns: [], suggestions: [] };
            }
            try {
                return decode(await readFile(`${this.filename}.bak`, 'utf8'));
            } catch {
                throw primaryError;
            }
        }
    }

    public save(snapshot: LearningSnapshot): Promise<void> {
        const safeCopy = copySnapshot(snapshot);
        const operation = this.queue.then(() => this.persist(safeCopy));
        this.queue = operation.catch(() => undefined);
        return operation;
    }

    private async persist(snapshot: LearningSnapshot): Promise<void> {
        await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 });
        const temporary = `${this.filename}.tmp`;
        const backup = `${this.filename}.bak`;
        const body = `${JSON.stringify({ schemaVersion: 1, ...snapshot } satisfies PersistedDocument)}\n`;
        const file = await open(temporary, 'w', 0o600);
        try {
            await file.writeFile(body, 'utf8');
            await file.sync();
        } finally {
            await file.close();
        }
        try {
            await copyFile(this.filename, backup);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
        await rename(temporary, this.filename);
    }
}
