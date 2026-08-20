import { normalizeHistoryResponse } from './normalizer';
import type { HistoryEntry, HistoryProvider, HistoryProviderDescriptor, HistoryQueryOptions } from './types';

export interface HistoryTransport {
    request(instanceId: string, message: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
}

export class IoBrokerHistoryTransport implements HistoryTransport {
    public constructor(private readonly adapter: ioBroker.Adapter) {}

    public request(instanceId: string, message: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
        return this.adapter.sendToAsync(instanceId, 'getHistory', message, {
            timeout: Math.max(100, Math.min(30_000, timeoutMs)),
        });
    }
}

function withCancellation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
        return promise;
    }
    if (signal.aborted) {
        return Promise.reject(new Error('history_query_cancelled'));
    }
    return new Promise<T>((resolve, reject) => {
        const abort = (): void => reject(new Error('history_query_cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

/** Generic provider for adapters implementing the ioBroker getHistory message. */
export class IoBrokerHistoryProvider implements HistoryProvider {
    public readonly id: string;

    public constructor(
        private readonly descriptor: HistoryProviderDescriptor,
        private readonly transport: HistoryTransport,
        private readonly timeoutMs = 5_000,
        private readonly maxResults = 2_000,
    ) {
        this.id = descriptor.id;
    }

    public isAvailable(): Promise<boolean> {
        return Promise.resolve(this.descriptor.enabled && this.descriptor.alive && this.descriptor.supportsGetHistory);
    }

    public async getHistory(
        stateId: string,
        start: number,
        end: number,
        options: HistoryQueryOptions = {},
    ): Promise<HistoryEntry[]> {
        if (!(await this.isAvailable())) {
            throw new Error('history_provider_unavailable');
        }
        if (options.signal?.aborted) {
            throw new Error('history_query_cancelled');
        }
        const limit = Math.max(1, Math.min(this.maxResults, Math.floor(options.limit ?? 500)));
        const response = await withCancellation(
            this.transport.request(
                this.id,
                {
                    id: stateId,
                    options: {
                        start,
                        end,
                        aggregate: 'onchange',
                        count: limit,
                        limit,
                        ack: true,
                        q: true,
                        from: true,
                    },
                },
                this.timeoutMs,
            ),
            options.signal,
        );
        return normalizeHistoryResponse(response, start, end, limit);
    }
}
