import * as utils from '@iobroker/adapter-core';
import { createRuntimeConfig } from './config/runtimeConfig';
import { ContextEngine } from './context/contextEngine';
import { IoBrokerCoordinateSource } from './context/providers/ioBrokerCoordinateSource';
import { SunContextProvider } from './context/providers/sunContextProvider';
import { TimeContextProvider } from './context/providers/timeContextProvider';
import { DiscoveryService } from './discovery/discoveryService';
import { IoBrokerDiscoverySource } from './discovery/ioBrokerDiscoverySource';
import { DiscoveryCoordinator } from './services/discoveryCoordinator';
import { IoBrokerPolicySynchronizer } from './services/ioBrokerPolicySynchronizer';
import { SmartBrainRuntime } from './services/runtime';

class SmartBrainAdapter extends utils.Adapter {
    private runtime?: SmartBrainRuntime;
    private discovery?: DiscoveryService;
    private policySynchronizer?: IoBrokerPolicySynchronizer;
    private contextEngine?: ContextEngine;
    private policyStateIds = new Set<string>();
    private policySyncTimer?: ioBroker.Timeout;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'smartbrain' });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('objectChange', this.onObjectChange.bind(this));
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
            await coordinator.run().catch(() => undefined);
        } else {
            await this.setStateAsync('discovery.status', 'disabled', true);
        }
        this.log.info('[Observation] SmartBrain started in read-only Phase 3 context mode');
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
