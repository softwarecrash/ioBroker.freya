import { createHash } from 'node:crypto';
import type { Observation } from '../observation/types';
import { calculateConfidence } from './confidence';
import { extractPatternFeatures } from './features';
import { matchesCondition, selectPatternFeatures } from './featureSelection';
import type {
    LearnableState,
    LearnedPattern,
    PatternExample,
    PatternCondition,
    PatternHypothesis,
    PatternSummary,
    PendingOpportunity,
    PersistedPatternRecord,
} from './types';
import type { LlmPatternInput } from '../llm/types';

const DAY_MS = 24 * 60 * 60 * 1_000;
const TRIGGER_TYPES = new Set(['motion', 'presence', 'contact', 'switch']);
const NON_BEHAVIORAL_ORIGINS = new Set(['self', 'external-command', 'confirmation']);
const ADVISORY_FEATURES = [
    'room.illuminanceBand',
    'sun.elevationBand',
    'sun.sunsetOffset',
    'sun.sunriseOffset',
    'time.halfHour',
    'time.weekend',
    'environment.illuminanceBand',
    'environment.temperatureBand',
    'presence.home',
] as const;

interface CandidateRecord {
    trigger: LearnableState;
    action: LearnableState;
    rooms: string[];
    examples: PatternExample[];
    firstSeen: number;
    lastSeen: number;
    positiveFeedback: number;
    negativeFeedback: number;
    expectedAction: boolean;
    llmHypothesis?: PatternHypothesis;
    llmFinding?: { summary: string; analyzedAt: number };
}

export interface PatternEngineOptions {
    enabled: boolean;
    actionWindowMs?: number;
    maxPatterns?: number;
    maxPendingOpportunities?: number;
    maxExamplesPerPattern?: number;
    inactiveRetentionMs?: number;
}

/** Learns bounded, explainable trigger-to-light candidates without performing actions. */
export class PatternEngine {
    private readonly states = new Map<string, LearnableState>();
    private readonly latestBooleanValues = new Map<string, boolean>();
    private readonly records = new Map<string, CandidateRecord>();
    private readonly pending = new Map<string, PendingOpportunity>();
    private lastEvaluationTimestamp = 0;
    private readonly actionWindowMs: number;
    private readonly maxPatterns: number;
    private readonly maxPending: number;
    private readonly maxExamples: number;
    private readonly inactiveRetentionMs: number;

    public constructor(
        states: LearnableState[],
        private readonly options: PatternEngineOptions,
    ) {
        for (const state of states) {
            this.states.set(state.id, state);
        }
        this.actionWindowMs = Math.max(5_000, Math.min(options.actionWindowMs ?? 120_000, 10 * 60_000));
        this.maxPatterns = Math.max(10, Math.min(options.maxPatterns ?? 200, 1_000));
        this.maxPending = Math.max(10, Math.min(options.maxPendingOpportunities ?? 500, 5_000));
        this.maxExamples = Math.max(20, Math.min(options.maxExamplesPerPattern ?? 500, 2_000));
        this.inactiveRetentionMs = Math.max(DAY_MS, options.inactiveRetentionMs ?? 90 * DAY_MS);
    }

    public observe(observation: Observation): void {
        if (!this.options.enabled) {
            return;
        }
        this.flush(observation.timestamp);
        const state = this.states.get(observation.stateId);
        if (!state || state.valueType !== 'boolean' || observation.deleted || typeof observation.value !== 'boolean') {
            return;
        }
        if (observation.attribution && NON_BEHAVIORAL_ORIGINS.has(observation.attribution.kind)) {
            this.latestBooleanValues.set(state.id, observation.value);
            return;
        }
        if (observation.previousValue === observation.value) {
            this.latestBooleanValues.set(state.id, observation.value);
            return;
        }
        if (TRIGGER_TYPES.has(state.semanticType) && (observation.value || state.semanticType === 'presence')) {
            this.createOpportunities(state, observation, observation.value);
        }
        if (state.semanticType === 'light') {
            this.matchAction(state, observation.timestamp, observation.value);
        }
        this.latestBooleanValues.set(state.id, observation.value);
    }

    public flush(timestamp: number): void {
        for (const [key, opportunity] of this.pending) {
            if (opportunity.expiresAt <= timestamp) {
                this.retainExample(opportunity, false);
                this.pending.delete(key);
            }
        }
        for (const [key, record] of this.records) {
            if (record.lastSeen + this.inactiveRetentionMs < timestamp) {
                this.records.delete(key);
                this.pending.delete(key);
            }
        }
        this.lastEvaluationTimestamp = Math.max(this.lastEvaluationTimestamp, timestamp);
    }

