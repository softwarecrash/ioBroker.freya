import { copyFile, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ActionResult, FrozenActionRequest } from '../actions/types';
import type { FeedbackOutcome, FeedbackSource, FeedbackSummary, FeedbackTotals, PersistedActionRecord } from './types';

interface PersistedDocument {
    schemaVersion: 1;
    actions: PersistedActionRecord[];
}

function validRecord(value: unknown): value is PersistedActionRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Partial<PersistedActionRecord>;
    const validValue =
        record.expectedValue === null ||
        typeof record.expectedValue === 'boolean' ||
        (typeof record.expectedValue === 'number' && Number.isFinite(record.expectedValue)) ||
        (typeof record.expectedValue === 'string' && record.expectedValue.length <= 2_000);
    const validFeedback =
        record.feedback === undefined ||
        (typeof record.feedback === 'object' &&
            record.feedback !== null &&
            ['positive', 'negative', 'neutral', 'unknown'].includes(record.feedback.outcome) &&
            ['explicit', 'implicit'].includes(record.feedback.source) &&
            Number.isFinite(record.feedback.timestamp) &&
            (record.feedback.actor === undefined ||
                (typeof record.feedback.actor === 'string' && record.feedback.actor.length <= 120)) &&
            (record.feedback.reason === undefined ||
                (typeof record.feedback.reason === 'string' && record.feedback.reason.length <= 200)));
    return (
        typeof record.correlationId === 'string' &&
        /^[a-z0-9-]{1,80}$/i.test(record.correlationId) &&
        typeof record.patternId === 'string' &&
        /^[a-f0-9]{16}$/.test(record.patternId) &&
        typeof record.targetStateId === 'string' &&
        record.targetStateId.length > 0 &&
        record.targetStateId.length <= 500 &&
        typeof record.requestedAt === 'number' &&
        Number.isFinite(record.requestedAt) &&
        typeof record.executed === 'boolean' &&
        (record.completedAt === undefined ||
            (typeof record.completedAt === 'number' && Number.isFinite(record.completedAt))) &&
        Array.isArray(record.reasons) &&
        record.reasons.every(reason => typeof reason === 'string' && reason.length <= 80) &&
        (record.errorCode === undefined || (typeof record.errorCode === 'string' && record.errorCode.length <= 80)) &&
        validValue &&
        validFeedback
    );
}

function copyRecord(record: PersistedActionRecord): PersistedActionRecord {
    return {
        ...record,
        reasons: [...record.reasons],
        feedback: record.feedback ? { ...record.feedback } : undefined,
    };
}

function decodeDocument(body: string): { actions: PersistedActionRecord[]; migrated: boolean } {
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
        throw new Error('action_repository_json_invalid');
    }
    const version = parsed.schemaVersion;
    const actions = version === 0 ? parsed.records : parsed.actions;
    if (![0, 1].includes(Number(version)) || !Array.isArray(actions) || !actions.every(validRecord)) {
        throw new Error('action_repository_schema_invalid');
    }
    return { actions, migrated: version === 0 };
}

/** Schema-versioned, bounded, serialized and atomically replaced action repository. */
export class ActionRepository {
    private records: PersistedActionRecord[] = [];
    private queue: Promise<void> = Promise.resolve();
    private readonly maximum: number;

    public constructor(
        private readonly filename: string,
        maximum = 1_000,
    ) {
        this.maximum = Math.max(20, Math.min(maximum, 10_000));
    }

