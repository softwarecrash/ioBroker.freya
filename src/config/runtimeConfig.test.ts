import { expect } from 'chai';
import { createRuntimeConfig } from './runtimeConfig';

describe('Phase 3 runtime configuration', () => {
    it('uses read-only defaults', () => {
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
            unsafeConfigurationIgnored: false,
        });
    });

    it('ignores settings that could enable unfinished behavior', () => {
        const result = createRuntimeConfig({
            autonomyLevel: 3,
            learningEnabled: true,
            historyInstance: 'influxdb.0',
        });

        expect(result.autonomyLevel).to.equal(0);
        expect(result.learningEnabled).to.equal(false);
        expect(result.historyInstance).to.equal('none');
        expect(result.unsafeConfigurationIgnored).to.equal(true);
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
});
