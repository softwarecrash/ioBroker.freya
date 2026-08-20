import { expect } from 'chai';
import { createPolicySynchronizationPlan } from './policySynchronizer';

const nativePolicy = {
    stateId: 'fixture.0.light',
    semanticType: 'light' as const,
    observe: true,
    learn: false,
    suggest: false,
    control: false,
};

describe('policy synchronization', () => {
    it('copies a newer central policy to object custom settings', () => {
        const plan = createPolicySynchronizationPlan([nativePolicy], 200, [
            { id: nativePolicy.stateId, objectTimestamp: 100 },
        ]);

        expect(plan.policies).to.deep.equal([nativePolicy]);
        expect(plan.updateNative).to.equal(false);
        expect(plan.customUpdates[0]).to.deep.include({ stateId: nativePolicy.stateId });
        expect(plan.customUpdates[0].custom).to.include({ enabled: true, observe: true });
    });

    it('copies a newer object policy to the central table', () => {
        const plan = createPolicySynchronizationPlan([nativePolicy], 100, [
            {
                id: nativePolicy.stateId,
                objectTimestamp: 200,
                custom: {
                    enabled: true,
                    semanticType: 'dimmer',
                    observe: true,
                    learn: true,
                    suggest: false,
                    control: false,
                },
            },
        ]);

        expect(plan.updateNative).to.equal(true);
        expect(plan.customUpdates).to.be.empty;
        expect(plan.policies[0]).to.include({ semanticType: 'dimmer', learn: true });
    });

    it('removes a central policy when a newer custom entry is disabled', () => {
        const plan = createPolicySynchronizationPlan([nativePolicy], 100, [
            { id: nativePolicy.stateId, objectTimestamp: 200, custom: { enabled: false } },
        ]);

        expect(plan.policies).to.be.empty;
        expect(plan.updateNative).to.equal(true);
    });
});
