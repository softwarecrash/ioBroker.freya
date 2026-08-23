import { expect } from 'chai';
import type { StatePolicyInput } from '../discovery/types';
import { IoBrokerPolicySynchronizer, mergeRoomAssignments } from './ioBrokerPolicySynchronizer';

const policy: StatePolicyInput = {
    stateId: 'alias.0.room.light',
    semanticType: 'light',
    scope: 'auto',
    observe: true,
    learn: true,
    suggest: true,
    control: false,
};

describe('IoBrokerPolicySynchronizer room diagnostics', () => {
    it('merges display-only room assignments without mutating permissions', () => {
        const [merged] = mergeRoomAssignments([policy], [{ stateId: policy.stateId, roomAssignment: '✓ Kitchen' }]);

        expect(merged).to.deep.equal({ ...policy, roomAssignment: '✓ Kitchen' });
        expect(policy).not.to.have.property('roomAssignment');
    });

    it('persists room diagnostics only when their displayed value changed', async () => {
        let instance = {
            _id: 'system.adapter.freya.0',
            type: 'instance' as const,
            common: {} as ioBroker.InstanceCommon,
            native: { statePolicies: [policy], unrelated: true },
        } as unknown as ioBroker.InstanceObject;
        let writes = 0;
        const adapter = {
            namespace: 'freya.0',
            getForeignObjectAsync: () => Promise.resolve(instance),
            setForeignObjectAsync: (_id: string, value: ioBroker.InstanceObject) => {
                instance = value;
                writes++;
                return Promise.resolve();
            },
        } as unknown as ioBroker.Adapter;
        const synchronizer = new IoBrokerPolicySynchronizer(adapter);

        expect(
            await synchronizer.synchronizeRoomAssignments([{ stateId: policy.stateId, roomAssignment: '✓ Kitchen' }]),
        ).to.equal(true);
        expect(writes).to.equal(1);
        expect(instance.native).to.deep.include({ unrelated: true });
        expect((instance.native.statePolicies as StatePolicyInput[])[0]).to.include({
            roomAssignment: '✓ Kitchen',
        });

        expect(
            await synchronizer.synchronizeRoomAssignments([{ stateId: policy.stateId, roomAssignment: '✓ Kitchen' }]),
        ).to.equal(false);
        expect(writes).to.equal(1);
    });
});
