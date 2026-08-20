import * as utils from '@iobroker/adapter-core';
import { createPhaseOneRuntimeConfig } from './config/runtimeConfig';
import { SmartBrainRuntime } from './services/runtime';

class SmartBrainAdapter extends utils.Adapter {
    private runtime?: SmartBrainRuntime;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'smartbrain' });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        const config = createPhaseOneRuntimeConfig(this.config);

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
        this.log.info('[Observation] SmartBrain started in read-only Phase 1 mode');
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
