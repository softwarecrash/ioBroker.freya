import type { LearnedPattern } from '../patterns/types';
import { ActivityStore } from './activityStore';
import type { PatternSuggestion, SuggestionStatus, SuggestionSummary, TransitionResult } from './types';

function conditionText(pattern: LearnedPattern): string {
    if (!pattern.conditions.length) {
        return 'without an additional context condition';
    }
    return pattern.conditions.map(condition => `${condition.feature} = ${String(condition.value)}`).join(' and ');
}

function explanation(pattern: LearnedPattern): string {
    const seconds = Math.round(pattern.actionWindowMs / 1_000);
    const percent = Math.round(pattern.confidence * 100);
    const components = pattern.confidenceComponents;
    return `When the trigger becomes ${String(pattern.expectedAction)}, the light usually becomes ${String(pattern.expectedAction)} within ${seconds} seconds ${conditionText(pattern)} (${pattern.matches}/${pattern.opportunities}, confidence ${percent}%; match ${Math.round(components.smoothedMatchRate * 100)}%, maturity ${Math.round(components.sampleMaturity * 100)}%, repeatability ${Math.round(components.repeatability * 100)}%, recency ${Math.round(components.recency * 100)}%).`;
}

function copySuggestion(suggestion: PatternSuggestion): PatternSuggestion {
    return {
        ...suggestion,
        rooms: [...suggestion.rooms],
        conditions: suggestion.conditions.map(condition => ({ ...condition })),
        confidenceComponents: { ...suggestion.confidenceComponents },
    };
}

/** Creates rules-only suggestions and enforces their non-executing lifecycle. */
export class SuggestionService {
    private readonly suggestions = new Map<string, PatternSuggestion>();
    private readonly maximum: number;

    public constructor(
        private readonly activity = new ActivityStore(),
        maximum = 200,
    ) {
        this.maximum = Math.max(10, Math.min(maximum, 1_000));
    }

    public synchronize(patterns: LearnedPattern[], timestamp: number): void {
        const candidates = new Map(
            patterns
                .filter(pattern => pattern.status === 'candidate' && pattern.suggestionEligible)
                .map(pattern => [pattern.id, pattern]),
        );
        for (const [id, suggestion] of this.suggestions) {
            const pattern = candidates.get(id);
            if (!pattern) {
                if (suggestion.status === 'candidate') {
                    this.suggestions.delete(id);
                    this.activity.append({
                        timestamp,
                        type: 'candidate_withdrawn',
                        patternId: id,
                        actor: 'system',
                        outcome: 'accepted',
                        previousStatus: 'candidate',
                        reason: 'pattern_no_longer_eligible',
                    });
                } else {
                    suggestion.eligible = false;
                    suggestion.updatedAt = timestamp;
                }
                continue;
            }
            this.updateSuggestion(suggestion, pattern, timestamp);
            candidates.delete(id);
        }
        for (const pattern of candidates.values()) {
            if (!this.ensureCapacity()) {
                break;
            }
            const suggestion = this.fromPattern(pattern, timestamp);
            this.suggestions.set(pattern.id, suggestion);
            this.activity.append({
                timestamp,
                type: 'candidate_created',
                patternId: pattern.id,
                actor: 'system',
                outcome: 'accepted',
                newStatus: 'candidate',
                reason: 'candidate_threshold_reached',
            });
        }
    }

    public transition(patternId: string, status: SuggestionStatus, actor: string, timestamp: number): TransitionResult {
        const suggestion = this.suggestions.get(patternId);
        if (!suggestion) {
            return this.reject(patternId, actor, timestamp, 'pattern_not_found');
        }
        if (suggestion.status === status) {
            return { accepted: true, changed: false, reason: 'no_change', suggestion: copySuggestion(suggestion) };
        }
        const valid =
            (suggestion.status === 'candidate' && (status === 'approved' || status === 'disabled')) ||
            (suggestion.status === 'approved' && status === 'disabled') ||
            (suggestion.status === 'disabled' && status === 'candidate' && suggestion.eligible);
        if (!valid) {
            return this.reject(
                patternId,
                actor,
                timestamp,
                suggestion.eligible ? 'invalid_transition' : 'pattern_ineligible',
            );
        }
        const previousStatus = suggestion.status;
        suggestion.status = status;
        suggestion.updatedAt = timestamp;
        this.activity.append({
            timestamp,
            type: 'status_changed',
            patternId,
            actor: actor.slice(0, 120),
            outcome: 'accepted',
            previousStatus,
            newStatus: status,
            reason: 'explicit_user_transition',
        });
        return { accepted: true, changed: true, reason: 'status_changed', suggestion: copySuggestion(suggestion) };
    }

