import { createHash } from 'node:crypto';
import type { Observation } from '../observation/types';
import { calculateConfidence } from './confidence';
import { extractPatternFeatures } from './features';
import { selectPatternFeatures } from './featureSelection';
import type { LearnableState, LearnedPattern, PatternExample, PatternSummary, PendingOpportunity } from './types';

const DAY_MS = 24 * 60 * 60 * 1_000;
const TRIGGER_TYPES = new Set(['motion', 'presence', 'contact', 'switch']);

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
        if (observation.previousValue === observation.value) {
            return;
        }
        if (TRIGGER_TYPES.has(state.semanticType) && (observation.value || state.semanticType === 'presence')) {
            this.createOpportunities(state, observation, observation.value);
        }
        if (state.semanticType === 'light') {
            this.matchAction(state, observation.timestamp, observation.value);
        }
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
        const selection = selectPatternFeatures(record.examples);
        const selectedExamples = selection.conditions.length
            ? record.examples.filter(example =>
                  selection.conditions.every(
                      condition => example.features.values[condition.feature] === condition.value,
                  ),
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
            id: createHash('sha256').update(key).digest('hex').slice(0, 16),
            triggerStateId: record.trigger.id,
            actionStateId: record.action.id,
            expectedAction: record.expectedAction,
            actionWindowMs: this.actionWindowMs,
            suggestionEligible: record.trigger.canSuggest === true && record.action.canSuggest === true,
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
