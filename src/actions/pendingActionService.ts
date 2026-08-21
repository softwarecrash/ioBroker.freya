import type { PatternSuggestion } from '../suggestions/types';
import type { ActionResult, FrozenActionRequest } from './types';

export type PendingActionStatus = 'pending' | 'executing' | 'executed' | 'denied' | 'rejected' | 'expired';

export interface PendingActionRecord {
    id: string;
    patternId: string;
    triggerStateId: string;
    targetStateId: string;
    value: boolean;
    rooms: string[];
    confidence: number;
    explanation: string;
    triggeredAt: number;
    contextTimestamp: number;
    expiresAt: number;
    status: PendingActionStatus;
    completedAt?: number;
    reasons?: string[];
    errorCode?: string;
}

export interface PendingActionResult {
    accepted: boolean;
    reason: string;
    record?: PendingActionRecord;
    request?: FrozenActionRequest;
}

function copy(record: PendingActionRecord): PendingActionRecord {
    return { ...record, rooms: [...record.rooms], reasons: record.reasons ? [...record.reasons] : undefined };
}

/** Bounded exactly-once queue for level-2 proposals and level-3 dispatch records. */
export class PendingActionService {
    private readonly records = new Map<string, PendingActionRecord>();
    private readonly maximum: number;
    private readonly ttlMs: number;

    public constructor(maximum = 500, ttlMs = 30_000) {
        this.maximum = Math.max(20, Math.min(maximum, 2_000));
        this.ttlMs = Math.max(5_000, Math.min(ttlMs, 120_000));
    }

    public propose(suggestion: PatternSuggestion, timestamp: number, id: string): PendingActionRecord | undefined {
        this.expire(timestamp);
        if (
            suggestion.status !== 'approved' ||
            !suggestion.eligible ||
            !this.validIdentity(id) ||
            this.hasActive(suggestion.id) ||
            !this.ensureCapacity()
        ) {
            return undefined;
        }
        const record = this.fromSuggestion(suggestion, timestamp, id, 'pending');
        this.records.set(record.id, record);
        return copy(record);
    }

    public beginAutomatic(suggestion: PatternSuggestion, timestamp: number, id: string): PendingActionResult {
        this.expire(timestamp);
        if (
            suggestion.status !== 'approved' ||
            !suggestion.eligible ||
            !this.validIdentity(id) ||
            this.hasActive(suggestion.id) ||
            !this.ensureCapacity()
        ) {
            return { accepted: false, reason: 'duplicate_or_capacity' };
        }
        const record = this.fromSuggestion(suggestion, timestamp, id, 'executing');
        this.records.set(record.id, record);
        return {
            accepted: true,
            reason: 'automatic_claimed',
            record: copy(record),
            request: this.request(record, 'automatic', timestamp),
        };
    }

    public claimOneShot(id: string, timestamp: number): PendingActionResult {
        this.expire(timestamp);
        const record = this.records.get(id);
        if (!record) {
            return { accepted: false, reason: 'pending_action_not_found' };
        }
        if (record.status !== 'pending') {
            return { accepted: false, reason: `pending_action_${record.status}`, record: copy(record) };
        }
        record.status = 'executing';
        return {
            accepted: true,
            reason: 'one_shot_claimed',
            record: copy(record),
            request: this.request(record, 'one-shot', timestamp),
        };
    }

    public reject(id: string, timestamp: number): PendingActionResult {
        this.expire(timestamp);
        const record = this.records.get(id);
        if (!record) {
            return { accepted: false, reason: 'pending_action_not_found' };
        }
        if (record.status !== 'pending') {
            return { accepted: false, reason: `pending_action_${record.status}`, record: copy(record) };
        }
        record.status = 'rejected';
        record.completedAt = timestamp;
        return { accepted: true, reason: 'pending_action_rejected', record: copy(record) };
    }

    public complete(id: string, result: ActionResult, timestamp: number): PendingActionRecord | undefined {
        const record = this.records.get(id);
        if (!record || record.status !== 'executing' || result.correlationId !== record.id) {
            return undefined;
        }
        record.status = result.executed ? 'executed' : 'denied';
        record.completedAt = timestamp;
        record.reasons = [...result.reasons];
        record.errorCode = result.errorCode?.slice(0, 80);
        return copy(record);
    }

