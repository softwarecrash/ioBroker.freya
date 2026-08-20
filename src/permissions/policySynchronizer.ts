import type { SemanticType, StatePolicyInput } from '../discovery/types';

const SEMANTIC_TYPES = new Set<SemanticType | 'auto'>([
    'auto',
    'light',
    'dimmer',
    'motion',
    'presence',
    'illuminance',
    'temperature',
    'humidity',
    'cloudCover',
    'precipitation',
    'windSpeed',
    'contact',
    'lock',
    'alarm',
    'switch',
    'unknown',
]);

interface CustomPolicyData {
    enabled?: boolean;
    semanticType?: unknown;
    observe?: unknown;
    learn?: unknown;
    suggest?: unknown;
    control?: unknown;
}

export interface PolicyObjectEntry {
    id: string;
    objectTimestamp: number;
    custom?: CustomPolicyData;
}

export interface PolicySynchronizationPlan {
    policies: StatePolicyInput[];
    customUpdates: Array<{ stateId: string; custom: CustomPolicyData }>;
    updateNative: boolean;
}

function parseCustom(stateId: string, custom: CustomPolicyData | undefined): StatePolicyInput | undefined {
    if (!custom || custom.enabled === false) {
        return undefined;
    }
    const semanticType = SEMANTIC_TYPES.has(custom.semanticType as SemanticType | 'auto')
        ? (custom.semanticType as SemanticType | 'auto')
        : 'auto';
    return {
        stateId,
        semanticType,
        observe: custom.observe === true,
        learn: custom.learn === true,
        suggest: custom.suggest === true,
        control: custom.control === true,
    };
}

function customFromPolicy(policy: StatePolicyInput | undefined): CustomPolicyData {
    return policy
        ? {
              enabled: true,
              semanticType: policy.semanticType ?? 'auto',
              observe: policy.observe,
              learn: policy.learn,
              suggest: policy.suggest,
              control: policy.control,
          }
        : { enabled: false, semanticType: 'auto', observe: false, learn: false, suggest: false, control: false };
}

function policyKey(policy: StatePolicyInput | undefined): string {
    return JSON.stringify(policy ? customFromPolicy(policy) : customFromPolicy(undefined));
}

function sorted(policies: StatePolicyInput[]): StatePolicyInput[] {
    return [...policies].sort((a, b) => a.stateId.localeCompare(b.stateId));
}

/** Reconcile central and per-object policies using the most recently edited object. */
export function createPolicySynchronizationPlan(
    nativePolicies: StatePolicyInput[],
    instanceTimestamp: number,
    objects: PolicyObjectEntry[],
): PolicySynchronizationPlan {
    const nativeById = new Map(nativePolicies.map(policy => [policy.stateId, policy]));
    const objectById = new Map(objects.map(object => [object.id, object]));
    const allIds = new Set([...nativeById.keys(), ...objectById.keys()]);
    const policies: StatePolicyInput[] = [];
    const customUpdates: PolicySynchronizationPlan['customUpdates'] = [];

    for (const stateId of allIds) {
        const nativePolicy = nativeById.get(stateId);
        const object = objectById.get(stateId);
        const customPolicy = parseCustom(stateId, object?.custom);
        const customIsNewer = object !== undefined && object.objectTimestamp > instanceTimestamp;
        const effective = customIsNewer ? customPolicy : nativePolicy;
        if (effective) {
            policies.push(effective);
        }
        if (!customIsNewer && policyKey(customPolicy) !== policyKey(effective)) {
            customUpdates.push({ stateId, custom: customFromPolicy(effective) });
        }
    }

    const normalizedPolicies = sorted(policies);
    return {
        policies: normalizedPolicies,
        customUpdates,
        updateNative: JSON.stringify(sorted(nativePolicies)) !== JSON.stringify(normalizedPolicies),
    };
}
