import type { PatternEngine } from '../patterns/patternEngine';
import type { ActionRepository } from './actionRepository';
import type { FeedbackOutcome, PersistedActionRecord } from './types';

export interface FeedbackResult {
    accepted: boolean;
    reason: string;
    record?: PersistedActionRecord;
}

/** Correlates conservatively and never upgrades an ambiguous source to user feedback. */
export class FeedbackService {
    private readonly windowMs: number;

    public constructor(
        private readonly repository: ActionRepository,
        private readonly selfSource: string,
        windowMs = 2 * 60_000,
    ) {
        this.windowMs = Math.max(5_000, Math.min(windowMs, 30 * 60_000));
    }

    public async observe(stateId: string, state: ioBroker.State, timestamp = Date.now()): Promise<void> {
        const now = Number.isFinite(timestamp) ? timestamp : Date.now();
        await this.expire(now);
        if (state.from === this.selfSource) {
            return;
        }
        const candidate = this.repository
            .pending(now, this.windowMs)
            .filter(record => record.targetStateId === stateId && !Object.is(record.expectedValue, state.val))
            .sort((left, right) => (right.completedAt ?? 0) - (left.completedAt ?? 0))[0];
        if (!candidate) {
            return;
        }
        const adminSource = /^system\.adapter\.admin\.\d+$/.test(state.from ?? '');
        await this.repository.feedback(
            candidate.correlationId,
            adminSource ? 'negative' : 'unknown',
            'implicit',
            now,
            undefined,
            adminSource ? 'opposing_admin_change' : 'ambiguous_opposing_change',
        );
    }

    public async expire(timestamp = Date.now()): Promise<void> {
        for (const record of this.repository.expired(timestamp, this.windowMs)) {
            await this.repository.feedback(
                record.correlationId,
                'neutral',
                'implicit',
                timestamp,
                undefined,
                'no_opposing_change_in_window',
            );
        }
    }

    public async explicit(
        correlationId: string,
        outcome: Exclude<FeedbackOutcome, 'unknown'>,
        actor: string,
        timestamp = Date.now(),
        reason?: string,
    ): Promise<FeedbackResult> {
        const existing = this.repository.find(correlationId);
        if (!existing) {
            return { accepted: false, reason: 'action_not_found' };
        }
        if (!existing.executed) {
            return { accepted: false, reason: 'action_not_executed', record: existing };
        }
        const record = await this.repository.feedback(correlationId, outcome, 'explicit', timestamp, actor, reason);
        return { accepted: true, reason: 'feedback_recorded', record };
    }

    public applyPersisted(engine: PatternEngine): void {
        for (const [patternId, totals] of this.repository.allTotals()) {
            engine.setFeedbackCounts(patternId, totals.positive, totals.negative);
        }
    }

    public summary(): ReturnType<ActionRepository['summary']> {
        return this.repository.summary();
    }

    public actions(page = 0, pageSize = 50): ReturnType<ActionRepository['page']> {
        return this.repository.page(page, pageSize);
    }
}