    public restore(records: PendingActionRecord[], timestamp: number, recoverInterrupted = true): number {
        this.records.clear();
        for (const persisted of records.slice(-this.maximum)) {
            const record = copy(persisted);
            if (recoverInterrupted && record.status === 'executing') {
                record.status = 'denied';
                record.completedAt = timestamp;
                record.errorCode = 'execution_interrupted';
            } else if (recoverInterrupted && record.status === 'pending' && record.expiresAt <= timestamp) {
                record.status = 'expired';
                record.completedAt = timestamp;
            }
            this.records.set(record.id, record);
        }
        return this.records.size;
    }

    public expire(timestamp: number): number {
        let expired = 0;
        for (const record of this.records.values()) {
            if (record.status === 'pending' && record.expiresAt <= timestamp) {
                record.status = 'expired';
                record.completedAt = timestamp;
                expired++;
            }
        }
        return expired;
    }

    /** Reject proposals which can no longer be authorized after pattern removal/reset. */
    public rejectPattern(patternId: string, timestamp: number): number {
        let rejected = 0;
        for (const record of this.records.values()) {
            if (record.patternId === patternId && record.status === 'pending') {
                record.status = 'rejected';
                record.completedAt = timestamp;
                record.errorCode = 'pattern_removed';
                rejected++;
            }
        }
        return rejected;
    }

    public list(
        status: PendingActionStatus | undefined,
        page = 0,
        pageSize = 50,
    ): { page: number; pageSize: number; total: number; items: PendingActionRecord[] } {
        const boundedPage = Math.max(0, Math.floor(page));
        const boundedSize = Math.max(1, Math.min(Math.floor(pageSize), 100));
        const items = [...this.records.values()]
            .filter(record => !status || record.status === status)
            .sort((left, right) => right.triggeredAt - left.triggeredAt || left.id.localeCompare(right.id));
        const start = boundedPage * boundedSize;
        return {
            page: boundedPage,
            pageSize: boundedSize,
            total: items.length,
            items: items.slice(start, start + boundedSize).map(copy),
        };
    }

    public snapshot(): PendingActionRecord[] {
        return [...this.records.values()].map(copy);
    }

    public summary(): { total: number; pending: number; executed: number; denied: number } {
        const records = [...this.records.values()];
        return {
            total: records.length,
            pending: records.filter(record => record.status === 'pending').length,
            executed: records.filter(record => record.status === 'executed').length,
            denied: records.filter(record => record.status === 'denied').length,
        };
    }

    private request(
        record: PendingActionRecord,
        authorization: FrozenActionRequest['authorization'],
        claimedAt: number,
    ): FrozenActionRequest {
        return {
            correlationId: record.id,
            patternId: record.patternId,
            targetStateId: record.targetStateId,
            value: record.value,
            createdAt: claimedAt,
            expiresAt: Math.min(record.expiresAt, claimedAt + 10_000),
            contextTimestamp: claimedAt,
            authorization,
        };
    }

    private fromSuggestion(
        suggestion: PatternSuggestion,
        timestamp: number,
        id: string,
        status: PendingActionStatus,
    ): PendingActionRecord {
        return {
            id,
            patternId: suggestion.id,
            triggerStateId: suggestion.triggerStateId.slice(0, 500),
            targetStateId: suggestion.actionStateId.slice(0, 500),
            value: suggestion.expectedAction,
            rooms: suggestion.rooms.slice(0, 20),
            confidence: suggestion.confidence,
            explanation: suggestion.explanation.slice(0, 2_000),
            triggeredAt: timestamp,
            contextTimestamp: timestamp,
            expiresAt: timestamp + this.ttlMs,
            status,
        };
    }

    private hasActive(patternId: string): boolean {
        return [...this.records.values()].some(
            record => record.patternId === patternId && ['pending', 'executing'].includes(record.status),
        );
    }

    private ensureCapacity(): boolean {
        if (this.records.size < this.maximum) {
            return true;
        }
        const removable = [...this.records.values()]
            .filter(record => !['pending', 'executing'].includes(record.status))
            .sort((left, right) => left.triggeredAt - right.triggeredAt)[0];
        if (!removable) {
            return false;
        }
        this.records.delete(removable.id);
        return true;
    }

    private validIdentity(id: string): boolean {
        return /^[a-z0-9-]{1,80}$/i.test(id) && !this.records.has(id);
    }
}
