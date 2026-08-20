/** Effective runtime settings available in the read-only skeleton. */
export interface RuntimeConfig {
    /** Effective autonomy level; Phase 1 is always observe-only. */
    autonomyLevel: 0;
    /** Learning remains disabled until its engine and tests exist. */
    learningEnabled: false;
    /** History remains disconnected until the provider abstraction exists. */
    historyInstance: 'none';
    /** Indicates that potentially unsafe persisted settings were ignored. */
    unsafeConfigurationIgnored: boolean;
}

/**
 * Convert persisted settings to the only configuration supported in Phase 1.
 *
 * @param config Persisted adapter configuration.
 */
export function createPhaseOneRuntimeConfig(config: Partial<ioBroker.AdapterConfig>): RuntimeConfig {
    return {
        autonomyLevel: 0,
        learningEnabled: false,
        historyInstance: 'none',
        unsafeConfigurationIgnored:
            config.autonomyLevel !== 0 || config.learningEnabled === true || config.historyInstance !== 'none',
    };
}
