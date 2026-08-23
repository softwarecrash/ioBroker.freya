import * as utils from '@iobroker/adapter-core';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { SourceAttributionService } from './attribution/sourceAttribution';
import { ActionAuditStore } from './actions/actionAuditStore';
import { ActionExecutor, IoBrokerActionWriter, type ActionRecordPort } from './actions/actionExecutor';
import { IoBrokerActionEnvironment } from './actions/ioBrokerActionEnvironment';
import { PendingActionService } from './actions/pendingActionService';
import { SafetyEngine } from './actions/safetyEngine';
import type { RuntimeConfig } from './config/runtimeConfig';
import { createRuntimeConfig } from './config/runtimeConfig';
import { ContextEngine } from './context/contextEngine';
import { IoBrokerCoordinateSource } from './context/providers/ioBrokerCoordinateSource';
import {
    DeviceContextProvider,
    EnvironmentContextProvider,
    PresenceContextProvider,
    WeatherContextProvider,
} from './context/providers/stateContextProviders';
import { SunContextProvider } from './context/providers/sunContextProvider';
import { TimeContextProvider } from './context/providers/timeContextProvider';
import { DiscoveryService } from './discovery/discoveryService';
import { IoBrokerDiscoverySource } from './discovery/ioBrokerDiscoverySource';
import type { DiscoveryResult, DiscoveredStateView, EnvironmentCandidate } from './discovery/types';
import { HistoryService } from './history/historyService';
import { HistoricalLearningService, enrichHistoricalContext } from './history/historicalLearningService';
import { IoBrokerHistoryProvider, IoBrokerHistoryTransport } from './history/ioBrokerHistoryProvider';
import { NoneHistoryProvider } from './history/noneHistoryProvider';
import { ActionRepository } from './feedback/actionRepository';
import { FeedbackService } from './feedback/feedbackService';
import { LlmService } from './llm/llmService';
import { createLlmProvider } from './llm/providerFactory';
import {
    HistoryProviderDiscovery,
    IoBrokerHistoryInstanceSource,
    historyProviderSelectOptions,
    type HistoryProviderSelectOption,
} from './history/providerDiscovery';
import { ObservationEngine } from './observation/observationEngine';
import type { ObservationMetadata } from './observation/types';
import { PatternEngine } from './patterns/patternEngine';
import { observationTriggersSuggestion, type ContextStateDescriptor } from './patterns/matching';
import { LearningRepository, type LearningSnapshot } from './persistence/learningRepository';
import { DiscoveryCoordinator } from './services/discoveryCoordinator';
import { IoBrokerContextStateReader } from './services/ioBrokerContextStateReader';
import { IoBrokerPolicySynchronizer } from './services/ioBrokerPolicySynchronizer';
import { FreyaRuntime } from './services/runtime';
import { isTrustedApprovalSource } from './suggestions/approvalPolicy';
import { SuggestionService } from './suggestions/suggestionService';
import type { SuggestionStatus } from './suggestions/types';

