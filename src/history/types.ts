export interface HistoryEntry {
    timestamp: number;
    value: ioBroker.StateValue;
    ack?: boolean;
    quality?: number;
    source?: string;
}

export interface HistoryQueryOptions {
    limit?: number;
    signal?: AbortSignal;
}

export interface HistoryProvider {
    readonly id: string;
    isAvailable(): Promise<boolean>;
    getHistory(stateId: string, start: number, end: number, options?: HistoryQueryOptions): Promise<HistoryEntry[]>;
}

export interface HistoryProviderDescriptor {
    id: string;
    adapterName: string;
    enabled: boolean;
    alive: boolean;
    supportsGetHistory: boolean;
}

export interface HistorySummary {
    configuredProvider: string;
    activeProvider: string;
    availableProviders: number;
    available: boolean;
    queryCount: number;
    failedQueries: number;
    activeQueries: number;
    lastQueryTimestamp: number;
}
