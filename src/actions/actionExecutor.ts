import type { ActionAuditRecord, ActionResult, FrozenActionRequest, SafetyEnvironment } from './types';
import type { SafetyEngine } from './safetyEngine';

interface ForeignStateAdapter {
    setForeignStateAsync(id: string, value: ioBroker.StateValue, ack: boolean): Promise<unknown>;
}

export interface ActionEnvironmentProvider {
    inspect(request: FrozenActionRequest): Promise<SafetyEnvironment>;
    markExecuted(targetStateId: string, timestamp: number): void;
}

export interface ActionAuditPort {
    append(record: Omit<ActionAuditRecord, 'id'>): ActionAuditRecord;
}

export interface ActionWriter {
    write(targetStateId: string, value: ioBroker.StateValue): Promise<void>;
}

/** The only production boundary permitted to perform a foreign-state write. */
export class IoBrokerActionWriter implements ActionWriter {
    public constructor(private readonly adapter: ForeignStateAdapter) {}

    public async write(targetStateId: string, value: ioBroker.StateValue): Promise<void> {
        await this.adapter.setForeignStateAsync(targetStateId, value, false);
    }
}

/** Revalidates immediately before one controlled write and records every outcome. */
export class ActionExecutor {
    public constructor(
        private readonly safety: SafetyEngine,
        private readonly environment: ActionEnvironmentProvider,
        private readonly writer: ActionWriter,
        private readonly audit: ActionAuditPort,
    ) {}

    public async execute(request: FrozenActionRequest): Promise<ActionResult> {
        this.record(request, 'requested', Date.now(), []);
        let environment: SafetyEnvironment;
        try {
            environment = await this.environment.inspect(request);
        } catch {
            this.record(request, 'failed', Date.now(), [], 'safety_environment_unavailable');
            return {
                correlationId: request.correlationId,
                executed: false,
                reasons: [],
                errorCode: 'safety_environment_unavailable',
            };
        }
        const decision = this.safety.validate(request, environment);
        if (!decision.allowed) {
            this.record(request, 'denied', decision.checkedAt, decision.reasons);
            return { correlationId: request.correlationId, executed: false, reasons: decision.reasons };
        }
        this.record(request, 'write_started', decision.checkedAt, []);
        try {
            await this.writer.write(request.targetStateId, request.value);
            this.environment.markExecuted(request.targetStateId, decision.checkedAt);
            this.record(request, 'succeeded', decision.checkedAt, []);
            return { correlationId: request.correlationId, executed: true, reasons: [] };
        } catch (error) {
            const errorCode = (error as Error).message.split(':', 1)[0].slice(0, 80) || 'write_failed';
            this.record(request, 'failed', decision.checkedAt, [], errorCode);
            return { correlationId: request.correlationId, executed: false, reasons: [], errorCode };
        }
    }

    private record(
        request: FrozenActionRequest,
        stage: ActionAuditRecord['stage'],
        timestamp: number,
        reasons: ActionAuditRecord['reasons'],
        errorCode?: string,
    ): void {
        this.audit.append({
            correlationId: request.correlationId,
            patternId: request.patternId,
            targetStateId: request.targetStateId,
            timestamp,
            stage,
            reasons,
            errorCode,
        });
    }
}
