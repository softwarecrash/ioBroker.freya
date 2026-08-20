import { setTimeout as scheduleTimeout } from 'node:timers';
import type {
    ContextData,
    ContextFieldProvenance,
    ContextProvider,
    ContextProviderFailure,
    ContextRequest,
    ContextSnapshot,
} from './types';

export interface ContextEngineOptions {
    providerTimeoutMs: number;
}

function mergeContext(target: ContextData, source: ContextData): void {
    if (source.time) {
        target.time = { ...target.time, ...source.time };
    }
    if (source.sun) {
        target.sun = { ...target.sun, ...source.sun };
    }
    if (source.environment) {
        target.environment = { ...target.environment, ...source.environment };
    }
    if (source.presence) {
        target.presence = { ...target.presence, ...source.presence };
    }
    if (source.states) {
        target.states = { ...target.states, ...source.states };
    }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = scheduleTimeout(() => reject(new Error('provider_timeout')), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

/** Compose independent provider results without failing on optional context. */
export class ContextEngine {
    public constructor(
        private readonly timeProvider: ContextProvider,
        private readonly optionalProviders: ContextProvider[],
        private readonly options: ContextEngineOptions,
    ) {}

    public async snapshot(request: ContextRequest): Promise<ContextSnapshot> {
        const timeResult = await withTimeout(
            this.timeProvider.getContext(request),
            Math.max(10, this.options.providerTimeoutMs),
        );
        if (!timeResult.context.time) {
            throw new Error('time_context_required');
        }
        const time = timeResult.context.time;

        const context: ContextData = { time };
        const provenance: Record<string, ContextFieldProvenance> = { ...timeResult.provenance };
        const failures: ContextProviderFailure[] = [];

        const outcomes = await Promise.all(
            this.optionalProviders.map(async provider => {
                try {
                    if (!(await withTimeout(provider.isAvailable(), this.options.providerTimeoutMs))) {
                        return { failure: { providerId: provider.id, code: 'unavailable' as const } };
                    }
                    const result = await withTimeout(provider.getContext(request), this.options.providerTimeoutMs);
                    return { result };
                } catch (error) {
                    const message = (error as Error).message;
                    return {
                        failure: {
                            providerId: provider.id,
                            code: message === 'provider_timeout' ? ('timeout' as const) : ('error' as const),
                            message: message === 'provider_timeout' ? undefined : message.slice(0, 160),
                        },
                    };
                }
            }),
        );
        for (const outcome of outcomes) {
            if (outcome.result) {
                mergeContext(context, outcome.result.context);
                Object.assign(provenance, outcome.result.provenance);
            } else if (outcome.failure) {
                failures.push(outcome.failure);
            }
        }

        return {
            timestamp: request.timestamp,
            time,
            sun: context.sun,
            environment: context.environment,
            presence: context.presence,
            states: context.states,
            provenance,
            failures: failures.sort((a, b) => a.providerId.localeCompare(b.providerId)),
        };
    }
}
