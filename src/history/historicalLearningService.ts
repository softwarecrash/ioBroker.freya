import type { ChangeAttribution } from '../attribution/sourceAttribution';
import type { ContextSnapshot, EnvironmentContext } from '../context/types';
import type { EnvironmentCandidate, EnvironmentKey, SemanticType } from '../discovery/types';
import type { Observation } from '../observation/types';
import type { HistoryEntry } from './types';

export interface HistoricalLearningState {
    id: string;
    semanticType: SemanticType;
    valueType?: ioBroker.CommonType;
    rooms: string[];
    role?: string;
    functions?: string[];
}

export interface HistoricalLearningQuery {
    query(stateId: string, start: number, end: number, limit?: number, signal?: AbortSignal): Promise<HistoryEntry[]>;
}

export interface HistoricalPatternSink {
    observe(observation: Observation): void;
    flush(timestamp: number): void;
}

export interface HistoricalLearningOptions {
    maxStates: number;
    maxEntriesPerState: number;
    maxEvents: number;
    maxConcurrent: number;
}

export interface HistoricalLearningSummary {
    queriedStates: number;
    failedStates: number;
    replayedEvents: number;
    retainedEntries: number;
}

export type HistoricalContextFactory = (
    timestamp: number,
    values: ReadonlyMap<string, ioBroker.StateValue>,
) => Promise<ContextSnapshot>;

interface PendingCommand {
    timestamp: number;
    value: ioBroker.StateValue;
}

const BEHAVIOR_TYPES = new Set<SemanticType>(['motion', 'presence', 'contact', 'switch', 'light']);
const CONTEXT_TYPES = new Set<SemanticType>([
    'illuminance',
    'temperature',
    'humidity',
    'cloudCover',
    'precipitation',
    'windSpeed',
]);

function sourceAttribution(
    stateId: string,
    entry: HistoryEntry,
    pendingCommands: Map<string, PendingCommand>,
    selfSource: string,
): ChangeAttribution {
    const source = entry.source;
    if (entry.ack === false) {
        const kind =
            source === selfSource
                ? 'self'
                : /^system\.adapter\.admin\.\d+$/.test(source ?? '')
                  ? 'direct-user'
                  : 'external-command';
        pendingCommands.set(stateId, { timestamp: entry.timestamp, value: entry.value });
        return {
            kind,
            source,
            confidence: kind === 'external-command' ? 0.8 : 1,
            reason: kind === 'self' ? 'self_source' : kind === 'direct-user' ? 'admin_command' : 'foreign_command',
        };
    }
    const pending = pendingCommands.get(stateId);
    if (pending && pending.timestamp + 15_000 >= entry.timestamp && Object.is(pending.value, entry.value)) {
        pendingCommands.delete(stateId);
        return {
            kind: 'confirmation',
            source,
            confidence: 0.95,
            reason: 'matching_device_confirmation',
        };
    }
    return {
        kind: 'device-originated',
        source,
        confidence: 0.7,
        reason: 'unsolicited_acknowledged_change',
    };
}

function environmentValue(key: EnvironmentKey, value: ioBroker.StateValue): number | boolean | undefined {
    if (key === 'precipitation') {
        return typeof value === 'boolean'
            ? value
            : typeof value === 'number' && Number.isFinite(value)
              ? value > 0
              : undefined;
    }
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Add bounded historical device, presence, and mapped environment values to calculated time/sun context. */
export function enrichHistoricalContext(
    base: ContextSnapshot,
    values: ReadonlyMap<string, ioBroker.StateValue>,
    states: HistoricalLearningState[],
    environmentCandidates: EnvironmentCandidate[],
): ContextSnapshot {
    const contextStates = Object.fromEntries([...values.entries()].slice(-100));
    const presenceValues = states
        .filter(state => state.semanticType === 'presence')
        .map(state => values.get(state.id))
        .filter(value => typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)));
    const personsHome = presenceValues.reduce<number>(
        (sum, value) => sum + (typeof value === 'boolean' ? Number(value) : Math.max(0, Math.floor(value as number))),
        0,
    );
    const environment: EnvironmentContext = {};
    for (const candidate of environmentCandidates.filter(candidate => candidate.selected)) {
        const value = values.get(candidate.stateId);
        if (value === undefined) {
            continue;
        }
        const normalized = environmentValue(candidate.key, value);
        if (normalized !== undefined && environment[candidate.key] === undefined) {
            Object.assign(environment, { [candidate.key]: normalized });
        }
    }
    return {
        ...base,
        states: contextStates,
        presence: presenceValues.length ? { home: personsHome > 0, personsHome } : base.presence,
        environment: Object.keys(environment).length ? { ...base.environment, ...environment } : base.environment,
    };
}

