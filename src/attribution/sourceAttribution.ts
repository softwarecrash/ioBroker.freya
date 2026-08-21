export type ChangeOriginKind =
    'smartbrain' | 'direct-user' | 'external-command' | 'device-originated' | 'confirmation' | 'unknown';

export interface ChangeAttribution {
    kind: ChangeOriginKind;
    source?: string;
    confidence: number;
    reason:
        | 'self_source'
        | 'admin_command'
        | 'foreign_command'
        | 'reported_user_intent'
        | 'reported_automation_intent'
        | 'matching_device_confirmation'
        | 'unsolicited_acknowledged_change'
        | 'missing_state';
    commandKind?: Exclude<ChangeOriginKind, 'confirmation' | 'unknown'>;
    commandSource?: string;
}

interface PendingCommand {
    value: ioBroker.StateValue;
    kind: 'smartbrain' | 'direct-user' | 'external-command';
    source?: string;
    timestamp: number;
}

interface ReportedIntent {
    value: ioBroker.StateValue;
    kind: 'direct-user' | 'external-command';
    source: string;
    timestamp: number;
}

function isDirectAdminSource(source: string | undefined): boolean {
    return /^system\.adapter\.admin\.\d+$/.test(source ?? '');
}

/** Correlate generic ioBroker command and acknowledgement events without adapter-specific assumptions. */
export class SourceAttributionService {
    private readonly pendingCommands = new Map<string, PendingCommand>();
    private readonly reportedIntents = new Map<string, ReportedIntent>();
    private readonly commandWindowMs: number;
    private readonly maximumPending: number;

    public constructor(
        private readonly selfSource: string,
        commandWindowMs = 15_000,
        maximumPending = 1_000,
    ) {
        this.commandWindowMs = Math.max(1_000, Math.min(commandWindowMs, 120_000));
        this.maximumPending = Math.max(10, Math.min(maximumPending, 10_000));
    }

    /** Accept a short-lived per-event intent from any authenticated local adapter bridge. */
    public reportIntent(
        stateId: string,
        value: ioBroker.StateValue,
        origin: 'user' | 'automation',
        source: string,
        timestamp = Date.now(),
    ): boolean {
        if (
            !stateId ||
            stateId.length > 500 ||
            !/^system\.adapter\.[\w-]+\.\d+$/.test(source) ||
            !['user', 'automation'].includes(origin) ||
            !Number.isFinite(timestamp)
        ) {
            return false;
        }
        this.reportedIntents.set(stateId, {
            value,
            kind: origin === 'user' ? 'direct-user' : 'external-command',
            source,
            timestamp,
        });
        this.bound();
        return true;
    }

    public classify(stateId: string, state: ioBroker.State | null, timestamp = Date.now()): ChangeAttribution {
        const now = Number.isFinite(timestamp) ? timestamp : Date.now();
        this.prune(now);
        if (!state) {
            return { kind: 'unknown', confidence: 0, reason: 'missing_state' };
        }
        const source = state.from?.slice(0, 160);
        if (!state.ack) {
            const reported = this.reportedIntents.get(stateId);
            const matchesReported =
                reported !== undefined &&
                reported.timestamp + this.commandWindowMs >= now &&
                reported.source === source &&
                Object.is(reported.value, state.val);
            if (matchesReported) {
                this.reportedIntents.delete(stateId);
            }
            const kind = matchesReported
                ? reported.kind
                : source === this.selfSource
                  ? 'smartbrain'
                  : isDirectAdminSource(source)
                    ? 'direct-user'
                    : 'external-command';
            this.pendingCommands.set(stateId, { value: state.val, kind, source, timestamp: now });
            this.bound();
            return {
                kind,
                source,
                confidence: kind === 'external-command' ? 0.8 : 1,
                reason: matchesReported
                    ? kind === 'direct-user'
                        ? 'reported_user_intent'
                        : 'reported_automation_intent'
                    : kind === 'smartbrain'
                      ? 'self_source'
                      : kind === 'direct-user'
                        ? 'admin_command'
                        : 'foreign_command',
            };
        }

        const pending = this.pendingCommands.get(stateId);
        if (pending && pending.timestamp + this.commandWindowMs >= now && Object.is(pending.value, state.val)) {
            this.pendingCommands.delete(stateId);
            return {
                kind: 'confirmation',
                source,
                confidence: 0.95,
                reason: 'matching_device_confirmation',
                commandKind: pending.kind,
                commandSource: pending.source,
            };
        }
        return {
            kind: 'device-originated',
            source,
            confidence: 0.7,
            reason: 'unsolicited_acknowledged_change',
        };
    }

    private prune(timestamp: number): void {
        for (const [stateId, command] of this.pendingCommands) {
            if (command.timestamp + this.commandWindowMs < timestamp) {
                this.pendingCommands.delete(stateId);
            }
        }
        for (const [stateId, intent] of this.reportedIntents) {
            if (intent.timestamp + this.commandWindowMs < timestamp) {
                this.reportedIntents.delete(stateId);
            }
        }
    }

    private bound(): void {
        while (this.pendingCommands.size + this.reportedIntents.size > this.maximumPending) {
            const oldest = this.pendingCommands.keys().next().value ?? this.reportedIntents.keys().next().value;
            if (oldest === undefined) {
                return;
            }
            if (!this.pendingCommands.delete(oldest)) {
                this.reportedIntents.delete(oldest);
            }
        }
    }
}