    public rejectCommand(patternId: string, actor: string, reason: string, timestamp: number): TransitionResult {
        return this.reject(patternId, actor, timestamp, reason);
    }

    public list(
        status: SuggestionStatus | undefined,
        page = 0,
        pageSize = 50,
    ): { page: number; pageSize: number; total: number; items: PatternSuggestion[] } {
        const boundedPage = Math.max(0, Math.floor(page));
        const boundedSize = Math.max(1, Math.min(Math.floor(pageSize), 100));
        const items = [...this.suggestions.values()]
            .filter(suggestion => !status || suggestion.status === status)
            .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
        const start = boundedPage * boundedSize;
        return {
            page: boundedPage,
            pageSize: boundedSize,
            total: items.length,
            items: items.slice(start, start + boundedSize).map(copySuggestion),
        };
    }

    public activityPage(page = 0, pageSize = 50): ReturnType<ActivityStore['page']> {
        return this.activity.page(page, pageSize);
    }

    public summary(): SuggestionSummary {
        const suggestions = [...this.suggestions.values()];
        const activity = this.activity.summary();
        return {
            candidates: suggestions.filter(item => item.status === 'candidate').length,
            approved: suggestions.filter(item => item.status === 'approved').length,
            disabled: suggestions.filter(item => item.status === 'disabled').length,
            ineligible: suggestions.filter(item => !item.eligible).length,
            activityCount: activity.count,
            lastActivityTimestamp: activity.lastTimestamp,
        };
    }

    public latestExplanation(): string {
        return this.list(undefined, 0, 1).items[0]?.explanation ?? 'none';
    }

    public find(patternId: string): PatternSuggestion | undefined {
        const suggestion = this.suggestions.get(patternId);
        return suggestion ? copySuggestion(suggestion) : undefined;
    }

    /** Export restart-safe suggestions, including explicit approval state. */
    public snapshot(): PatternSuggestion[] {
        return [...this.suggestions.values()].map(copySuggestion);
    }

    /** Restore validated suggestions before synchronizing them with current evidence. */
    public restore(suggestions: PatternSuggestion[]): number {
        this.suggestions.clear();
        for (const suggestion of suggestions.slice(-this.maximum)) {
            this.suggestions.set(suggestion.id, copySuggestion(suggestion));
        }
        return this.suggestions.size;
    }

    private fromPattern(pattern: LearnedPattern, timestamp: number): PatternSuggestion {
        return {
            id: pattern.id,
            patternId: pattern.id,
            status: 'candidate',
            eligible: true,
            triggerStateId: pattern.triggerStateId,
            actionStateId: pattern.actionStateId,
            expectedAction: pattern.expectedAction,
            rooms: [...pattern.rooms],
            conditions: pattern.conditions.map(condition => ({ ...condition })),
            opportunities: pattern.opportunities,
            matches: pattern.matches,
            confidence: pattern.confidence,
            confidenceComponents: { ...pattern.confidenceComponents },
            actionWindowMs: pattern.actionWindowMs,
            explanation: explanation(pattern),
            createdAt: timestamp,
            updatedAt: timestamp,
        };
    }

    private updateSuggestion(suggestion: PatternSuggestion, pattern: LearnedPattern, timestamp: number): void {
        const refreshed = this.fromPattern(pattern, suggestion.createdAt);
        Object.assign(suggestion, refreshed, { status: suggestion.status, eligible: true, updatedAt: timestamp });
    }

    private reject(patternId: string, actor: string, timestamp: number, reason: string): TransitionResult {
        this.activity.append({
            timestamp,
            type: 'status_rejected',
            patternId: patternId.slice(0, 80),
            actor: actor.slice(0, 120),
            outcome: 'rejected',
            reason,
        });
        return { accepted: false, changed: false, reason };
    }

    private ensureCapacity(): boolean {
        if (this.suggestions.size < this.maximum) {
            return true;
        }
        const removable = [...this.suggestions.values()]
            .filter(suggestion => suggestion.status !== 'approved')
            .sort((left, right) => left.updatedAt - right.updatedAt)[0];
        if (removable) {
            this.suggestions.delete(removable.id);
            return true;
        }
        return false;
    }
}
