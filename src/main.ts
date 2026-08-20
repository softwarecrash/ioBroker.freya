import * as utils from '@iobroker/adapter-core';
import { createRuntimeConfig } from './config/runtimeConfig';
import { DiscoveryService } from './discovery/discoveryService';
import { IoBrokerDiscoverySource } from './discovery/ioBrokerDiscoverySource';
import { DiscoveryCoordinator } from './services/discoveryCoordinator';
import { SmartBrainRuntime } from './services/runtime';

class SmartBrainAdapter extends utils.Adapter {
    private runtime?: SmartBrainRuntime;
    private discovery?: DiscoveryService;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'smartbrain' });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        const config = createRuntimeConfig(this.config);

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
                policies: config.statePolicies,
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
        this.log.info('[Observation] SmartBrain started in read-only Phase 2 mode');
    }

    private onMessage(message: ioBroker.Message): void {
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
        this.sendTo(message.from, message.command, { error: 'unsupported_command' }, message.callback);
    }

    private onUnload(callback: () => void): void {
        void this.shutdown(callback);
    }

    private async shutdown(callback: () => void): Promise<void> {
        try {
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