class FreyaAdapter extends utils.Adapter {
    private readonly sourceAttribution: SourceAttributionService;
    private runtime?: FreyaRuntime;
    private discovery?: DiscoveryService;
    private policySynchronizer?: IoBrokerPolicySynchronizer;
    private contextEngine?: ContextEngine;
    private observationEngine?: ObservationEngine;
    private patternEngine?: PatternEngine;
    private suggestionService?: SuggestionService;
    private actionExecutor?: ActionExecutor;
    private readonly pendingActions = new PendingActionService();
    private runtimeConfig?: RuntimeConfig;
    private contextStateDescriptors: ContextStateDescriptor[] = [];
    private readonly actionAudit = new ActionAuditStore();
    private actionRecords: ActionRecordPort = {
        requested: () => Promise.reject(new Error('action_repository_unavailable')),
        completed: () => Promise.reject(new Error('action_repository_unavailable')),
    };
    private feedbackService?: FeedbackService;
    private llmService?: LlmService;
    private historyService?: HistoryService;
    private historyProviderOptions: HistoryProviderSelectOption[] = historyProviderSelectOptions([]);
    private readonly historyControllers = new Set<AbortController>();
    private readonly llmControllers = new Set<AbortController>();
    private readonly feedbackTasks = new Set<Promise<void>>();
    private observationMetadata = new Map<string, ObservationMetadata>();
    private observedStateIds: string[] = [];
    private historySourceIds: Record<string, string> = {};
    private policyStateIds = new Set<string>();
    private policySyncTimer?: ioBroker.Timeout;
    private roomRefreshTimer?: ioBroker.Timeout;
    private feedbackTimer?: ioBroker.Interval;
    private pendingActionTimer?: ioBroker.Interval;
    private learningRepository?: LearningRepository;
    private restoredLearning: LearningSnapshot = { patterns: [], suggestions: [], pendingActions: [] };
    private learningSaveTimer?: ioBroker.Timeout;
    private learningSaveTask?: Promise<void>;
    private learningPersistenceStatus = 'initializing';
    private unloading = false;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'freya' });
        this.sourceAttribution = new SourceAttributionService(`system.adapter.${this.namespace}`);
        this.on('ready', () => {
            void this.onReady().catch(error => {
                if (!this.unloading) {
                    this.log.error(`[Lifecycle] Startup failed: ${(error as Error).message}`);
                }
            });
        });
        this.on('message', this.onMessage.bind(this));
        this.on('objectChange', this.onObjectChange.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        const config = createRuntimeConfig(this.config);
        this.runtimeConfig = config;
        this.learningRepository = new LearningRepository(
            join(utils.getAbsoluteInstanceDataDir(this), 'learning.v1.json'),
        );
        try {
            this.restoredLearning = await this.learningRepository.load();
            this.learningPersistenceStatus =
                this.restoredLearning.patterns.length || this.restoredLearning.suggestions.length ? 'loaded' : 'empty';
        } catch (error) {
            this.learningPersistenceStatus = 'error';
            this.log.warn(`[Patterns] Persistent learning state unavailable: ${(error as Error).message.slice(0, 80)}`);
        }
        try {
            const repository = new ActionRepository(join(utils.getAbsoluteInstanceDataDir(this), 'actions.v1.json'));
            await repository.load();
            this.actionRecords = repository;
            this.feedbackService = new FeedbackService(
                repository,
                `system.adapter.${this.namespace}`,
                config.feedbackWindowSeconds * 1_000,
            );
        } catch (error) {
            this.log.warn(
                `[Feedback] Persistent action repository unavailable: ${(error as Error).message.slice(0, 80)}`,
            );
        }
        try {
            const provider = createLlmProvider(config);
            const endpointOrigin =
                provider.kind === 'openai'
                    ? 'https://api.openai.com'
                    : provider.kind === 'ollama' || provider.kind === 'openai-compatible'
                      ? new URL(config.llmBaseUrl).origin
                      : undefined;
            this.llmService = new LlmService(provider, endpointOrigin);
        } catch (error) {
            this.log.warn(`[LLM] Optional provider disabled: ${(error as Error).message.slice(0, 80)}`);
            this.llmService = new LlmService(createLlmProvider({ ...config, llmProvider: 'disabled' }));
        }
        this.policySynchronizer = new IoBrokerPolicySynchronizer(this);
        const synchronization = await this.policySynchronizer.synchronize(config.statePolicies);
        if (this.unloading || synchronization.instanceUpdated) {
            if (synchronization.instanceUpdated && !this.unloading) {
                this.log.info('[Permissions] Normalized central policies; waiting for the configured restart');
            }
            return;
        }
        const synchronizedPolicies = synchronization.policies;
        this.policyStateIds = new Set(synchronizedPolicies.map(policy => policy.stateId));
        await this.subscribeForeignObjectsAsync('*');
        const timeProvider = new TimeContextProvider();
        const sunProvider = new SunContextProvider(
            new IoBrokerCoordinateSource(this, config.manualLatitude, config.manualLongitude),
        );
        this.contextEngine = new ContextEngine(timeProvider, [sunProvider], { providerTimeoutMs: 1_000 });

        this.runtime = new FreyaRuntime(
            {
                setState: async (id, value) => {
                    await this.setOwnState(id, value);
                },
                warn: message => this.log.warn(message),
            },
            config,
        );

        await this.runtime.start();
        await this.publishLearningPersistence();
        await this.publishLlmStatus();
        await this.publishFeedbackSummary();
        this.feedbackTimer = this.setInterval(() => {
            const task = this.feedbackService?.expire().then(async () => {
                this.applyPersistedFeedback();
                this.refreshSuggestions();
                await this.publishFeedbackSummary();
            });
            if (task) {
                this.trackFeedback(task, 'Expiry');
            }
        }, 60_000);
        if (this.unloading) {
            return;
        }
        await this.initializeObservationStatus();
        if (config.discoveryEnabled) {
            this.discovery = new DiscoveryService(new IoBrokerDiscoverySource(this), {
                maxStates: config.discoveryMaxStates,
                policies: synchronizedPolicies,
                environmentMappings: config.environmentMappings,
            });
            const coordinator = new DiscoveryCoordinator(this.discovery, {
                setState: async (id, value) => {
                    await this.setOwnState(id, value);
                },
                info: message => this.log.info(message),
                warn: message => this.log.warn(message),
            });
            const discoveryResult = await coordinator.run().catch(() => undefined);
            if (this.unloading) {
                return;
            }
            if (discoveryResult) {
                const roomAssignmentsUpdated = await this.policySynchronizer.synchronizeRoomAssignments(
                    this.discovery.statePoliciesWithRoomDiagnostics(),
                );
                if (roomAssignmentsUpdated) {
                    this.log.info('[Discovery] Updated cached room assignments; waiting for the configured restart');
                    return;
                }
                await this.setupObservation(discoveryResult, timeProvider, sunProvider, config);
            }
        } else {
            await this.setOwnState('discovery.status', 'disabled');
        }
        if (this.unloading) {
            return;
        }
        if (!this.historyService) {
            await this.setupHistory(config.historyInstance);
        }
        this.log.info(
            config.learningEnabled && config.autonomyLevel >= 1
                ? '[Patterns] Freya started with read-only pattern learning enabled'
                : config.autonomyLevel === 0
                  ? '[Patterns] Freya started in observe-only mode; autonomy level 0 disables learning'
                  : '[Patterns] Freya started in observe-only mode; learning is disabled',
        );
    }

    private async initializeObservationStatus(): Promise<void> {
        await this.setOwnState('observation.subscribedStateCount', 0);
        await this.setOwnState('observation.retainedCount', 0);
        await this.setOwnState('observation.droppedCount', 0);
        await this.setOwnState('observation.lastTimestamp', 0);
    }

    private async setupHistory(configuredProvider: string): Promise<void> {
        let candidates = [] as Awaited<ReturnType<HistoryProviderDiscovery['candidates']>>;
        try {
            candidates = await new HistoryProviderDiscovery(new IoBrokerHistoryInstanceSource(this)).candidates();
        } catch (error) {
            this.log.warn(`[History] Provider discovery failed: ${(error as Error).message.slice(0, 160)}`);
        }
        if (this.unloading) {
            return;
        }
        const available = candidates.filter(descriptor => descriptor.enabled && descriptor.alive);
        this.historyProviderOptions = historyProviderSelectOptions(candidates);
        const selectedDescriptor =
            configuredProvider === 'auto'
                ? available[0]
                : available.find(descriptor => descriptor.id === configuredProvider);
        const provider = selectedDescriptor
            ? new IoBrokerHistoryProvider(selectedDescriptor, new IoBrokerHistoryTransport(this), 5_000, 2_000)
            : new NoneHistoryProvider();
        this.historyService = new HistoryService(configuredProvider, provider, available, this.observedStateIds, {
            maxRangeMs: 7 * 24 * 60 * 60 * 1_000,
            maxResults: 1_000,
            maxConcurrent: 2,
            sourceStateIds: this.historySourceIds,
        });
        await this.publishHistorySummary();
    }

    private async publishHistorySummary(): Promise<void> {
        const summary = await this.historyService?.summary();
        await this.setOwnState('history.activeProvider', summary?.activeProvider ?? 'none');
        await this.setOwnState('history.availableProviderCount', summary?.availableProviders ?? 0);
        await this.setOwnState('history.available', summary?.available ?? false);
        await this.setOwnState('history.queryCount', summary?.queryCount ?? 0);
        await this.setOwnState('history.failedQueryCount', summary?.failedQueries ?? 0);
        await this.setOwnState('history.lastQueryTimestamp', summary?.lastQueryTimestamp ?? 0);
    }

    private async backfillHistoricalLearning(
        states: DiscoveredStateView[],
        environmentCandidates: EnvironmentCandidate[],
        timeProvider: TimeContextProvider,
        sunProvider: SunContextProvider,
        config: RuntimeConfig,
    ): Promise<void> {
        if (!this.patternEngine || !this.suggestionService || !config.learningEnabled || config.autonomyLevel < 1) {
            await this.setOwnState('history.learningStatus', 'disabled');
            return;
        }
        const historySummary = await this.historyService?.summary();
        if (!historySummary?.available) {
            await this.setOwnState('history.learningStatus', 'unavailable');
            return;
        }
        const historicalStates = states.map(state => ({
            id: state.id,
            semanticType: state.semanticType,
            valueType: state.valueType,
            rooms: state.scope === 'global' ? [] : state.rooms.slice(0, 20),
            role: state.role,
            functions: state.functions.slice(0, 20),
        }));
        const baseContext = new ContextEngine(timeProvider, [sunProvider], { providerTimeoutMs: 1_000 });
        const controller = new AbortController();
        this.historyControllers.add(controller);
        await this.setOwnState('history.learningStatus', 'running');
        try {
            const end = Date.now();
            const service = new HistoricalLearningService(
                this.historyService!,
                this.patternEngine,
                async (timestamp, values) =>
                    enrichHistoricalContext(
                        await baseContext.snapshot({ timestamp }),
                        values,
                        historicalStates,
                        environmentCandidates,
                    ),
                historicalStates,
                `system.adapter.${this.namespace}`,
                { maxStates: 25, maxEntriesPerState: 1_000, maxEvents: 10_000, maxConcurrent: 2 },
            );
            const summary = await service.run(end - 7 * 24 * 60 * 60 * 1_000, end, controller.signal);
            const patterns = this.patternEngine.patterns(end);
            this.suggestionService.synchronize(patterns, end);
            await this.persistLearningState();
            const patternSummary = this.patternEngine.summary(end);
            await this.setOwnState('patterns.candidateCount', patternSummary.candidates);
            await this.setOwnState('patterns.learningCount', patternSummary.learningPatterns);
            await this.setOwnState('patterns.pendingOpportunityCount', patternSummary.pendingOpportunities);
            await this.setOwnState('patterns.retainedExampleCount', patternSummary.retainedExamples);
            await this.setOwnState('history.learningStateCount', summary.queriedStates);
            await this.setOwnState('history.learningEventCount', summary.replayedEvents);
            await this.setOwnState('history.learningFailedStateCount', summary.failedStates);
            await this.setOwnState('history.learningStatus', summary.failedStates ? 'partial' : 'completed');
            await this.publishSuggestionSummary();
            this.log.info(
                `[History] Learning backfill processed ${summary.replayedEvents} changes from ${summary.queriedStates} states: ${summary.triggerEvents} usable triggers, ${summary.lightEvents} usable light changes, ${summary.excludedEvents} source-excluded changes, ${summary.eligiblePairs} room pairs; ${summary.failedStates} state queries failed`,
            );
        } catch (error) {
            if (!this.unloading) {
                await this.setOwnState('history.learningStatus', 'error');
                this.log.warn(`[History] Learning backfill failed: ${(error as Error).message.slice(0, 80)}`);
            }
        } finally {
            this.historyControllers.delete(controller);
            await this.publishHistorySummary();
        }
    }

    private async setupObservation(
        discoveryResult: DiscoveryResult,
        timeProvider: TimeContextProvider,
        sunProvider: SunContextProvider,
        config: RuntimeConfig,
    ): Promise<void> {
        const observedStates = discoveryResult.states.filter(state => state.permissions.observe);
        const learnableObservedStates = observedStates.filter(state => state.permissions.learn);
        this.observedStateIds = observedStates.map(state => state.id);
        this.historySourceIds = Object.fromEntries(
            Object.entries(discoveryResult.historySources ?? {}).filter(([stateId]) =>
                this.observedStateIds.includes(stateId),
            ),
        );
        const reader = new IoBrokerContextStateReader(this, this.observedStateIds);
        const learnableIdSet = new Set(learnableObservedStates.map(state => state.id));
        const environmentCandidates = Object.values(discoveryResult.environment)
            .flat()
            .filter(candidate => learnableIdSet.has(candidate.stateId));
        const presenceStateIds = learnableObservedStates
            .filter(state => state.semanticType === 'presence')
            .map(state => state.id);
        this.contextEngine = new ContextEngine(
            timeProvider,
            [
                sunProvider,
                new EnvironmentContextProvider(reader, environmentCandidates),
                new WeatherContextProvider(reader, environmentCandidates),
                new PresenceContextProvider(reader, presenceStateIds),
                new DeviceContextProvider(reader, [...learnableIdSet], 25),
            ],
            { providerTimeoutMs: 1_000 },
        );
        this.observationMetadata = new Map(
            observedStates.map(state => [state.id, this.observationMetadataFor(state, observedStates)]),
        );
        const learnableStates = learnableObservedStates.map(state => ({
            id: state.id,
            semanticType: state.semanticType,
            valueType: state.valueType,
            rooms: state.scope === 'global' ? [] : state.rooms.slice(0, 20),
            canBeSuggested: state.permissions.suggest,
        }));
        const effectiveLearning = config.learningEnabled && config.autonomyLevel >= 1;
        this.patternEngine = new PatternEngine(learnableStates, { enabled: effectiveLearning });
        this.suggestionService = new SuggestionService();
        const restoredPatterns = this.patternEngine.restore(this.restoredLearning.patterns);
        const restoredSuggestions = this.suggestionService.restore(this.restoredLearning.suggestions);
        const restoredActions = this.pendingActions.restore(this.restoredLearning.pendingActions, Date.now());
        this.applyPersistedFeedback();
        this.refreshSuggestions();
        if (restoredPatterns || restoredSuggestions || restoredActions) {
            this.log.info(
                `[Patterns] Restored ${restoredPatterns} learned relationships, ${restoredSuggestions} suggestions, and ${restoredActions} action records`,
            );
        }
        this.contextStateDescriptors = learnableStates.map(state => ({
            id: state.id,
            semanticType: state.semanticType,
            rooms: state.rooms,
        }));
        await this.setupHistory(config.historyInstance);
        await this.backfillHistoricalLearning(
            learnableObservedStates,
            environmentCandidates,
            timeProvider,
            sunProvider,
            config,
        );
        const permissions = new Map(discoveryResult.states.map(state => [state.id, state.permissions]));
        this.actionExecutor = new ActionExecutor(
            new SafetyEngine(),
            new IoBrokerActionEnvironment(
                this,
                config,
                this.suggestionService,
                this.contextEngine,
                permissions,
                this.contextStateDescriptors,
            ),
            new IoBrokerActionWriter(this),
            this.actionAudit,
            this.actionRecords,
        );
        this.observationEngine = new ObservationEngine(
            this.contextEngine,
            {
                onObservation: async observation => {
                    if (this.unloading) {
                        return;
                    }
                    this.patternEngine?.observe(observation);
                    this.applyPersistedFeedback();
                    const summary = this.observationEngine?.summary();
                    const patterns = this.patternEngine?.patterns(observation.timestamp) ?? [];
                    this.suggestionService?.synchronize(patterns, observation.timestamp);
                    await this.handleActionTrigger(observation);
                    this.scheduleLearningSave();
                    await this.setOwnState('observation.retainedCount', summary?.retainedObservations ?? 0);
                    await this.setOwnState('observation.droppedCount', summary?.droppedEvents ?? 0);
                    await this.setOwnState('observation.lastTimestamp', observation.timestamp);
                    await this.setOwnState(
                        'patterns.candidateCount',
                        patterns.filter(pattern => pattern.status === 'candidate').length,
                    );
                    const patternSummary = this.patternEngine?.summary(observation.timestamp);
                    await this.setOwnState('patterns.learningCount', patternSummary?.learningPatterns ?? 0);
                    await this.setOwnState(
                        'patterns.pendingOpportunityCount',
                        patternSummary?.pendingOpportunities ?? 0,
                    );
                    await this.setOwnState('patterns.retainedExampleCount', patternSummary?.retainedExamples ?? 0);
                    await this.publishSuggestionSummary();
                },
                onError: message => this.log.warn(message),
                debug: message => this.log.debug(message),
            },
            this.observedStateIds.length,
            { maxQueue: 500, maxRetained: 500 },
        );
        await this.setOwnState('learning.observedStateCount', this.observedStateIds.length);
        await this.setOwnState('observation.subscribedStateCount', this.observedStateIds.length);
        const patternSummary = this.patternEngine.summary();
        await this.setOwnState('patterns.candidateCount', patternSummary.candidates);
        await this.setOwnState('patterns.learningCount', patternSummary.learningPatterns);
        await this.setOwnState('patterns.pendingOpportunityCount', patternSummary.pendingOpportunities);
        await this.setOwnState('patterns.retainedExampleCount', patternSummary.retainedExamples);
        await this.publishSuggestionSummary();
        await this.publishPendingActionSummary();
        await this.publishLearningPersistence(this.patternEngine.snapshot().length);
        this.pendingActionTimer = this.setInterval(() => {
            if (this.pendingActions.expire(Date.now()) > 0) {
                this.scheduleLearningSave();
                void this.publishPendingActionSummary().catch(error => {
                    if (!this.unloading) {
                        this.log.warn(`[Actions] Pending summary failed: ${(error as Error).message.slice(0, 80)}`);
                    }
                });
            }
        }, 5_000);
        if (this.observedStateIds.length) {
            const initialStates = await this.getForeignStatesAsync(this.observedStateIds);
            if (this.unloading) {
                return;
            }
            this.observationEngine.prime(initialStates);
            await this.subscribeForeignStatesAsync(this.observedStateIds);
        }
    }

    private observationMetadataFor(
        state: DiscoveredStateView,
        observedStates: DiscoveredStateView[],
    ): ObservationMetadata {
        const relatedStateIds = observedStates
            .filter(candidate => candidate.id !== state.id && candidate.rooms.some(room => state.rooms.includes(room)))
            .map(candidate => candidate.id)
            .slice(0, 25);
        return {
            semanticType: state.semanticType,
            role: state.role,
            rooms: state.rooms.slice(0, 20).map(room => room.slice(0, 120)),
            functions: state.functions.slice(0, 20).map(item => item.slice(0, 120)),
            relatedStateIds,
        };
    }

    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (this.unloading) {
            return;
        }
        const attribution = this.sourceAttribution.classify(id, state ?? null, state?.ts);
        const metadata = this.observationMetadata.get(id);
        if (metadata) {
            this.observationEngine?.ingest(id, state ?? null, metadata, attribution);
        }
        if (state && this.feedbackService) {
            const task = this.feedbackService.observe(id, state, state.ts, attribution).then(async () => {
                this.applyPersistedFeedback();
                this.refreshSuggestions(state.ts);
                this.scheduleLearningSave();
                await this.publishFeedbackSummary();
            });
            this.trackFeedback(task, 'Attribution');
        }
    }

    private onObjectChange(id: string, object: ioBroker.Object | null | undefined): void {
        if (this.unloading) {
            return;
        }
        if (id.startsWith('enum.rooms.')) {
            this.scheduleRoomRefresh();
            return;
        }
        const custom = object?.type === 'state' ? object.common.custom?.[this.namespace] : undefined;
        if (!custom && !this.policyStateIds.has(id)) {
            return;
        }
        if (this.policySyncTimer) {
            this.clearTimeout(this.policySyncTimer);
        }
        this.policySyncTimer = this.setTimeout(() => {
            void this.policySynchronizer
                ?.synchronize()
                .then(result => {
                    this.policyStateIds = new Set(result.policies.map(policy => policy.stateId));
                })
                .catch(error => {
                    if (!this.unloading) {
                        this.log.warn(`[Permissions] Synchronization failed: ${(error as Error).message}`);
                    }
                });
        }, 250);
    }

    private scheduleRoomRefresh(): void {
        if (this.roomRefreshTimer) {
            this.clearTimeout(this.roomRefreshTimer);
        }
        this.roomRefreshTimer = this.setTimeout(() => {
            this.roomRefreshTimer = undefined;
            void this.refreshRoomAssignments().catch(error => {
                if (!this.unloading) {
                    this.log.warn(`[Discovery] Room refresh failed: ${(error as Error).message.slice(0, 80)}`);
                }
            });
        }, 500);
    }

    private async refreshRoomAssignments(): Promise<void> {
        if (!this.policySynchronizer || !this.runtimeConfig || this.unloading) {
            return;
        }
        const synchronization = await this.policySynchronizer.synchronize();
        if (synchronization.instanceUpdated || this.unloading) {
            return;
        }
        const discovery = new DiscoveryService(new IoBrokerDiscoverySource(this), {
            maxStates: this.runtimeConfig.discoveryMaxStates,
            policies: synchronization.policies,
            environmentMappings: this.runtimeConfig.environmentMappings,
        });
        await discovery.run();
        if (this.unloading) {
            return;
        }
        const updated = await this.policySynchronizer.synchronizeRoomAssignments(
            discovery.statePoliciesWithRoomDiagnostics(),
        );
        if (updated) {
            this.log.info('[Discovery] Room assignments changed; waiting for the configured restart');
        } else {
            this.discovery = discovery;
        }
    }

    private async onMessage(message: ioBroker.Message): Promise<void> {
        if (!message.callback) {
            return;
        }
        if (message.command === 'reportExternalIntent') {
            const input = this.messageInput(message.message);
            const stateId = typeof input.stateId === 'string' ? input.stateId : '';
            const origin = input.origin === 'user' || input.origin === 'automation' ? input.origin : undefined;
            const value = input.value;
            const validValue =
                value === null ||
                typeof value === 'boolean' ||
                (typeof value === 'number' && Number.isFinite(value)) ||
                (typeof value === 'string' && value.length <= 2_000);
            const accepted =
                /^system\.adapter\.[\w-]+\.\d+$/.test(message.from) &&
                this.observedStateIds.includes(stateId) &&
                origin !== undefined &&
                validValue &&
                this.sourceAttribution.reportIntent(stateId, value, origin, message.from, Date.now());
            this.sendTo(
                message.from,
                message.command,
                { accepted, reason: accepted ? 'intent_recorded' : 'intent_rejected' },
                message.callback,
            );
            return;
        }
        if (message.command === 'getDiscoverySummary') {
            this.sendTo(message.from, message.command, this.discovery?.summary() ?? null, message.callback);
            return;
        }
        if (message.command === 'getRoomDiagnostics') {
            this.sendTo(
                message.from,
                message.command,
                { native: { statePolicies: this.discovery?.statePoliciesWithRoomDiagnostics() ?? [] } },
                message.callback,
            );
            return;
        }
        if (message.command === 'getDiscoveredStates') {
            const input =
                typeof message.message === 'object' && message.message
                    ? (message.message as Record<string, unknown>)
                    : {};
            const page = typeof input.page === 'number' ? input.page : 0;
            const pageSize = typeof input.pageSize === 'number' ? input.pageSize : 50;
            const query = typeof input.query === 'string' ? input.query : '';
            this.sendTo(
                message.from,
                message.command,
                this.discovery?.page(page, pageSize, query) ?? null,
                message.callback,
            );
            return;
        }
        if (message.command === 'getContextSnapshot') {
            const input =
                typeof message.message === 'object' && message.message
                    ? (message.message as Record<string, unknown>)
                    : {};
            const requestedTimestamp = typeof input.timestamp === 'number' ? input.timestamp : Date.now();
            const timestamp = Number.isFinite(requestedTimestamp) ? requestedTimestamp : Date.now();
            try {
                const snapshot = await this.contextEngine?.snapshot({ timestamp });
                this.sendTo(message.from, message.command, snapshot ?? null, message.callback);
            } catch (error) {
                this.sendTo(
                    message.from,
                    message.command,
                    { error: 'context_snapshot_failed', message: (error as Error).message },
                    message.callback,
                );
            }
            return;
        }
        if (message.command === 'getObservationSummary') {
            this.sendTo(message.from, message.command, this.observationEngine?.summary() ?? null, message.callback);
            return;
        }
        if (message.command === 'getPatternSummary') {
            this.sendTo(message.from, message.command, this.patternEngine?.summary() ?? null, message.callback);
            return;
        }
        if (message.command === 'getSuggestionSummary') {
            this.sendTo(message.from, message.command, this.suggestionService?.summary() ?? null, message.callback);
            return;
        }
        if (message.command === 'getPatternAdminData') {
            if (!isTrustedApprovalSource(message.from)) {
                this.sendTo(message.from, message.command, { text: 'Pattern view denied.' }, message.callback);
                return;
            }
            this.sendTo(
                message.from,
                message.command,
                {
                    text: this.adminCardListHtml(this.patternAdminRows(), [
                        ['status', 'Status'],
                        ['eligible', 'Eligible'],
                        ['rooms', 'Rooms'],
                        ['trigger', 'Trigger'],
                        ['target', 'Target'],
                        ['action', 'Action'],
                        ['confidence', 'Confidence'],
                        ['evidence', 'Evidence'],
                        ['explanation', 'Explanation'],
                    ]),
                },
                message.callback,
            );
            return;
        }
        if (message.command === 'getPatternOptions') {
            if (!isTrustedApprovalSource(message.from)) {
                this.sendTo(message.from, message.command, [], message.callback);
                return;
            }
            const suggestions = new Map(
                (this.suggestionService?.list(undefined, 0, 100).items ?? []).map(suggestion => [
                    suggestion.id,
                    suggestion,
                ]),
            );
            const optionsById = new Map<string, { label: string; value: string }>();
            for (const pattern of this.patternEngine?.patterns().slice(0, 100) ?? []) {
                const status = suggestions.get(pattern.id)?.status ?? pattern.status;
                optionsById.set(pattern.id, {
                    label: `${status.toUpperCase()} · ${pattern.rooms.join(', ') || 'Global'} · ${pattern.triggerStateId} → ${pattern.actionStateId} = ${String(pattern.expectedAction)}`.slice(
                        0,
                        500,
                    ),
                    value: pattern.id,
                });
            }
            for (const suggestion of suggestions.values()) {
                if (!optionsById.has(suggestion.id)) {
                    optionsById.set(suggestion.id, {
                        label: `${suggestion.status.toUpperCase()} · ${suggestion.rooms.join(', ') || 'Global'} · ${suggestion.triggerStateId} → ${suggestion.actionStateId} = ${String(suggestion.expectedAction)}`.slice(
                            0,
                            500,
                        ),
                        value: suggestion.id,
                    });
                }
            }
            const options = [...optionsById.values()];
            this.sendTo(message.from, message.command, options, message.callback);
            return;
        }
        if (message.command === 'getPendingActionAdminData') {
            if (!isTrustedApprovalSource(message.from)) {
                this.sendTo(message.from, message.command, { text: 'Action proposal view denied.' }, message.callback);
                return;
            }
            this.pendingActions.expire(Date.now());
            await this.persistLearningState();
            await this.publishPendingActionSummary();
            this.sendTo(
                message.from,
                message.command,
                {
                    text: this.adminCardListHtml(this.pendingActionAdminRows(), [
                        ['status', 'Status'],
                        ['rooms', 'Rooms'],
                        ['trigger', 'Trigger'],
                        ['target', 'Target'],
                        ['action', 'Action'],
                        ['confidence', 'Confidence'],
                        ['expires', 'Expires'],
                        ['result', 'Result'],
                    ]),
                },
                message.callback,
            );
            return;
        }
        if (message.command === 'getPendingActionOptions') {
            if (!isTrustedApprovalSource(message.from)) {
                this.sendTo(message.from, message.command, [], message.callback);
                return;
            }
            this.pendingActions.expire(Date.now());
            const options = this.pendingActions.list('pending', 0, 100).items.map(action => ({
                label: `${action.rooms.join(', ') || 'Global'} · ${action.triggerStateId} → ${action.targetStateId} = ${String(action.value)} · ${Math.max(0, Math.ceil((action.expiresAt - Date.now()) / 1_000))}s`.slice(
                    0,
                    500,
                ),
                value: action.id,
            }));
            this.sendTo(message.from, message.command, options, message.callback);
            return;
        }
        if (message.command === 'approvePendingAction') {
            const input = this.messageInput(message.message);
            const id = typeof input.pendingActionId === 'string' ? input.pendingActionId : '';
            if (!isTrustedApprovalSource(message.from)) {
                this.sendTo(
                    message.from,
                    message.command,
                    { accepted: false, reason: 'approval_source_denied' },
                    message.callback,
                );
                return;
            }
            const result = await this.executePendingAction(id);
            this.sendTo(message.from, message.command, result, message.callback);
            return;
        }
        if (message.command === 'rejectPendingAction') {
            const input = this.messageInput(message.message);
            const id = typeof input.pendingActionId === 'string' ? input.pendingActionId : '';
            if (!isTrustedApprovalSource(message.from)) {
                this.sendTo(
                    message.from,
                    message.command,
                    { accepted: false, reason: 'approval_source_denied' },
                    message.callback,
                );
                return;
            }
            const previous = this.pendingActions.snapshot();
            const result = this.pendingActions.reject(id, Date.now());
            if (result.accepted) {
                try {
                    await this.persistLearningState();
                } catch (error) {
                    this.pendingActions.restore(previous, Date.now());
                    this.log.warn(`[Actions] Rejection persistence failed: ${(error as Error).message.slice(0, 80)}`);
                    this.sendTo(
                        message.from,
                        message.command,
                        { accepted: false, reason: 'persistence_failed' },
                        message.callback,
                    );
                    return;
                }
            }
            await this.publishPendingActionSummary();
            this.sendTo(message.from, message.command, result, message.callback);
            return;
        }
        if (message.command === 'getLlmStatus') {
            this.sendTo(message.from, message.command, this.llmService?.status() ?? null, message.callback);
            return;
        }
        if (message.command === 'testLlmConnection') {
            if (!isTrustedApprovalSource(message.from)) {
                this.sendTo(
                    message.from,
                    message.command,
                    { ok: false, error: 'llm_test_source_denied' },
                    message.callback,
                );
                return;
            }
            if (!this.llmService) {
                this.sendTo(message.from, message.command, { ok: false, error: 'llm_unavailable' }, message.callback);
                return;
            }
            const requestId = randomUUID();
            const controller = new AbortController();
            this.llmControllers.add(controller);
            try {
                const result = await this.llmService.testConnection(requestId, controller.signal);
                await this.setOwnState('llm.lastResult', JSON.stringify({ requestId, test: result }).slice(0, 2_000));
                this.sendTo(message.from, message.command, { requestId, ...result }, message.callback);
            } catch (error) {
                const rawCode = (error as Error).message;
                const errorCode = /^llm_[a-z0-9_]+$/.test(rawCode) ? rawCode : 'llm_failed';
                await this.setOwnState(
                    'llm.lastResult',
                    JSON.stringify({ requestId, test: { ok: false, error: errorCode } }),
                );
                this.sendTo(
                    message.from,
                    message.command,
                    { requestId, ok: false, error: errorCode },
                    message.callback,
                );
            } finally {
                this.llmControllers.delete(controller);
            }
            return;
        }
        if (message.command === 'previewLlmDisclosure') {
            const input = this.messageInput(message.message);
            const patternId = typeof input.patternId === 'string' ? input.patternId : '';
            const suggestion = /^[a-f0-9]{16}$/.test(patternId) ? this.suggestionService?.find(patternId) : undefined;
            if (!suggestion || !this.llmService) {
                this.sendTo(message.from, message.command, { error: 'pattern_not_found' }, message.callback);
                return;
            }
            this.sendTo(
                message.from,
                message.command,
                this.llmService.preview(suggestion, randomUUID()),
                message.callback,
            );
            return;
        }
        if (message.command === 'analyzePattern') {
            const input = this.messageInput(message.message);
            const patternId = typeof input.patternId === 'string' ? input.patternId : '';
            if (!isTrustedApprovalSource(message.from)) {
                this.sendTo(message.from, message.command, { error: 'analysis_source_denied' }, message.callback);
                return;
            }
            const suggestion = /^[a-f0-9]{16}$/.test(patternId) ? this.suggestionService?.find(patternId) : undefined;
            if (!suggestion || !this.llmService) {
                this.sendTo(message.from, message.command, { error: 'pattern_not_found' }, message.callback);
                return;
            }
            const requestId = randomUUID();
            const controller = new AbortController();
            this.llmControllers.add(controller);
            try {
                const analysis = await this.llmService.analyze(suggestion, requestId, controller.signal);
                await this.setOwnState('llm.lastResult', JSON.stringify({ requestId, ...analysis }).slice(0, 2_000));
                this.sendTo(message.from, message.command, { requestId, analysis }, message.callback);
            } catch (error) {
                const rawCode = (error as Error).message;
                const errorCode = /^llm_[a-z0-9_]+$/.test(rawCode) ? rawCode : 'llm_failed';
                await this.setOwnState('llm.lastResult', JSON.stringify({ requestId, error: errorCode }));
                this.sendTo(message.from, message.command, { requestId, error: errorCode }, message.callback);
            } finally {
                this.llmControllers.delete(controller);
            }
            return;
        }
        if (message.command === 'getSuggestions') {
            const input = this.messageInput(message.message);
            const requestedStatus = typeof input.status === 'string' ? input.status : undefined;
            const validStatuses = new Set<SuggestionStatus>(['candidate', 'approved', 'disabled']);
            if (requestedStatus !== undefined && !validStatuses.has(requestedStatus as SuggestionStatus)) {
                this.sendTo(message.from, message.command, { error: 'invalid_status' }, message.callback);
                return;
            }
            const page = typeof input.page === 'number' ? input.page : 0;
            const pageSize = typeof input.pageSize === 'number' ? input.pageSize : 50;
            this.sendTo(
                message.from,
                message.command,
                this.suggestionService?.list(requestedStatus as SuggestionStatus | undefined, page, pageSize) ?? null,
                message.callback,
            );
            return;
        }
        if (message.command === 'getActivity') {
            const input = this.messageInput(message.message);
            const page = typeof input.page === 'number' ? input.page : 0;
            const pageSize = typeof input.pageSize === 'number' ? input.pageSize : 50;
            this.sendTo(
                message.from,
                message.command,
                this.suggestionService?.activityPage(page, pageSize) ?? null,
                message.callback,
            );
            return;
        }
        if (message.command === 'getActionAudit') {
            const input = this.messageInput(message.message);
            const page = typeof input.page === 'number' ? input.page : 0;
            const pageSize = typeof input.pageSize === 'number' ? input.pageSize : 50;
            this.sendTo(message.from, message.command, this.actionAudit.page(page, pageSize), message.callback);
            return;
        }
        if (message.command === 'getFeedbackSummary') {
            this.sendTo(message.from, message.command, this.feedbackService?.summary() ?? null, message.callback);
            return;
        }
        if (message.command === 'getActionRecords') {
            if (!isTrustedApprovalSource(message.from)) {
                this.sendTo(message.from, message.command, { error: 'action_records_source_denied' }, message.callback);
                return;
            }
            const input = this.messageInput(message.message);
            const page = typeof input.page === 'number' ? input.page : 0;
            const pageSize = typeof input.pageSize === 'number' ? input.pageSize : 50;
            this.sendTo(
                message.from,
                message.command,
                this.feedbackService?.actions(page, pageSize) ?? null,
                message.callback,
            );
            return;
        }
        if (message.command === 'submitFeedback') {
            const input = this.messageInput(message.message);
            const correlationId = typeof input.correlationId === 'string' ? input.correlationId : '';
            const outcome = typeof input.outcome === 'string' ? input.outcome : '';
            const reason = typeof input.reason === 'string' ? input.reason : undefined;
            if (!isTrustedApprovalSource(message.from)) {
                this.sendTo(
                    message.from,
                    message.command,
                    { accepted: false, reason: 'feedback_source_denied' },
                    message.callback,
                );
                return;
            }
            if (
                !/^[a-z0-9-]{1,80}$/i.test(correlationId) ||
                !new Set(['positive', 'negative', 'neutral']).has(outcome)
            ) {
                this.sendTo(
                    message.from,
                    message.command,
                    { accepted: false, reason: 'feedback_input_invalid' },
                    message.callback,
                );
                return;
            }
            const result = await this.feedbackService?.explicit(
                correlationId,
                outcome as 'positive' | 'negative' | 'neutral',
                message.from,
                Date.now(),
                reason,
            );
            this.applyPersistedFeedback();
            this.refreshSuggestions();
            await this.publishFeedbackSummary();
            await this.publishSuggestionSummary();
            this.sendTo(
                message.from,
                message.command,
                result ?? { accepted: false, reason: 'feedback_unavailable' },
                message.callback,
            );
            return;
        }
        if (message.command === 'executePattern') {
            const input = this.messageInput(message.message);
            const patternId = typeof input.patternId === 'string' ? input.patternId : '';
            if (!isTrustedApprovalSource(message.from)) {
                this.sendTo(
                    message.from,
                    message.command,
                    { executed: false, error: 'action_source_denied' },
                    message.callback,
                );
                return;
            }
            if (!/^[a-f0-9]{16}$/.test(patternId)) {
                this.sendTo(
                    message.from,
                    message.command,
                    { executed: false, error: 'invalid_pattern_id' },
                    message.callback,
                );
                return;
            }
            const suggestion = this.suggestionService?.find(patternId);
            if (!suggestion || !this.actionExecutor) {
                this.sendTo(
                    message.from,
                    message.command,
                    { executed: false, error: 'pattern_not_found' },
                    message.callback,
                );
                return;
            }
            const timestamp = Date.now();
            const result = await this.actionExecutor.execute({
                correlationId: randomUUID(),
                patternId,
                targetStateId: suggestion.actionStateId,
                value: suggestion.expectedAction,
                createdAt: timestamp,
                expiresAt: timestamp + 10_000,
                contextTimestamp: timestamp,
                authorization: 'one-shot',
            });
            await this.publishActionResult(result);
            await this.publishFeedbackSummary();
            this.sendTo(message.from, message.command, result, message.callback);
            return;
        }
        if (message.command === 'setPatternStatus') {
            const input = this.messageInput(message.message);
            const patternId = typeof input.patternId === 'string' ? input.patternId : '';
            const status = typeof input.status === 'string' ? input.status : '';
            const timestamp = Date.now();
            let result;
            const previousSuggestions = this.suggestionService?.snapshot() ?? [];
            if (!isTrustedApprovalSource(message.from)) {
                result = this.suggestionService?.rejectCommand(
                    patternId,
                    message.from,
                    'approval_source_denied',
                    timestamp,
                );
            } else if (!/^[a-f0-9]{16}$/.test(patternId)) {
                result = this.suggestionService?.rejectCommand(
                    patternId,
                    message.from,
                    'invalid_pattern_id',
                    timestamp,
                );
            } else if (!new Set(['candidate', 'approved', 'disabled']).has(status)) {
                result = this.suggestionService?.rejectCommand(patternId, message.from, 'invalid_status', timestamp);
            } else {
                result = this.suggestionService?.transition(
                    patternId,
                    status as SuggestionStatus,
                    message.from,
                    timestamp,
                );
            }
            if (result?.changed) {
                try {
                    await this.persistLearningState();
                } catch (error) {
                    this.suggestionService?.restore(previousSuggestions);
                    result = { accepted: false, changed: false, reason: 'persistence_failed' };
                    this.log.warn(`[Patterns] Approval persistence failed: ${(error as Error).message.slice(0, 80)}`);
                }
            }
            await this.publishSuggestionSummary();
            this.sendTo(
                message.from,
                message.command,
                result ?? { accepted: false, reason: 'unavailable' },
                message.callback,
            );
            return;
        }
        if (message.command === 'resetPatternLearning' || message.command === 'deletePattern') {
            const input = this.messageInput(message.message);
            const patternId = typeof input.patternId === 'string' ? input.patternId : '';
            if (!isTrustedApprovalSource(message.from)) {
                this.sendTo(
                    message.from,
                    message.command,
                    { accepted: false, reason: 'pattern_source_denied' },
                    message.callback,
                );
                return;
            }
            if (!/^[a-f0-9]{16}$/.test(patternId) || !this.patternEngine || !this.suggestionService) {
                this.sendTo(
                    message.from,
                    message.command,
                    { accepted: false, reason: 'invalid_pattern_id' },
                    message.callback,
                );
                return;
            }
            const timestamp = Date.now();
            const previousPatterns = this.patternEngine.snapshot();
            const previousSuggestions = this.suggestionService.snapshot();
            const previousActions = this.pendingActions.snapshot();
            const reset = message.command === 'resetPatternLearning';
            const evidenceChanged = reset
                ? this.patternEngine.resetPattern(patternId, timestamp)
                : this.patternEngine.deletePattern(patternId);
            const suggestionChanged = this.suggestionService.remove(
                patternId,
                message.from,
                timestamp,
                reset ? 'learning_reset' : 'pattern_deleted',
            );
            if (!evidenceChanged && !suggestionChanged) {
                this.sendTo(
                    message.from,
                    message.command,
                    { accepted: false, reason: 'pattern_not_found' },
                    message.callback,
                );
                return;
            }
            this.pendingActions.rejectPattern(patternId, timestamp);
            try {
                await this.persistLearningState();
                await this.feedbackService?.resetLearningFeedback(patternId);
            } catch (error) {
                this.patternEngine.deletePattern(patternId);
                this.patternEngine.restore(previousPatterns);
                this.suggestionService.restore(previousSuggestions);
                this.pendingActions.restore(previousActions, timestamp, false);
                try {
                    await this.persistLearningState();
                } catch (rollbackError) {
                    this.log.error(
                        `[Patterns] Rollback persistence failed: ${(rollbackError as Error).message.slice(0, 80)}`,
                    );
                }
                this.log.warn(
                    `[Patterns] Destructive change persistence failed: ${(error as Error).message.slice(0, 80)}`,
                );
                this.sendTo(
                    message.from,
                    message.command,
                    { accepted: false, reason: 'persistence_failed' },
                    message.callback,
                );
                return;
            }
            await this.publishPatternSummary();
            await this.publishSuggestionSummary();
            await this.publishPendingActionSummary();
            this.sendTo(
                message.from,
                message.command,
                { accepted: true, changed: true, reason: reset ? 'learning_reset' : 'pattern_deleted' },
                message.callback,
            );
            return;
        }
        if (message.command === 'getPatterns') {
            const input =
                typeof message.message === 'object' && message.message
                    ? (message.message as Record<string, unknown>)
                    : {};
            const requestedLimit = typeof input.limit === 'number' ? Math.floor(input.limit) : 50;
            const limit = Math.max(1, Math.min(requestedLimit, 100));
            this.sendTo(
                message.from,
                message.command,
                this.patternEngine?.patterns().slice(0, limit) ?? [],
                message.callback,
            );
            return;
        }
        if (message.command === 'getObservations') {
            const input =
                typeof message.message === 'object' && message.message
                    ? (message.message as Record<string, unknown>)
                    : {};
            const page = typeof input.page === 'number' ? input.page : 0;
            const pageSize = typeof input.pageSize === 'number' ? input.pageSize : 50;
            this.sendTo(
                message.from,
                message.command,
                this.observationEngine?.page(page, pageSize) ?? null,
                message.callback,
            );
            return;
        }
        if (message.command === 'getHistoryStatus') {
            this.sendTo(
                message.from,
                message.command,
                (await this.historyService?.summary()) ?? null,
                message.callback,
            );
            return;
        }
        if (message.command === 'getHistoryProviderOptions') {
            this.sendTo(message.from, message.command, this.historyProviderOptions, message.callback);
            return;
        }
        if (message.command === 'getStateHistory') {
            const input =
                typeof message.message === 'object' && message.message
                    ? (message.message as Record<string, unknown>)
                    : {};
            const stateId = typeof input.stateId === 'string' ? input.stateId : '';
            const start = typeof input.start === 'number' ? input.start : Number.NaN;
            const end = typeof input.end === 'number' ? input.end : Number.NaN;
            const limit = typeof input.limit === 'number' ? input.limit : undefined;
            const controller = new AbortController();
            this.historyControllers.add(controller);
            try {
                const entries = await this.historyService?.query(stateId, start, end, limit, controller.signal);
                this.sendTo(message.from, message.command, { entries: entries ?? [] }, message.callback);
            } catch (error) {
                const errorCode = (error as Error).message.split(':', 1)[0].slice(0, 80);
                this.sendTo(message.from, message.command, { error: errorCode }, message.callback);
            } finally {
                this.historyControllers.delete(controller);
                await this.publishHistorySummary();
            }
            return;
        }
        this.sendTo(message.from, message.command, { error: 'unsupported_command' }, message.callback);
    }

    private onUnload(callback: () => void): void {
        this.unloading = true;
        void this.shutdown(callback);
    }

    private messageInput(message: ioBroker.Message['message']): Record<string, unknown> {
        return typeof message === 'object' && message ? (message as Record<string, unknown>) : {};
    }

    private async publishSuggestionSummary(): Promise<void> {
        const summary = this.suggestionService?.summary();
        await this.setOwnState('patterns.approvedCount', summary?.approved ?? 0);
        await this.setOwnState('patterns.disabledCount', summary?.disabled ?? 0);
        await this.setOwnState('suggestions.candidateCount', summary?.candidates ?? 0);
        await this.setOwnState(
            'suggestions.latest',
            this.suggestionService?.latestExplanation().slice(0, 2_000) ?? 'none',
        );
        await this.setOwnState('activity.count', summary?.activityCount ?? 0);
        await this.setOwnState('activity.lastTimestamp', summary?.lastActivityTimestamp ?? 0);
    }

    private async publishPatternSummary(): Promise<void> {
        const summary = this.patternEngine?.summary();
        await this.setOwnState('patterns.candidateCount', summary?.candidates ?? 0);
        await this.setOwnState('patterns.learningCount', summary?.learningPatterns ?? 0);
        await this.setOwnState('patterns.pendingOpportunityCount', summary?.pendingOpportunities ?? 0);
        await this.setOwnState('patterns.retainedExampleCount', summary?.retainedExamples ?? 0);
    }

    private patternAdminRows(): Array<Record<string, ioBroker.StateValue>> {
        const suggestions = new Map(
            (this.suggestionService?.list(undefined, 0, 100).items ?? []).map(suggestion => [
                suggestion.id,
                suggestion,
            ]),
        );
        const rows = (this.patternEngine?.patterns().slice(0, 100) ?? []).map(pattern => {
            const suggestion = suggestions.get(pattern.id);
            suggestions.delete(pattern.id);
            return {
                patternId: pattern.id,
                status: suggestion?.status ?? pattern.status,
                eligible: pattern.suggestionEligible ? '✓' : '…',
                rooms: pattern.rooms.join(', ') || 'Global',
                trigger: pattern.triggerStateId,
                target: pattern.actionStateId,
                action: String(pattern.expectedAction),
                confidence: `${Math.round(pattern.confidence * 100)} %`,
                evidence: `${pattern.matches}/${pattern.opportunities} · ${pattern.distinctDays} d`,
                explanation: pattern.explanation.slice(0, 2_000),
            };
        });
        for (const suggestion of suggestions.values()) {
            rows.push({
                patternId: suggestion.id,
                status: suggestion.status,
                eligible: suggestion.eligible ? '✓' : '—',
                rooms: suggestion.rooms.join(', ') || 'Global',
                trigger: suggestion.triggerStateId,
                target: suggestion.actionStateId,
                action: String(suggestion.expectedAction),
                confidence: `${Math.round(suggestion.confidence * 100)} %`,
                evidence: `${suggestion.matches}/${suggestion.opportunities}`,
                explanation: suggestion.explanation.slice(0, 2_000),
            });
        }
        return rows.slice(0, 100);
    }

    /** Runtime-only cards keep the admin configuration clean while remaining readable on narrow screens. */
    private adminCardListHtml(
        rows: Array<Record<string, ioBroker.StateValue>>,
        columns: Array<[key: string, title: string]>,
    ): string {
        const escape = (value: ioBroker.StateValue | undefined): string => {
            const text =
                value === null || value === undefined
                    ? ''
                    : typeof value === 'string'
                      ? value
                      : typeof value === 'number' || typeof value === 'boolean'
                        ? String(value)
                        : JSON.stringify(value);
            return text
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;');
        };
        if (!rows.length) {
            return '<div style="padding:12px 0;font-size:14px;opacity:.75">No entries available.</div>';
        }
        const cards = rows
            .map(row => {
                const status = escape(row.status);
                const rooms = escape(row.rooms);
                const fields = columns
                    .filter(([key]) => !['status', 'rooms', 'explanation'].includes(key))
                    .map(
                        ([key, title]) =>
                            `<div style="min-width:180px;flex:1 1 220px;padding:4px 0"><span style="display:block;font-size:12px;opacity:.7">${escape(title)}</span><span style="overflow-wrap:anywhere">${escape(row[key])}</span></div>`,
                    )
                    .join('');
                const explanation = row.explanation
                    ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(127,127,127,.3);line-height:1.45"><span style="display:block;font-size:12px;opacity:.7">Explanation</span>${escape(row.explanation)}</div>`
                    : '';
                return `<div style="margin:10px 0;padding:14px 16px;border:1px solid rgba(127,127,127,.45);border-radius:6px;font-size:14px;line-height:1.35"><div style="display:flex;gap:12px;justify-content:space-between;align-items:baseline;flex-wrap:wrap"><strong style="font-size:15px">${status}</strong><span style="opacity:.8">${rooms}</span></div><div style="display:flex;gap:8px 18px;flex-wrap:wrap;margin-top:8px">${fields}</div>${explanation}</div>`;
            })
            .join('');
        return `<div style="width:100%;max-width:100%">${cards}</div>`;
    }

    private async publishActionResult(result: Awaited<ReturnType<ActionExecutor['execute']>>): Promise<void> {
        await this.setOwnState(
            'actions.lastResult',
            JSON.stringify({
                correlationId: result.correlationId,
                executed: result.executed,
                reasons: result.reasons,
                errorCode: result.errorCode,
            }).slice(0, 2_000),
        );
        await this.setOwnState('actions.auditCount', this.actionAudit.page(0, 1).total);
    }

    private async handleActionTrigger(observation: Parameters<typeof observationTriggersSuggestion>[0]): Promise<void> {
        const level = this.runtimeConfig?.autonomyLevel ?? 0;
        if (level < 2 || !this.suggestionService || !this.actionExecutor) {
            return;
        }
        const matching = this.suggestionService
            .snapshot()
            .filter(suggestion => observationTriggersSuggestion(observation, suggestion, this.contextStateDescriptors));
        for (const suggestion of matching) {
            const id = randomUUID();
            const previous = this.pendingActions.snapshot();
            if (level === 2) {
                if (this.pendingActions.propose(suggestion, observation.timestamp, id)) {
                    try {
                        await this.persistLearningState();
                        await this.publishPendingActionSummary();
                    } catch (error) {
                        this.pendingActions.restore(previous, Date.now());
                        this.log.warn(
                            `[Actions] Proposal persistence failed: ${(error as Error).message.slice(0, 80)}`,
                        );
                    }
                }
                continue;
            }
            const claim = this.pendingActions.beginAutomatic(suggestion, observation.timestamp, id);
            if (!claim.accepted || !claim.request) {
                continue;
            }
            try {
                await this.persistLearningState();
            } catch (error) {
                this.pendingActions.restore(previous, Date.now());
                this.log.warn(`[Actions] Automatic claim persistence failed: ${(error as Error).message.slice(0, 80)}`);
                continue;
            }
            const result = await this.actionExecutor.execute(claim.request);
            this.pendingActions.complete(id, result, Date.now());
            try {
                await this.persistLearningState();
            } catch (error) {
                this.log.warn(`[Actions] Result persistence failed: ${(error as Error).message.slice(0, 80)}`);
            }
            await this.publishActionResult(result);
            await this.publishFeedbackSummary();
            await this.publishPendingActionSummary();
        }
    }

    private async executePendingAction(id: string): Promise<unknown> {
        if (!this.actionExecutor) {
            return { accepted: false, reason: 'action_executor_unavailable' };
        }
        const previous = this.pendingActions.snapshot();
        const claim = this.pendingActions.claimOneShot(id, Date.now());
        if (!claim.accepted || !claim.request) {
            return claim;
        }
        try {
            await this.persistLearningState();
        } catch (error) {
            this.pendingActions.restore(previous, Date.now());
            this.log.warn(`[Actions] Approval persistence failed: ${(error as Error).message.slice(0, 80)}`);
            return { accepted: false, reason: 'persistence_failed' };
        }
        const result = await this.actionExecutor.execute(claim.request);
        this.pendingActions.complete(id, result, Date.now());
        let pendingPersistenceFailed = false;
        try {
            await this.persistLearningState();
        } catch (error) {
            pendingPersistenceFailed = true;
            this.log.warn(`[Actions] Result persistence failed: ${(error as Error).message.slice(0, 80)}`);
        }
        await this.publishActionResult(result);
        await this.publishFeedbackSummary();
        await this.publishPendingActionSummary();
        return {
            accepted: true,
            reason: result.executed ? 'executed' : 'denied',
            result,
            pendingPersistenceFailed,
        };
    }

    private pendingActionAdminRows(): Array<Record<string, ioBroker.StateValue>> {
        return this.pendingActions.list(undefined, 0, 100).items.map(action => ({
            pendingActionId: action.id,
            status: action.status,
            rooms: action.rooms.join(', ') || 'Global',
            trigger: action.triggerStateId,
            target: action.targetStateId,
            action: String(action.value),
            confidence: `${Math.round(action.confidence * 100)} %`,
            expires: action.status === 'pending' ? new Date(action.expiresAt).toLocaleString() : '—',
            result: [...(action.reasons ?? []), action.errorCode].filter(Boolean).join(', ') || '—',
        }));
    }

    private async publishPendingActionSummary(): Promise<void> {
        const summary = this.pendingActions.summary();
        await this.setOwnState('actions.pendingCount', summary.pending);
        await this.setOwnState('actions.executedCount', summary.executed);
        await this.setOwnState('actions.deniedCount', summary.denied);
    }

    private async publishLlmStatus(): Promise<void> {
        const status = this.llmService?.status();
        await this.setOwnState('llm.provider', status?.provider ?? 'disabled');
        await this.setOwnState('llm.external', status?.external ?? false);
        await this.setOwnState('llm.lastResult', 'none');
    }

    private applyPersistedFeedback(): void {
        if (this.patternEngine && this.feedbackService) {
            this.feedbackService.applyPersisted(this.patternEngine);
        }
    }

    private refreshSuggestions(timestamp = Date.now()): void {
        if (this.patternEngine && this.suggestionService) {
            this.suggestionService.synchronize(this.patternEngine.patterns(timestamp), timestamp);
        }
    }

    private scheduleLearningSave(): void {
        if (!this.learningRepository || this.learningSaveTimer || this.unloading) {
            return;
        }
        this.learningSaveTimer = this.setTimeout(() => {
            this.learningSaveTimer = undefined;
            this.learningSaveTask = this.persistLearningState()
                .catch(error => {
                    if (!this.unloading) {
                        this.log.warn(`[Patterns] Persistence failed: ${(error as Error).message.slice(0, 80)}`);
                    }
                })
                .finally(() => {
                    this.learningSaveTask = undefined;
                });
        }, 500);
    }

    private async persistLearningState(): Promise<void> {
        if (!this.learningRepository || !this.patternEngine || !this.suggestionService) {
            return;
        }
        const patterns = this.patternEngine.snapshot();
        await this.learningRepository.save({
            patterns,
            suggestions: this.suggestionService.snapshot(),
            pendingActions: this.pendingActions.snapshot(),
        });
        this.learningPersistenceStatus = 'saved';
        await this.publishLearningPersistence(patterns.length);
    }

    private async publishLearningPersistence(patternCount = this.restoredLearning.patterns.length): Promise<void> {
        await this.setOwnState('learning.persistenceStatus', this.learningPersistenceStatus);
        await this.setOwnState('learning.persistedPatternCount', patternCount);
    }

    private async publishFeedbackSummary(): Promise<void> {
        const summary = this.feedbackService?.summary();
        await this.setOwnState('feedback.pendingCount', summary?.pendingCount ?? 0);
        await this.setOwnState('feedback.positiveCount', summary?.positiveCount ?? 0);
        await this.setOwnState('feedback.negativeCount', summary?.negativeCount ?? 0);
        await this.setOwnState('feedback.unknownCount', summary?.unknownCount ?? 0);
        await this.setOwnState('feedback.lastTimestamp', summary?.lastFeedbackTimestamp ?? 0);
    }

    private trackFeedback(task: Promise<void>, operation: string): void {
        this.feedbackTasks.add(task);
        void task
            .catch(error => {
                if (!this.unloading) {
                    this.log.warn(`[Feedback] ${operation} failed: ${(error as Error).message.slice(0, 80)}`);
                }
            })
            .finally(() => this.feedbackTasks.delete(task));
    }

    private async setOwnState(id: string, value: ioBroker.StateValue): Promise<void> {
        if (!this.unloading) {
            await this.setStateAsync(id, value, true);
        }
    }

    private async shutdown(callback: () => void): Promise<void> {
        try {
            if (this.policySyncTimer) {
                this.clearTimeout(this.policySyncTimer);
            }
            if (this.roomRefreshTimer) {
                this.clearTimeout(this.roomRefreshTimer);
            }
            if (this.feedbackTimer) {
                this.clearInterval(this.feedbackTimer);
            }
            if (this.pendingActionTimer) {
                this.clearInterval(this.pendingActionTimer);
            }
            if (this.learningSaveTimer) {
                this.clearTimeout(this.learningSaveTimer);
                this.learningSaveTimer = undefined;
            }
            for (const controller of this.historyControllers) {
                controller.abort();
            }
            this.historyControllers.clear();
            for (const controller of this.llmControllers) {
                controller.abort();
            }
            this.llmControllers.clear();
            await Promise.allSettled([...this.feedbackTasks]);
            this.feedbackTasks.clear();
            await this.learningSaveTask;
            await this.persistLearningState();
            if (this.observedStateIds.length) {
                await this.unsubscribeForeignStatesAsync(this.observedStateIds);
            }
            await this.observationEngine?.stop();
            await this.runtime?.stop();
        } catch (error) {
            this.log.error(`[Lifecycle] Shutdown failed: ${(error as Error).message}`);
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new FreyaAdapter(options);
} else {
    new FreyaAdapter();
}