/** Replay a bounded historical window into the same deterministic learner, never into action dispatch. */
export class HistoricalLearningService {
    public constructor(
        private readonly history: HistoricalLearningQuery,
        private readonly patterns: HistoricalPatternSink,
        private readonly contextFactory: HistoricalContextFactory,
        states: HistoricalLearningState[],
        private readonly selfSource: string,
        private readonly options: HistoricalLearningOptions,
    ) {
        this.states = states
            .filter(state => BEHAVIOR_TYPES.has(state.semanticType) || CONTEXT_TYPES.has(state.semanticType))
            .sort(
                (left, right) =>
                    Number(!BEHAVIOR_TYPES.has(left.semanticType)) - Number(!BEHAVIOR_TYPES.has(right.semanticType)) ||
                    Number(left.semanticType !== 'illuminance') - Number(right.semanticType !== 'illuminance') ||
                    left.id.localeCompare(right.id),
            )
            .slice(0, Math.max(1, Math.min(options.maxStates, 100)));
    }

    private readonly states: HistoricalLearningState[];

    public async run(start: number, end: number, signal?: AbortSignal): Promise<HistoricalLearningSummary> {
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
            throw new Error('historical_learning_invalid_range');
        }
        const streams = new Map<string, HistoryEntry[]>();
        let failedStates = 0;
        let cursor = 0;
        const workers = Array.from(
            { length: Math.max(1, Math.min(this.options.maxConcurrent, 4, this.states.length || 1)) },
            async () => {
                while (cursor < this.states.length) {
                    if (signal?.aborted) {
                        throw new Error('historical_learning_cancelled');
                    }
                    const state = this.states[cursor++];
                    try {
                        streams.set(
                            state.id,
                            await this.history.query(
                                state.id,
                                start,
                                end,
                                Math.max(2, Math.min(this.options.maxEntriesPerState, 2_000)),
                                signal,
                            ),
                        );
                    } catch {
                        failedStates++;
                    }
                }
            },
        );
        await Promise.all(workers);

        const events = this.states
            .flatMap(state => (streams.get(state.id) ?? []).map(entry => ({ ...entry, state })))
            .sort(
                (left, right) =>
                    left.timestamp - right.timestamp ||
                    Number(left.state.semanticType === 'light') - Number(right.state.semanticType === 'light') ||
                    left.state.id.localeCompare(right.state.id),
            )
            .slice(-Math.max(1, Math.min(this.options.maxEvents, 20_000)));
        const values = new Map<string, ioBroker.StateValue>();
        const initialized = new Set<string>();
        const pendingCommands = new Map<string, PendingCommand>();
        let replayedEvents = 0;
        let sequence = 0;
        for (const event of events) {
            if (signal?.aborted) {
                throw new Error('historical_learning_cancelled');
            }
            const previousValue = values.get(event.state.id);
            values.set(event.state.id, event.value);
            if (!initialized.has(event.state.id)) {
                initialized.add(event.state.id);
                sourceAttribution(event.state.id, event, pendingCommands, this.selfSource);
                continue;
            }
            if (!BEHAVIOR_TYPES.has(event.state.semanticType) || Object.is(previousValue, event.value)) {
                continue;
            }
            const context = await this.contextFactory(event.timestamp, values);
            this.patterns.observe({
                sequence: ++sequence,
                stateId: event.state.id,
                value: event.value,
                previousValue,
                timestamp: event.timestamp,
                receivedAt: event.timestamp,
                ack: event.ack ?? true,
                quality: event.quality ?? 0,
                source: event.source,
                attribution: sourceAttribution(event.state.id, event, pendingCommands, this.selfSource),
                deleted: false,
                semanticType: event.state.semanticType,
                role: event.state.role,
                rooms: event.state.rooms,
                functions: event.state.functions ?? [],
                context,
            });
            replayedEvents++;
        }
        this.patterns.flush(end);
        return {
            queriedStates: streams.size,
            failedStates,
            replayedEvents,
            retainedEntries: events.length,
        };
    }
}
