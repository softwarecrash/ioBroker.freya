import type { StatePolicyInput } from '../discovery/types';
import { createPolicySynchronizationPlan, type PolicyObjectEntry } from '../permissions/policySynchronizer';

/** Synchronize adapter-native policies with common.custom policies on state objects. */
export interface PolicySynchronizationResult {
    policies: StatePolicyInput[];
    instanceUpdated: boolean;
}

export class IoBrokerPolicySynchronizer {
    public constructor(private readonly adapter: ioBroker.Adapter) {}

    public async synchronize(nativePolicies?: StatePolicyInput[]): Promise<PolicySynchronizationResult> {
        const instanceId = `system.adapter.${this.adapter.namespace}`;
        const [instance, states] = await Promise.all([
            this.adapter.getForeignObjectAsync(instanceId),
            this.adapter.getForeignObjectsAsync('*', 'state'),
        ]);
        const configuredPolicies =
            nativePolicies ??
            (Array.isArray((instance?.native as Record<string, unknown> | undefined)?.statePolicies)
                ? ((instance?.native as Record<string, unknown>).statePolicies as StatePolicyInput[])
                : []);
        const nativeIds = new Set(configuredPolicies.map(policy => policy.stateId));
        const entries: PolicyObjectEntry[] = Object.values(states)
            .filter((object): object is ioBroker.StateObject => object?.type === 'state')
            .flatMap(object => {
                const custom = object.common.custom?.[this.adapter.namespace] as
                    PolicyObjectEntry['custom'] | undefined;
                return custom || nativeIds.has(object._id)
                    ? [{ id: object._id, objectTimestamp: object.ts ?? 0, custom }]
                    : [];
            });
        const plan = createPolicySynchronizationPlan(configuredPolicies, instance?.ts ?? 0, entries);

        for (const update of plan.customUpdates) {
            if (!states[update.stateId]) {
                continue;
            }
            await this.adapter.extendForeignObjectAsync(update.stateId, {
                common: { custom: { [this.adapter.namespace]: update.custom } },
            });
        }
        if (plan.updateNative) {
            if (!instance || instance.type !== 'instance') {
                throw new Error('adapter_instance_object_missing');
            }
            await this.adapter.setForeignObjectAsync(instanceId, {
                ...instance,
                native: { ...instance.native, statePolicies: plan.policies },
            });
        }
        return { policies: plan.policies, instanceUpdated: plan.updateNative };
    }
}
