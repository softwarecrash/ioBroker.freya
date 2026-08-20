import type { HistoryEntry, HistoryProvider, HistoryProviderDescriptor, HistorySummary } from './types';

export interface HistoryServiceOptions {
    maxRangeMs: number;
    maxResults: number;
    maxConcurrent: number;
}

/** Permission and resource boundary around the selected read-only history provider. */
export class HistoryService {
    private readonly allowedStateIds: Set<string>;
    private queryCount = 0;
    private failedQueries = 0;
    private activeQueries = 0;
    private lastQueryTimestamp = 0;

    public constructor(
        private readonly configuredProvider: string,
        private readonly provider: HistoryProvider,
        private readonly availableProviders: HistoryProviderDescriptor[],
        allowedStateIds: string[],
        private readonly options: HistoryServiceOptions,
    ) {
        this.allowedStateIds = new Set(allowedStateIds);
    }

    public async query(
        stateId: string,
        start: number,
        end: number,
        limit?: number,
        signal?: AbortSignal,
    ): Promise<HistoryEntry[]> {
        this.validate(stateId, start, end);
        if (this.activeQueries >= Math.max(1, this.options.maxConcurrent)) {
            throw new Error('history_query_overloaded');
        }
        this.activeQueries++;
        try {
            if (!(await this.provider.isAvailable())) {
                throw new Error('history_provider_unavailable');
            }
            const boundedLimit = Math.max(1, Math.min(this.options.maxResults, Math.floor(limit ?? 500)));
            this.queryCount++;
            const entries = await this.provider.getHistory(stateId, start, end, {
                limit: boundedLimit,
                signal,
            });
            this.lastQueryTimestamp = Date.now();
            return entries.slice(-boundedLimit);
        } catch (error) {
            this.failedQueries++;
            throw error;
        } finally {
            this.activeQueries--;
        }
    }

    public async summary(): Promise<HistorySummary> {
        return {
            configuredProvider: this.configuredProvider,
            activeProvider: this.provider.id,
            availableProviders: this.availableProviders.length,
            available: await this.provider.isAvailable(),
            queryCount: this.queryCount,
            failedQueries: this.failedQueries,
            activeQueries: this.activeQueries,
            lastQueryTimestamp: this.lastQueryTimestamp,
        };
    }

    private validate(stateId: string, start: number, end: number): void {
        if (!this.allowedStateIds.has(stateId)) {
            throw new Error('history_state_not_allowed');
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
            throw new Error('history_invalid_range');
        }
        if (end - start > this.options.maxRangeMs) {
            throw new Error('history_range_too_large');
        }
    }
}
