import { expect } from 'chai';
import { createRuntimeConfig } from './runtimeConfig';

describe('runtime configuration', () => {
    it('uses deny-by-default action settings', () => {
        expect(createRuntimeConfig({})).to.deep.equal({
            autonomyLevel: 0,
            learningEnabled: false,
            historyInstance: 'none',
            discoveryEnabled: true,
            discoveryMaxStates: 20_000,
            statePolicies: [],
            environmentMappings: [],
            manualLatitude: undefined,
            manualLongitude: undefined,
            minimumActionConfidence: 0.7,
            actionCooldownSeconds: 300,
            blockedStateIds: [],
            unsafeConfigurationIgnored: false,
        });
    });

    it('accepts the bounded controlled-action autonomy levels', () => {
        const result = createRuntimeConfig({
            autonomyLevel: 3,
            learningEnabled: true,
            historyInstance: 'influxdb.0',
        });

        expect(result.autonomyLevel).to.equal(3);
        expect(result.learningEnabled).to.equal(true);
        expect(result.historyInstance).to.equal('influxdb.0');
        expect(result.unsafeConfigurationIgnored).to.equal(false);
    });

    it('rejects invalid autonomy and bounds action controls', () => {
        const result = createRuntimeConfig({
            autonomyLevel: 4,
            minimumActionConfidence: 0.1,
            actionCooldownSeconds: 999_999,
            blockedStateIds: [' state.0.one ', 'state.0.one', ''],
        });
        expect(result).to.include({
            autonomyLevel: 0,
            minimumActionConfidence: 0.58,
            actionCooldownSeconds: 86_400,
            unsafeConfigurationIgnored: true,
        });
        expect(result.blockedStateIds).to.deep.equal(['state.0.one']);
    });

    it('accepts the complete safe configuration without a warning flag', () => {
        expect(
            createRuntimeConfig({ autonomyLevel: 0, learningEnabled: false, historyInstance: 'none' })
                .unsafeConfigurationIgnored,
        ).to.equal(false);
    });

    it('bounds the discovery size', () => {
        expect(createRuntimeConfig({ discoveryMaxStates: 1 }).discoveryMaxStates).to.equal(100);
        expect(createRuntimeConfig({ discoveryMaxStates: 100_000 }).discoveryMaxStates).to.equal(50_000);
    });

    it('accepts auto history and rejects malformed instance IDs', () => {
        expect(createRuntimeConfig({ historyInstance: 'auto' }).historyInstance).to.equal('auto');
        const malformed = createRuntimeConfig({ historyInstance: 'system.adapter.influxdb.0' });
        expect(malformed.historyInstance).to.equal('none');
        expect(malformed.unsafeConfigurationIgnored).to.equal(true);
    });
});
