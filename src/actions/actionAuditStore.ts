import type { ActionAuditRecord } from './types';

/** Bounded in-memory operational view; complete action records are persisted separately. */
export class ActionAuditStore {
    private readonly records: ActionAuditRecord[] = [];
    private sequence = 0;
    private readonly maximum: number;

    public constructor(maximum = 500) {
        this.maximum = Math.max(20, Math.min(maximum, 5_000));
    }

    public append(record: Omit<ActionAuditRecord, 'id'>): ActionAuditRecord {
        const stored = { ...record, reasons: [...record.reasons], id: `${record.timestamp}-${++this.sequence}` };
        this.records.unshift(stored);
        if (this.records.length > this.maximum) {
            this.records.length = this.maximum;
        }
        return { ...stored, reasons: [...stored.reasons] };
    }

    public page(
        page = 0,
        pageSize = 50,
    ): { page: number; pageSize: number; total: number; items: ActionAuditRecord[] } {
        const boundedPage = Math.max(0, Math.floor(page));
        const boundedSize = Math.max(1, Math.min(Math.floor(pageSize), 100));
        const start = boundedPage * boundedSize;
        return {
            page: boundedPage,
            pageSize: boundedSize,
            total: this.records.length,
            items: this.records.slice(start, start + boundedSize).map(record => ({
                ...record,
                reasons: [...record.reasons],
            })),
        };
    }
}
