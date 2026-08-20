import { expect } from 'chai';
import type { SemanticClassification, StateDescriptor, StatePolicyInput } from '../discovery/types';
import { PermissionRegistry } from './registry';

const light: StateDescriptor = {
    id: 'fixture.0.light.state',
    name: 'Light',
    role: 'switch.light',
    valueType: 'boolean',
    read: true,
    write: true,
    rooms: ['Room'],
    functions: ['Lighting'],
    ancestorNames: [],
    nativeHints: [],
};
const lightClassification: SemanticClassification = { type: 'light', confidence: 0.95, evidence: [], sensitive: false };

function registry(policy?: Partial<StatePolicyInput>): PermissionRegistry {
    return new PermissionRegistry(
        policy
            ? [
                  {
                      stateId: light.id,
                      semanticType: 'auto',
                      observe: false,
                      learn: false,
                      suggest: false,
                      control: false,
                      ...policy,
                  },
              ]
            : [],
    );
}

describe('PermissionRegistry', () => {
    it('denies every permission when a state has no policy', () => {
        expect(registry().resolve(light, lightClassification).permissions).to.deep.equal({
            observe: false,
            learn: false,
            suggest: false,
            control: false,
        });
    });

    it('allows control only with the complete permission chain on a writable non-sensitive state', () => {
        const result = registry({ observe: true, learn: true, suggest: true, control: true }).resolve(
            light,
            lightClassification,
        );
        expect(result.permissions.control).to.equal(true);
        expect(result.violations).to.be.empty;
    });

    it('removes control when prerequisite permissions are missing', () => {
        const result = registry({ control: true }).resolve(light, lightClassification);
        expect(result.permissions.control).to.equal(false);
        expect(result.violations).to.include('control_requires_observe_learn_and_suggest');
    });

    it('never allows control of a sensitive classification', () => {
        const result = registry({ observe: true, learn: true, suggest: true, control: true }).resolve(light, {
            type: 'lock',
            confidence: 1,
            evidence: [],
            sensitive: true,
        });
        expect(result.permissions.control).to.equal(false);
        expect(result.violations).to.include('sensitive_state_control_denied');
    });

    it('does not permit a manual override to hide discovered lock semantics', () => {
        const result = registry({ semanticType: 'light' }).resolve(light, {
            type: 'lock',
            confidence: 1,
            evidence: [],
            sensitive: true,
        });
        expect(result.semanticType).to.equal('lock');
        expect(result.violations).to.include('sensitive_semantic_override_ignored');
    });
});
