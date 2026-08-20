import type { ActivityRecord } from './types';

/** Bounded newest-first in-memory audit store. */
export class ActivityStore {
    private readonly records: ActivityRecord[] = [];
    private sequence = 0;
    private readonly maximum: number;

    public constructor(maximum = 500) {
        this.maximum = Math.max(20, Math.min(maximum, 5_000));
    }

    public append(record: Omit<ActivityRecord, 'id'>): ActivityRecord {
        const stored = { ...record, id: `${record.timestamp}-${++this.sequence}` };
        this.records.unshift(stored);
        if (this.records.length > this.maximum) {
            this.records.length = this.maximum;
        }
        return stored;
    }

    public page(page = 0, pageSize = 50): { page: number; pageSize: number; total: number; items: ActivityRecord[] } {
        const boundedPage = Math.max(0, Math.floor(page));
        const boundedSize = Math.max(1, Math.min(Math.floor(pageSize), 100));
        const start = boundedPage * boundedSize;
        return {
            page: boundedPage,
            pageSize: boundedSize,
            total: this.records.length,
            items: this.records.slice(start, start + boundedSize).map(record => ({ ...record })),
        };
    }

    public summary(): { count: number; lastTimestamp: number } {
        return { count: this.records.length, lastTimestamp: this.records[0]?.timestamp ?? 0 };
    }
}