    public async load(): Promise<void> {
        try {
            let decoded;
            try {
                decoded = decodeDocument(await readFile(this.filename, 'utf8'));
            } catch (primaryError) {
                try {
                    decoded = decodeDocument(await readFile(`${this.filename}.bak`, 'utf8'));
                } catch (backupError) {
                    if ((primaryError as NodeJS.ErrnoException).code === 'ENOENT') {
                        throw backupError;
                    }
                    throw primaryError;
                }
            }
            this.records = decoded.actions.slice(-this.maximum).map(copyRecord);
            if (decoded.migrated) {
                await this.persist();
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
            this.records = [];
        }
    }

    public requested(request: FrozenActionRequest, timestamp: number): Promise<void> {
        if (!Number.isFinite(timestamp)) {
            return Promise.reject(new Error('action_record_timestamp_invalid'));
        }
        return this.mutate(() => {
            if (this.records.some(record => record.correlationId === request.correlationId)) {
                throw new Error('action_record_duplicate');
            }
            this.records.push({
                correlationId: request.correlationId,
                patternId: request.patternId,
                targetStateId: request.targetStateId.slice(0, 500),
                expectedValue: request.value,
                requestedAt: timestamp,
                executed: false,
                reasons: [],
            });
            this.bound();
        });
    }

    public completed(request: FrozenActionRequest, result: ActionResult, timestamp: number): Promise<void> {
        if (!Number.isFinite(timestamp) || result.correlationId !== request.correlationId) {
            return Promise.reject(new Error('action_record_completion_invalid'));
        }
        return this.mutate(() => {
            const record = this.records.find(item => item.correlationId === request.correlationId);
            if (!record) {
                throw new Error('action_record_missing');
            }
            record.completedAt = timestamp;
            record.executed = result.executed;
            record.reasons = [...result.reasons];
            record.errorCode = result.errorCode?.slice(0, 80);
        });
    }

    public feedback(
        correlationId: string,
        outcome: FeedbackOutcome,
        source: FeedbackSource,
        timestamp: number,
        actor?: string,
        reason?: string,
    ): Promise<PersistedActionRecord | undefined> {
        if (!Number.isFinite(timestamp)) {
            return Promise.reject(new Error('feedback_timestamp_invalid'));
        }
        let result: PersistedActionRecord | undefined;
        return this.mutate(() => {
            const record = this.records.find(item => item.correlationId === correlationId);
            if (!record || !record.executed || (record.feedback?.source === 'explicit' && source === 'implicit')) {
                result = record ? copyRecord(record) : undefined;
                return;
            }
            record.feedback = {
                outcome,
                source,
                timestamp,
                actor: actor?.slice(0, 120),
                reason: reason?.slice(0, 200),
            };
            result = copyRecord(record);
        }).then(() => result);
    }

    public pending(timestamp: number, windowMs: number): PersistedActionRecord[] {
        return this.records
            .filter(
                record =>
                    record.executed &&
                    !record.feedback &&
                    record.completedAt !== undefined &&
                    record.completedAt <= timestamp &&
                    record.completedAt + windowMs >= timestamp,
            )
            .map(copyRecord);
    }

    public expired(timestamp: number, windowMs: number): PersistedActionRecord[] {
        return this.records
            .filter(
                record =>
                    record.executed &&
                    !record.feedback &&
                    record.completedAt !== undefined &&
                    record.completedAt + windowMs < timestamp,
            )
            .map(copyRecord);
    }

    public find(correlationId: string): PersistedActionRecord | undefined {
        const record = this.records.find(item => item.correlationId === correlationId);
        return record ? copyRecord(record) : undefined;
    }

    public page(
        page = 0,
        pageSize = 50,
    ): { page: number; pageSize: number; total: number; items: PersistedActionRecord[] } {
        const boundedPage = Math.max(0, Math.floor(page));
        const boundedSize = Math.max(1, Math.min(Math.floor(pageSize), 100));
        const newest = [...this.records].reverse();
        const start = boundedPage * boundedSize;
        return {
            page: boundedPage,
            pageSize: boundedSize,
            total: newest.length,
            items: newest.slice(start, start + boundedSize).map(copyRecord),
        };
    }

    public totals(patternId: string): FeedbackTotals {
        const feedback = this.records.filter(record => record.patternId === patternId).map(record => record.feedback);
        return {
            positive: feedback.filter(item => item?.outcome === 'positive').length,
            negative: feedback.filter(item => item?.outcome === 'negative').length,
        };
    }

    public allTotals(): Map<string, FeedbackTotals> {
        const result = new Map<string, FeedbackTotals>();
        for (const record of this.records) {
            if (!record.feedback || !['positive', 'negative'].includes(record.feedback.outcome)) {
                continue;
            }
            const totals = result.get(record.patternId) ?? { positive: 0, negative: 0 };
            if (record.feedback.outcome === 'positive') {
                totals.positive++;
            } else {
                totals.negative++;
            }
            result.set(record.patternId, totals);
        }
        return result;
    }

    public summary(): FeedbackSummary {
        const feedback = this.records.map(record => record.feedback).filter(item => item !== undefined);
        return {
            actionCount: this.records.length,
            pendingCount: this.records.filter(record => record.executed && !record.feedback).length,
            positiveCount: feedback.filter(item => item.outcome === 'positive').length,
            negativeCount: feedback.filter(item => item.outcome === 'negative').length,
            neutralCount: feedback.filter(item => item.outcome === 'neutral').length,
            unknownCount: feedback.filter(item => item.outcome === 'unknown').length,
            lastFeedbackTimestamp: Math.max(0, ...feedback.map(item => item.timestamp)),
        };
    }

    private mutate(change: () => void): Promise<void> {
        const operation = this.queue.then(async () => {
            const previous = this.records.map(copyRecord);
            try {
                change();
                await this.persist();
            } catch (error) {
                this.records = previous;
                throw error;
            }
        });
        this.queue = operation.catch(() => undefined);
        return operation;
    }

    private async persist(): Promise<void> {
        await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 });
        const temporary = `${this.filename}.tmp`;
        const backup = `${this.filename}.bak`;
        const document: PersistedDocument = { schemaVersion: 1, actions: this.records };
        const body = `${JSON.stringify(document)}\n`;
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

    private bound(): void {
        if (this.records.length > this.maximum) {
            this.records.splice(0, this.records.length - this.maximum);
        }
    }
}
