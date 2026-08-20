import type { HistoryProviderDescriptor } from './types';

export interface HistoryInstanceSource {
    list(): Promise<HistoryProviderDescriptor[]>;
}

function priority(descriptor: HistoryProviderDescriptor): number {
    if (descriptor.adapterName === 'influxdb') {
        return 0;
    }
    if (descriptor.adapterName === 'sql') {
        return 1;
    }
    if (descriptor.adapterName === 'history') {
        return 2;
    }
    return 3;
}

/** Detect usable history instances from live capabilities, never state custom metadata. */
export class HistoryProviderDiscovery {
    public constructor(private readonly source: HistoryInstanceSource) {}

    public async available(): Promise<HistoryProviderDescriptor[]> {
        return (await this.source.list())
            .filter(item => item.enabled && item.alive && item.supportsGetHistory)
            .sort((left, right) => priority(left) - priority(right) || left.id.localeCompare(right.id));
    }
}

export class IoBrokerHistoryInstanceSource implements HistoryInstanceSource {
    public constructor(private readonly adapter: ioBroker.Adapter) {}

    public async list(): Promise<HistoryProviderDescriptor[]> {
        const view = await this.adapter.getObjectViewAsync('system', 'instance', {
            startkey: 'system.adapter.',
            endkey: 'system.adapter.\u9999',
        });
        const candidates = view.rows.flatMap(row => {
            const object = row.value as ioBroker.InstanceObject | undefined;
            const common = object?.common;
            const supported = common?.supportedMessages?.getHistory === true || common?.getHistory === true;
            const match = /^system\.adapter\.(.+)\.(\d+)$/.exec(row.id);
            if (!object || !common || !match || !supported) {
                return [];
            }
            return [{ id: row.id.slice('system.adapter.'.length), adapterName: match[1], common }];
        });
        const aliveIds = candidates.map(candidate => `system.adapter.${candidate.id}.alive`);
        const aliveStates = aliveIds.length ? await this.adapter.getForeignStatesAsync(aliveIds) : {};
        return candidates.map(candidate => ({
            id: candidate.id,
            adapterName: candidate.adapterName,
            enabled: candidate.common.enabled === true,
            alive: aliveStates[`system.adapter.${candidate.id}.alive`]?.val === true,
            supportsGetHistory: true,
        }));
    }
}
