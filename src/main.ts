import * as utils from '@iobroker/adapter-core';
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
import type { DiscoveryResult, DiscoveredStateView } from './discovery/types';
import { ObservationEngine } from './observation/observationEngine';
import type { ObservationMetadata } from './observation/types';
import { DiscoveryCoordinator } from './services/discoveryCoordinator';
import { IoBrokerContextStateReader } from './services/ioBrokerContextStateReader';
import { IoBrokerPolicySynchronizer } from './services/ioBrokerPolicySynchronizer';
import { SmartBrainRuntime } from './services/runtime';

class SmartBrainAdapter extends utils.Adapter {
    private runtime?: SmartBrainRuntime;
    private discovery?: DiscoveryService;
    private policySynchronizer?: IoBrokerPolicySynchronizer;
    private contextEngine?: ContextEngine;
    private observationEngine?: ObservationEngine;
    private observationMetadata = new Map<string, ObservationMetadata>();
    private observedStateIds: string[] = [];
    private policyStateIds = new Set<string>();
    private policySyncTimer?: ioBroker.Timeout;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'smartbrain' });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('objectChange', this.onObjectChange.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        const config = createRuntimeConfig(this.config);
        this.policySynchronizer = new IoBrokerPolicySynchronizer(this);
        const synchronizedPolicies = await this.policySynchronizer.synchronize(config.statePolicies);
        this.policyStateIds = new Set(synchronizedPolicies.map(policy => policy.stateId));
        await this.subscribeForeignObjectsAsync('*');
        const timeProvider = new TimeContextProvider();
        const sunProvider = new SunContextProvider(
            new IoBrokerCoordinateSource(this, config.manualLatitude, config.manualLongitude),
        );
        this.contextEngine = new ContextEngine(timeProvider, [sunProvider], { providerTimeoutMs: 1_000 });

        this.runtime = new SmartBrainRuntime(
            {
                setState: async (id, value) => {
                    await this.setStateAsync(id, value, true);
                },
                warn: message => this.log.warn(message),
            },
            config,
        );

        await this.runtime.start();
        await this.initializeObservationStatus();
        if (config.discoveryEnabled) {
            this.discovery = new DiscoveryService(new IoBrokerDiscoverySource(this), {
                maxStates: config.discoveryMaxStates,
                policies: synchronizedPolicies,
                environmentMappings: config.environmentMappings,
            });
            const coordinator = new DiscoveryCoordinator(this.discovery, {
                setState: async (id, value) => {
                    await this.setStateAsync(id, value, true);
                },
                info: message => this.log.info(message),
                warn: message => this.log.warn(message),
            });
            const discoveryResult = await coordinator.run().catch(() => undefined);
            if (discoveryResult) {
                await this.setupObservation(discoveryResult, timeProvider, sunProvider);
            }
        } else {
            await this.setStateAsync('discovery.status', 'disabled', true);
        }
        this.log.info('[Observation] SmartBrain started in read-only Phase 3 observation mode');
    }

    private async initializeObservationStatus(): Promise<void> {
        await this.setStateAsync('observation.subscribedStateCount', 0, true);
        await this.setStateAsync('observation.retainedCount', 0, true);
        await this.setStateAsync('observation.droppedCount', 0, true);
        await this.setStateAsync('observation.lastTimestamp', 0, true);
    }

    private async setupObservation(
        discoveryResult: DiscoveryResult,
        timeProvider: TimeContextProvider,
        sunProvider: SunContextProvider,
    ): Promise<void> {
        const observedStates = discoveryResult.states.filter(state => state.permissions.observe);
        this.observedStateIds = observedStates.map(state => state.id);
        const reader = new IoBrokerContextStateReader(this, this.observedStateIds);
        const observedIdSet = new Set(this.observedStateIds);
        const environmentCandidates = Object.values(discoveryResult.environment)
            .flat()
            .filter(candidate => observedIdSet.has(candidate.stateId));
        const presenceStateIds = observedStates
            .filter(state => state.semanticType === 'presence')
            .map(state => state.id);
        this.contextEngine = new ContextEngine(
            timeProvider,
            [
                sunProvider,
                new EnvironmentContextProvider(reader, environmentCandidates),
                new WeatherContextProvider(reader, environmentCandidates),
                new PresenceContextProvider(reader, presenceStateIds),
                new DeviceContextProvider(reader, this.observedStateIds, 25),
            ],
            { providerTimeoutMs: 1_000 },
        );
        this.observationMetadata = new Map(
            observedStates.map(state => [state.id, this.observationMetadataFor(state, observedStates)]),
        );
        this.observationEngine = new ObservationEngine(
            this.contextEngine,
            {
                onObservation: async observation => {
                    const summary = this.observationEngine?.summary();
                    await this.setStateAsync('observation.retainedCount', summary?.retainedObservations ?? 0, true);
                    await this.setStateAsync('observation.droppedCount', summary?.droppedEvents ?? 0, true);
                    await this.setStateAsync('observation.lastTimestamp', observation.timestamp, true);
                },
                onError: message => this.log.warn(message),
                debug: message => this.log.debug(message),
            },
            this.observedStateIds.length,
            { maxQueue: 500, maxRetained: 500 },
        );
        await this.setStateAsync('learning.observedStateCount', this.observedStateIds.length, true);
        await this.setStateAsync('observation.subscribedStateCount', this.observedStateIds.length, true);
        if (this.observedStateIds.length) {
            const initialStates = await this.getForeignStatesAsync(this.observedStateIds);
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
        const metadata = this.observationMetadata.get(id);
        if (metadata) {
            this.observationEngine?.ingest(id, state ?? null, metadata);
        }
    }

    private onObjectChange(id: string, object: ioBroker.Object | null | undefined): void {
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
                .then(policies => {
                    this.policyStateIds = new Set(policies.map(policy => policy.stateId));
                })
                .catch(error => this.log.warn(`[Permissions] Synchronization failed: ${(error as Error).message}`));
        }, 250);
    }

    private async onMessage(message: ioBroker.Message): Promise<void> {
        if (!message.callback) {
            return;
        }
        if (message.command === 'getDiscoverySummary') {
            this.sendTo(message.from, message.command, this.discovery?.summary() ?? null, message.callback);
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
        this.sendTo(message.from, message.command, { error: 'unsupported_command' }, message.callback);
    }

    private onUnload(callback: () => void): void {
        void this.shutdown(callback);
    }

    private async shutdown(callback: () => void): Promise<void> {
        try {
            if (this.policySyncTimer) {
                this.clearTimeout(this.policySyncTimer);
            }
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
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new SmartBrainAdapter(options);
} else {
    new SmartBrainAdapter();
}
