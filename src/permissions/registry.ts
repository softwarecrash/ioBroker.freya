import type {
    EffectiveStatePolicy,
    SemanticClassification,
    SemanticType,
    StateDescriptor,
    StatePermissions,
    StatePolicyInput,
} from '../discovery/types';

const DENY_ALL: StatePermissions = { observe: false, learn: false, suggest: false, control: false };

/** Resolve configured state permissions without ever granting implicit control. */
export class PermissionRegistry {
    private readonly configured = new Map<string, StatePolicyInput>();

    public constructor(policies: StatePolicyInput[]) {
        for (const policy of policies) {
            if (policy.stateId && !this.configured.has(policy.stateId)) {
                this.configured.set(policy.stateId, policy);
            }
        }
    }

    /** Number of unique configured policies. */
    public get configuredCount(): number {
        return this.configured.size;
    }

    /** Return effective permissions and validation violations for one state. */
    public resolve(descriptor: StateDescriptor, classification: SemanticClassification): EffectiveStatePolicy {
        const input = this.configured.get(descriptor.id);
        if (!input) {
            return {
                stateId: descriptor.id,
                semanticType: classification.type,
                permissions: { ...DENY_ALL },
                violations: [],
            };
        }

        const violations: string[] = [];
        const semanticType = this.resolveSemanticOverride(input.semanticType, classification.type, violations);
        const permissions: StatePermissions = {
            observe: input.observe === true,
            learn: input.learn === true,
            suggest: input.suggest === true,
            control: input.control === true,
        };

        if (permissions.learn && !permissions.observe) {
            permissions.learn = false;
            violations.push('learn_requires_observe');
        }
        if (permissions.suggest && (!permissions.observe || !permissions.learn)) {
            permissions.suggest = false;
            violations.push('suggest_requires_observe_and_learn');
        }
        if (permissions.control && (!permissions.observe || !permissions.learn || !permissions.suggest)) {
            permissions.control = false;
            violations.push('control_requires_observe_learn_and_suggest');
        }
        if (permissions.control && !descriptor.write) {
            permissions.control = false;
            violations.push('control_requires_writable_state');
        }
        if (permissions.control && (classification.sensitive || semanticType === 'lock' || semanticType === 'alarm')) {
            permissions.control = false;
            violations.push('sensitive_state_control_denied');
        }
        if (permissions.control && semanticType === 'unknown') {
            permissions.control = false;
            violations.push('unknown_semantic_control_denied');
        }

        return { stateId: descriptor.id, semanticType, permissions, violations };
    }

    private resolveSemanticOverride(
        override: StatePolicyInput['semanticType'],
        discovered: SemanticType,
        violations: string[],
    ): SemanticType {
        if (!override || override === 'auto') {
            return discovered;
        }
        if (override === 'lock' || override === 'alarm') {
            return override;
        }
        if (discovered === 'lock' || discovered === 'alarm') {
            violations.push('sensitive_semantic_override_ignored');
            return discovered;
        }
        return override;
    }
}