    public patterns(now = Date.now()): LearnedPattern[] {
        this.flush(now);
        return [...this.records.entries()]
            .map(([key, record]) => this.toPattern(key, record, now))
            .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id));
    }

    /** Summarize bounded, non-identifying context evidence for a selected advisory analysis. */
    public advisoryEvidence(
        patternId: string,
    ):
        | Pick<LlmPatternInput, 'triggerType' | 'targetType' | 'expectedAction' | 'distinctDays' | 'evidence'>
        | undefined {
        const record = [...this.records.entries()].find(([key]) => this.patternId(key) === patternId)?.[1];
        if (!record) {
            return undefined;
        }
        const evidence: NonNullable<LlmPatternInput['evidence']> = [];
        for (const feature of ADVISORY_FEATURES) {
            const buckets = new Map<string, NonNullable<LlmPatternInput['evidence']>[number]>();
            for (const example of record.examples) {
                const raw = example.features.values[feature];
                if (raw === undefined) {
                    continue;
                }
                const value =
                    (feature === 'sun.sunsetOffset' || feature === 'sun.sunriseOffset') && typeof raw === 'number'
                        ? Math.round(raw / 30) * 30
                        : raw;
                if (typeof value === 'string' && !/^[a-z0-9_-]{1,30}$/i.test(value)) {
                    continue;
                }
                const key = `${typeof value}:${String(value)}`;
                const bucket = buckets.get(key) ?? { feature, value, opportunities: 0, matches: 0 };
                bucket.opportunities++;
                bucket.matches += Number(example.matched);
                buckets.set(key, bucket);
            }
            evidence.push(
                ...[...buckets.values()]
                    .filter(bucket => bucket.opportunities >= 5)
                    .sort((a, b) => b.matches - a.matches || b.opportunities - a.opportunities)
                    .slice(0, 3),
            );
        }
        return {
            triggerType: record.trigger.semanticType,
            targetType: record.action.semanticType,
            expectedAction: record.expectedAction,
            distinctDays: new Set(record.examples.map(example => Math.floor(example.timestamp / DAY_MS))).size,
            evidence: evidence.slice(0, 20),
        };
    }

    /** The model requests a test; only future independent observations can validate it. */
    public setLlmHypothesis(
        patternId: string,
        hypothesis: Omit<PatternHypothesis, 'createdAt'>,
        now = Date.now(),
    ): boolean {
        const record = [...this.records.entries()].find(([key]) => this.patternId(key) === patternId)?.[1];
        if (!record || !ADVISORY_FEATURES.some(feature => feature === hypothesis.feature)) {
            return false;
        }
        if (record.llmHypothesis?.feature === hypothesis.feature && record.llmHypothesis.value === hypothesis.value) {
            return true;
        }
        record.llmHypothesis = { ...hypothesis, createdAt: now };
        return true;
    }

    public setLlmFinding(patternId: string, summary: string, now = Date.now()): boolean {
        const record = [...this.records.entries()].find(([key]) => this.patternId(key) === patternId)?.[1];
        if (!record || !summary.trim()) {
            return false;
        }
        record.llmFinding = { summary: summary.trim().slice(0, 500), analyzedAt: now };
        return true;
    }

    public llmFinding(patternId: string): string | undefined {
        const record = [...this.records.entries()].find(([key]) => this.patternId(key) === patternId)?.[1];
        return record?.llmFinding?.summary;
    }

    public hypothesisStatus(patternId: string): string {
        const record = [...this.records.entries()].find(([key]) => this.patternId(key) === patternId)?.[1];
        const hypothesis = record?.llmHypothesis;
        if (!record || !hypothesis) {
            return '—';
        }
        const recent = record.examples.filter(example => example.timestamp > hypothesis.createdAt);
        const selected = recent.filter(example => this.matchesHypothesis(example, hypothesis));
        const matches = selected.filter(example => example.matched).length;
        const days = new Set(selected.map(example => Math.floor(example.timestamp / DAY_MS))).size;
        const baseline = recent.length ? recent.filter(example => example.matched).length / recent.length : 0;
        const branch = selected.length ? matches / selected.length : 0;
        const label = `${hypothesis.feature} = ${String(hypothesis.value)}: ${matches}/${selected.length} (${recent.length} neu)`;
        if (recent.length < 20 || selected.length < 8 || days < 3) {
            return `Prüfung läuft · ${label}`;
        }
        return branch >= baseline + 0.15 && matches >= 5 ? `Bestätigt · ${label}` : `Nicht bestätigt · ${label}`;
    }

    private matchesHypothesis(example: PatternExample, hypothesis: PatternHypothesis): boolean {
        const raw = example.features.values[hypothesis.feature];
        const value =
            (hypothesis.feature === 'sun.sunsetOffset' || hypothesis.feature === 'sun.sunriseOffset') &&
            typeof raw === 'number'
                ? Math.round(raw / 30) * 30
                : raw;
        return value === hypothesis.value;
    }

    private validatedHypothesis(record: CandidateRecord): PatternCondition | undefined {
        const hypothesis = record.llmHypothesis;
        if (!hypothesis) {
            return undefined;
        }
        const recent = record.examples.filter(example => example.timestamp > hypothesis.createdAt);
        const selected = recent.filter(example => this.matchesHypothesis(example, hypothesis));
        const days = new Set(selected.map(example => Math.floor(example.timestamp / DAY_MS))).size;
        if (
            recent.length < 20 ||
            selected.length < 8 ||
            days < 3 ||
            selected.filter(example => example.matched).length < 5
        ) {
            return undefined;
        }
        const baseline = recent.filter(example => example.matched).length / recent.length;
        const branch = selected.filter(example => example.matched).length / selected.length;
        if (branch < baseline + 0.15) {
            return undefined;
        }
        return {
            feature: hypothesis.feature,
            value: hypothesis.value,
            ...(hypothesis.feature === 'sun.sunsetOffset' || hypothesis.feature === 'sun.sunriseOffset'
                ? { bucketMinutes: 30 as const }
                : {}),
        };
    }

    public summary(now = Date.now()): PatternSummary {
        const patterns = this.patterns(now);
        return {
            enabled: this.options.enabled,
            learningPatterns: patterns.filter(pattern => pattern.status === 'learning').length,
            candidates: patterns.filter(pattern => pattern.status === 'candidate').length,
            pendingOpportunities: this.pending.size,
            retainedExamples: [...this.records.values()].reduce((sum, record) => sum + record.examples.length, 0),
            lastEvaluationTimestamp: this.lastEvaluationTimestamp,
        };
    }

    public setFeedbackCounts(patternId: string, positive: number, negative: number): boolean {
        for (const [key, record] of this.records) {
            if (createHash('sha256').update(key).digest('hex').slice(0, 16) === patternId) {
                record.positiveFeedback = Math.max(0, Math.min(positive, 1_000));
                record.negativeFeedback = Math.max(0, Math.min(negative, 1_000));
                return true;
            }
        }
        return false;
    }

    /** Keep the relationship but discard all evidence so it must mature again from zero. */
    public resetPattern(patternId: string, timestamp = Date.now()): boolean {
        for (const [key, record] of this.records) {
            if (this.patternId(key) !== patternId) {
                continue;
            }
            record.examples = [];
            record.firstSeen = timestamp;
            record.lastSeen = timestamp;
            record.positiveFeedback = 0;
            record.negativeFeedback = 0;
            record.llmHypothesis = undefined;
            record.llmFinding = undefined;
            this.pending.delete(key);
            this.lastEvaluationTimestamp = Math.max(this.lastEvaluationTimestamp, timestamp);
            return true;
        }
        return false;
    }

    /** Remove the learned relationship. Future observations may discover it again. */
    public deletePattern(patternId: string): boolean {
        for (const key of this.records.keys()) {
            if (this.patternId(key) !== patternId) {
                continue;
            }
            this.records.delete(key);
            this.pending.delete(key);
            return true;
        }
        return false;
    }

    /** Export bounded learning evidence. Pending action windows are deliberately excluded. */
    public snapshot(): PersistedPatternRecord[] {
        return [...this.records.entries()].map(([key, record]) => ({
            key,
            triggerStateId: record.trigger.id,
            actionStateId: record.action.id,
            rooms: [...record.rooms],
            examples: record.examples.map(example => ({
                timestamp: example.timestamp,
                matched: example.matched,
                features: { values: { ...example.features.values } },
            })),
            firstSeen: record.firstSeen,
            lastSeen: record.lastSeen,
            positiveFeedback: record.positiveFeedback,
            negativeFeedback: record.negativeFeedback,
            expectedAction: record.expectedAction,
            ...(record.llmHypothesis ? { llmHypothesis: { ...record.llmHypothesis } } : {}),
            ...(record.llmFinding ? { llmFinding: { ...record.llmFinding } } : {}),
        }));
    }

    /** Restore validated evidence only when both configured states still match the record. */
    public restore(records: PersistedPatternRecord[]): number {
        let restored = 0;
        for (const persisted of records.slice(-this.maxPatterns)) {
            const trigger = this.states.get(persisted.triggerStateId);
            const action = this.states.get(persisted.actionStateId);
            const expectedKey = `${persisted.triggerStateId}\u0000${persisted.actionStateId}\u0000${String(persisted.expectedAction)}`;
            if (
                !trigger ||
                !action ||
                action.semanticType !== 'light' ||
                action.valueType !== 'boolean' ||
                persisted.key !== expectedKey
            ) {
                continue;
            }
            const rooms = persisted.rooms.filter(room => trigger.rooms.includes(room) && action.rooms.includes(room));
            if (!rooms.length) {
                continue;
            }
            this.records.set(persisted.key, {
                trigger,
                action,
                rooms: rooms.slice(0, 20),
                examples: persisted.examples.slice(-this.maxExamples).map(example => ({
                    timestamp: example.timestamp,
                    matched: example.matched,
                    features: { values: { ...example.features.values } },
                })),
                firstSeen: persisted.firstSeen,
                lastSeen: persisted.lastSeen,
                positiveFeedback: Math.max(0, Math.min(persisted.positiveFeedback, 1_000)),
                negativeFeedback: Math.max(0, Math.min(persisted.negativeFeedback, 1_000)),
                expectedAction: persisted.expectedAction,
                llmHypothesis: persisted.llmHypothesis ? { ...persisted.llmHypothesis } : undefined,
                llmFinding: persisted.llmFinding ? { ...persisted.llmFinding } : undefined,
            });
            this.lastEvaluationTimestamp = Math.max(this.lastEvaluationTimestamp, persisted.lastSeen);
            restored++;
        }
        return restored;
    }

    private createOpportunities(trigger: LearnableState, observation: Observation, expectedAction: boolean): void {
        for (const action of this.states.values()) {
            if (action.semanticType !== 'light' || action.valueType !== 'boolean' || action.id === trigger.id) {
                continue;
            }
            const rooms = trigger.rooms.filter(room => action.rooms.includes(room));
            if (!rooms.length) {
                continue;
            }
            const key = `${trigger.id}\u0000${action.id}\u0000${String(expectedAction)}`;
            const contextualValue = observation.context?.states?.[action.id];
            const currentActionValue =
                typeof contextualValue === 'boolean' ? contextualValue : this.latestBooleanValues.get(action.id);
            if (currentActionValue === expectedAction) {
                // The desired state already exists, so this trigger cannot reveal whether an action would follow.
                // In particular, repeated presence pulses while a light remains on must not become failures.
                this.pending.delete(key);
                continue;
            }
            const previous = this.pending.get(key);
            if (previous) {
                this.retainExample(previous, false);
            }
            if (!previous && this.pending.size >= this.maxPending) {
                const oldestKey = this.pending.keys().next().value;
                if (oldestKey !== undefined) {
                    this.pending.delete(oldestKey);
                }
            }
            this.pending.set(key, {
                key,
                triggerStateId: trigger.id,
                actionStateId: action.id,
                expectedAction,
                timestamp: observation.timestamp,
                expiresAt: observation.timestamp + this.actionWindowMs,
                rooms,
                context: observation.context,
            });
        }
    }

    private matchAction(action: LearnableState, timestamp: number, observedValue: boolean): void {
        for (const [key, opportunity] of this.pending) {
            if (
                opportunity.actionStateId === action.id &&
                opportunity.expectedAction === observedValue &&
                opportunity.timestamp <= timestamp
            ) {
                this.retainExample(opportunity, true);
                this.pending.delete(key);
            }
        }
    }

    private retainExample(opportunity: PendingOpportunity, matched: boolean): void {
        const trigger = this.states.get(opportunity.triggerStateId);
        const action = this.states.get(opportunity.actionStateId);
        if (!trigger || !action) {
            return;
        }
        let record = this.records.get(opportunity.key);
        if (!record) {
            if (this.records.size >= this.maxPatterns) {
                const oldest = [...this.records.entries()].sort(
                    (left, right) => left[1].lastSeen - right[1].lastSeen,
                )[0];
                if (oldest) {
                    this.records.delete(oldest[0]);
                }
            }
            record = {
                trigger,
                action,
                rooms: opportunity.rooms,
                examples: [],
                firstSeen: opportunity.timestamp,
                lastSeen: opportunity.timestamp,
                positiveFeedback: 0,
                negativeFeedback: 0,
                expectedAction: opportunity.expectedAction,
            };
            this.records.set(opportunity.key, record);
        }
        if (record.examples.some(example => example.timestamp === opportunity.timestamp)) {
            return;
        }
        record.examples.push({
            timestamp: opportunity.timestamp,
            matched,
            features: extractPatternFeatures(
                opportunity.context,
                opportunity.rooms,
                this.localIlluminance(opportunity),
            ),
        });
        if (record.examples.length > this.maxExamples) {
            record.examples.splice(0, record.examples.length - this.maxExamples);
        }
        record.lastSeen = opportunity.timestamp;
        this.lastEvaluationTimestamp = Math.max(this.lastEvaluationTimestamp, opportunity.timestamp);
    }

    private toPattern(key: string, record: CandidateRecord, now: number): LearnedPattern {
        const selection = selectPatternFeatures(record.examples, { extraCondition: this.validatedHypothesis(record) });
        const selectedExamples = selection.conditions.length
            ? record.examples.filter(example =>
                  selection.conditions.every(condition => matchesCondition(example, condition)),
              )
            : record.examples;
        const matches = selectedExamples.filter(example => example.matched).length;
        const distinctDays = new Set(selectedExamples.map(example => Math.floor(example.timestamp / DAY_MS))).size;
        const result = calculateConfidence({
            opportunities: selectedExamples.length,
            matches,
            distinctDays,
            positiveFeedback: record.positiveFeedback,
            negativeFeedback: record.negativeFeedback,
            lastSeen: record.lastSeen,
            now,
        });
        const status =
            selectedExamples.length >= 8 && matches >= 5 && distinctDays >= 3 && result.confidence >= 0.58
                ? 'candidate'
                : 'learning';
        const conditions = selection.conditions.map(condition => `${condition.feature} = ${String(condition.value)}`);
        return {
            id: this.patternId(key),
            triggerStateId: record.trigger.id,
            actionStateId: record.action.id,
            expectedAction: record.expectedAction,
            actionWindowMs: this.actionWindowMs,
            suggestionEligible: record.action.canBeSuggested === true,
            rooms: [...record.rooms],
            conditions: selection.conditions,
            opportunities: selectedExamples.length,
            matches,
            distinctDays,
            positiveFeedback: record.positiveFeedback,
            negativeFeedback: record.negativeFeedback,
            confidence: result.confidence,
            confidenceComponents: result.components,
            heldOutImprovement: selection.heldOutImprovement,
            firstSeen: record.firstSeen,
            lastSeen: record.lastSeen,
            status,
            explanation: conditions.length
                ? `After ${record.trigger.semanticType} became ${String(record.expectedAction)}, ${record.action.semanticType} became ${String(record.expectedAction)} when ${conditions.join(' and ')}.`
                : status === 'candidate'
                  ? `After ${record.trigger.semanticType} became ${String(record.expectedAction)}, ${record.action.semanticType} reliably became ${String(record.expectedAction)} without an additional context condition.`
                  : `Still learning whether ${record.trigger.semanticType} becoming ${String(record.expectedAction)} predicts ${record.action.semanticType} becoming ${String(record.expectedAction)}.`,
        };
    }

    private patternId(key: string): string {
        return createHash('sha256').update(key).digest('hex').slice(0, 16);
    }

    private localIlluminance(opportunity: PendingOpportunity): number | undefined {
        const contextStates = opportunity.context?.states;
        if (!contextStates) {
            return undefined;
        }
        return [...this.states.values()]
            .filter(
                state =>
                    state.semanticType === 'illuminance' &&
                    state.rooms.some(room => opportunity.rooms.includes(room)) &&
                    typeof contextStates[state.id] === 'number' &&
                    Number.isFinite(contextStates[state.id]),
            )
            .sort((left, right) => left.id.localeCompare(right.id))
            .map(state => contextStates[state.id] as number)[0];
    }
}
