import type { RuntimeConfig } from '../config/runtimeConfig';
import type { ContextEngine } from '../context/contextEngine';
import type { StatePermissions } from '../discovery/types';
import { extractPatternFeatures } from '../patterns/features';
import type { SuggestionService } from '../suggestions/suggestionService';
import type { ActionEnvironmentProvider } from './actionExecutor';
import type { FrozenActionRequest, SafetyEnvironment } from './types';

interface ActionObjectReader {
    getForeignObjectAsync(id: string): Promise<ioBroker.Object | null | undefined>;
}

function conditionsMatch(
    features: ReturnType<typeof extractPatternFeatures>,
    conditions: NonNullable<ReturnType<SuggestionService['find']>>['conditions'],
): boolean {
    return conditions.every(condition => features.values[condition.feature] === condition.value);
}

/** Resolves every mutable safety input again immediately before execution. */
export class IoBrokerActionEnvironment implements ActionEnvironmentProvider {
    private readonly cooldowns = new Map<string, number>();

    public constructor(
        private readonly adapter: ActionObjectReader,
        private readonly config: RuntimeConfig,
        private readonly suggestions: SuggestionService,
        private readonly context: ContextEngine,
        private readonly permissions: ReadonlyMap<string, StatePermissions>,
    ) {}

    public async inspect(request: FrozenActionRequest): Promise<SafetyEnvironment> {
        const now = Date.now();
        const suggestion = this.suggestions.find(request.patternId);
        const [object, snapshot] = await Promise.all([
            this.adapter.getForeignObjectAsync(request.targetStateId),
            this.context.snapshot({
                timestamp: now,
                triggerStateId: suggestion?.triggerStateId,
                relatedStateIds: suggestion ? [suggestion.actionStateId] : [],
            }),
        ]);
        const target = object?.type === 'state' ? object.common : undefined;
        return {
            now,
            autonomyLevel: this.config.autonomyLevel,
            pattern: suggestion
                ? {
                      id: suggestion.id,
                      actionStateId: suggestion.actionStateId,
                      status: suggestion.status,
                      eligible: suggestion.eligible,
                      confidence: suggestion.confidence,
                  }
                : undefined,
            permissions: this.permissions.get(request.targetStateId) ?? {
                observe: false,
                learn: false,
                suggest: false,
                control: false,
            },
            target: {
                exists: object !== null && object !== undefined,
                objectType: object?.type,
                write: target?.write,
                valueType: target?.type,
                min: target?.min,
                max: target?.max,
                states: target?.states,
            },
            targetBlocked: this.config.blockedStateIds.includes(request.targetStateId),
            cooldownUntil: this.cooldowns.get(request.targetStateId) ?? 0,
            conditionsSatisfied: suggestion
                ? conditionsMatch(extractPatternFeatures(snapshot, suggestion.rooms), suggestion.conditions)
                : false,
            minimumConfidence: this.config.minimumActionConfidence,
            maximumContextAgeMs: 5_000,
            maximumRequestWindowMs: 30_000,
        };
    }

    public markExecuted(targetStateId: string, timestamp: number): void {
        this.cooldowns.set(targetStateId, timestamp + this.config.actionCooldownSeconds * 1_000);
    }
}
