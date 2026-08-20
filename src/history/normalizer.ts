import type { HistoryEntry } from './types';

const MAX_STRING_LENGTH = 4_096;

function normalizeValue(value: unknown): ioBroker.StateValue | undefined {
    if (value === null || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
        return value.slice(0, MAX_STRING_LENGTH);
    }
    return undefined;
}

function responseResult(response: unknown): unknown[] {
    if (!response || typeof response !== 'object') {
        throw new Error('history_invalid_response');
    }
    const record = response as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error) {
        throw new Error(`history_provider_error:${record.error.slice(0, 120)}`);
    }
    if (!Array.isArray(record.result)) {
        throw new Error('history_invalid_response');
    }
    return record.result;
}

/** Normalize untrusted provider responses into a bounded deterministic format. */
export function normalizeHistoryResponse(
    response: unknown,
    start: number,
    end: number,
    requestedLimit: number,
): HistoryEntry[] {
    const limit = Math.max(1, Math.min(2_000, Math.floor(requestedLimit)));
    const entries: HistoryEntry[] = [];
    const fingerprints = new Set<string>();
    for (const raw of responseResult(response)) {
        if (!raw || typeof raw !== 'object') {
            continue;
        }
        const record = raw as Record<string, unknown>;
        const timestamp = record.ts;
        if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < start || timestamp > end) {
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(record, 'val')) {
            continue;
        }
        const value = normalizeValue(record.val);
        if (value === undefined) {
            continue;
        }
        const ack = typeof record.ack === 'boolean' ? record.ack : undefined;
        const quality = typeof record.q === 'number' && Number.isFinite(record.q) ? record.q : undefined;
        const source = typeof record.from === 'string' ? record.from.slice(0, 160) : undefined;
        const fingerprint = JSON.stringify([timestamp, value, ack, quality, source]);
        if (fingerprints.has(fingerprint)) {
            continue;
        }
        fingerprints.add(fingerprint);
        const entry: HistoryEntry = { timestamp, value };
        if (ack !== undefined) {
            entry.ack = ack;
        }
        if (quality !== undefined) {
            entry.quality = quality;
        }
        if (source !== undefined) {
            entry.source = source;
        }
        entries.push(entry);
    }
    entries.sort((left, right) => left.timestamp - right.timestamp);
    return entries.length > limit ? entries.slice(entries.length - limit) : entries;
}
