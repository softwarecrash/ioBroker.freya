import { expect } from 'chai';
import { createPhaseOneRuntimeConfig } from './runtimeConfig';

describe('Phase 1 runtime configuration', () => {
    it('uses read-only defaults', () => {
        expect(createPhaseOneRuntimeConfig({})).to.deep.equal({
            autonomyLevel: 0,
            learningEnabled: false,
            historyInstance: 'none',
            unsafeConfigurationIgnored: true,
        });
    });

    it('ignores settings that could enable unfinished behavior', () => {
        const result = createPhaseOneRuntimeConfig({
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
            createPhaseOneRuntimeConfig({ autonomyLevel: 0, learningEnabled: false, historyInstance: 'none' })
                .unsafeConfigurationIgnored,
        ).to.equal(false);
    });
});
