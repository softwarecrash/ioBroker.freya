import type { ContextEngine } from '../context/contextEngine';
import type { Observation, ObservationMetadata, ObservationSummary } from './types';

interface PendingEvent {
    sequence: number;
    stateId: string;
    state: ioBroker.State | null;
    metadata: ObservationMetadata;
    receivedAt: number;
}

export interface ObservationEngineOptions {
    maxQueue: number;
    maxRetained: number;
}

export interface ObservationPort {
    onObservation(observation: Observation): Promise<void>;
    onError(message: string): void;
    debug(message: string): void;
}

function normalizedValue(value: ioBroker.StateValue): ioBroker.StateValue {
    return typeof value === 'string' ? value.slice(0, 4_096) : value;
}

function fingerprint(state: ioBroker.State | null): string {
    return state === null ? 'deleted' : JSON.stringify([normalizedValue(state.val), state.ack === true, state.q ?? 0]);
}

/** Normalize permission-gated state events into a bounded ordered stream. */
export class ObservationEngine {
    private readonly latestFingerprint = new Map<string, string>();
    private readonly latestValue = new Map<string, ioBroker.StateValue>();
    private readonly queue: PendingEvent[] = [];
    private readonly retained: Observation[] = [];
    private processing?: Promise<void>;
    private accepting = true;
    private sequence = 0;
    private droppedEvents = 0;
    private lastObservationTimestamp = 0;

    public constructor(
        private readonly contextEngine: ContextEngine,
        private readonly port: ObservationPort,
        private readonly subscribedStates: number,
        private readonly options: ObservationEngineOptions,
    ) {}

    public prime(states: Record<string, ioBroker.State | null | undefined>): void {
        for (const [stateId, state] of Object.entries(states)) {
            if (state) {
                this.latestFingerprint.set(stateId, fingerprint(state));
                this.latestValue.set(stateId, normalizedValue(state.val));
            }
        }
    }

    public ingest(stateId: string, state: ioBroker.State | null, metadata: ObservationMetadata): boolean {
        if (!this.accepting) {
            return false;
        }
        const currentFingerprint = fingerprint(state);
        if (this.latestFingerprint.get(stateId) === currentFingerprint) {
            return false;
        }
        this.latestFingerprint.set(stateId, currentFingerprint);
        if (this.queue.length >= Math.max(1, this.options.maxQueue)) {
            this.queue.shift();
            this.droppedEvents++;
        }
        this.queue.push({ sequence: ++this.sequence, stateId, state, metadata, receivedAt: Date.now() });
        this.port.debug(`[Observation] Queued state metadata for ${stateId}`);
        this.ensureProcessing();
        return true;
    }

    public page(
        page: number,
        pageSize: number,
    ): { total: number; page: number; pageSize: number; items: Observation[] } {
        const safePage = Math.max(0, Math.floor(page));
        const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
        const newestFirst = [...this.retained].reverse();
        const start = safePage * safePageSize;
        return {
            total: newestFirst.length,
            page: safePage,
            pageSize: safePageSize,
            items: newestFirst.slice(start, start + safePageSize),
        };
    }

    public summary(): ObservationSummary {
        return {
            subscribedStates: this.subscribedStates,
            retainedObservations: this.retained.length,
            queuedEvents: this.queue.length,
            droppedEvents: this.droppedEvents,
            lastObservationTimestamp: this.lastObservationTimestamp,
        };
    }

    public async stop(): Promise<void> {
        this.accepting = false;
        this.queue.length = 0;
        await this.processing;
    }

    private async drain(): Promise<void> {
        while (this.accepting && this.queue.length) {
            const event = this.queue.shift();
            if (!event) {
                continue;
            }
            await this.process(event);
        }
    }

    private ensureProcessing(): void {
        if (this.processing || !this.accepting || !this.queue.length) {
            return;
        }
        this.processing = this.drain().finally(() => {
            this.processing = undefined;
            this.ensureProcessing();
        });
    }

    private async process(event: PendingEvent): Promise<void> {
        const previousValue = this.latestValue.get(event.stateId);
        const timestamp = event.state?.ts ?? event.receivedAt;
        let context: Observation['context'];
        let contextError: string | undefined;
        try {
            context = await this.contextEngine.snapshot({
                timestamp,
                triggerStateId: event.stateId,
                relatedStateIds: event.metadata.relatedStateIds,
            });
        } catch (error) {
            contextError = (error as Error).message.slice(0, 160);
            this.port.onError(`[Observation] Context snapshot failed: ${contextError}`);
        }
        const observation: Observation = {
            sequence: event.sequence,
            stateId: event.stateId,
            value: event.state ? normalizedValue(event.state.val) : null,
            previousValue,
            timestamp,
            receivedAt: event.receivedAt,
            ack: event.state?.ack === true,
            quality: event.state?.q ?? 0,
            source: event.state?.from.slice(0, 160),
            deleted: event.state === null,
            semanticType: event.metadata.semanticType,
            role: event.metadata.role,
            rooms: [...event.metadata.rooms],
            functions: [...event.metadata.functions],
            context,
            contextError,
        };
        if (event.state) {
            this.latestValue.set(event.stateId, normalizedValue(event.state.val));
        } else {
            this.latestValue.delete(event.stateId);
        }
        this.retained.push(observation);
        if (this.retained.length > Math.max(1, this.options.maxRetained)) {
            this.retained.splice(0, this.retained.length - this.options.maxRetained);
        }
        this.lastObservationTimestamp = timestamp;
        await this.port.onObservation(observation);
    }
}
