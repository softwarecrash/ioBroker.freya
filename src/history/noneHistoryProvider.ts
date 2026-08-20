import type { HistoryEntry, HistoryProvider, HistoryQueryOptions } from './types';

/** Explicit disabled provider used as the safe default. */
export class NoneHistoryProvider implements HistoryProvider {
    public readonly id = 'none';

    public isAvailable(): Promise<boolean> {
        return Promise.resolve(false);
    }

    public getHistory(
        _stateId: string,
        _start: number,
        _end: number,
        _options?: HistoryQueryOptions,
    ): Promise<HistoryEntry[]> {
        return Promise.resolve([]);
    }
}
