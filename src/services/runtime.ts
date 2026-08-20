import type { RuntimeConfig } from '../config/runtimeConfig';

/** Minimal adapter boundary used by the Phase 5 runtime. */
export interface RuntimePort {
    /** Write an adapter-owned status state. */
    setState(id: string, value: ioBroker.StateValue): Promise<void>;
    /** Emit a safety warning. */
    warn(message: string): void;
}

/** Publishes the bounded, read-only lifecycle status for Phase 5. */
export class SmartBrainRuntime {
    private started = false;

    /**
     * Create a runtime service.
     *
     * @param port Adapter boundary.
     * @param config Effective safe configuration.
     */
    public constructor(
        private readonly port: RuntimePort,
        private readonly config: RuntimeConfig,
    ) {}

    /** Start once and publish safe status values. */
    public async start(): Promise<void> {
        if (this.started) {
            return;
        }

        if (this.config.unsafeConfigurationIgnored) {
            this.port.warn('[Safety] Unsupported configuration ignored; enforcing autonomy level 0');
        }

        await this.port.setState('info.autonomyLevel', this.config.autonomyLevel);
        await this.port.setState('learning.enabled', this.config.learningEnabled);
        await this.port.setState('learning.observedStateCount', 0);
        await this.port.setState('patterns.candidateCount', 0);
        await this.port.setState('patterns.approvedCount', 0);
        await this.port.setState('actions.lastResult', 'none');
        await this.port.setState('info.status', this.config.learningEnabled ? 'learning-read-only' : 'observe-only');
        await this.port.setState('info.connection', true);
        this.started = true;
    }

    /** Stop once and mark the adapter disconnected. */
    public async stop(): Promise<void> {
        if (!this.started) {
            return;
        }

        await this.port.setState('info.status', 'stopped');
        await this.port.setState('info.connection', false);
        this.started = false;
    }
}
