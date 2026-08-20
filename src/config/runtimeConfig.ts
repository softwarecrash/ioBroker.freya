import type { EnvironmentMappingInput, StatePolicyInput } from '../discovery/types';

/** Effective runtime settings available in the read-only context phase. */
export interface RuntimeConfig {
    /** Effective autonomy level; Phase 3 is always observe-only. */
    autonomyLevel: 0;
    /** Learning remains disabled until its engine and tests exist. */
    learningEnabled: false;
    /** History remains disconnected until the provider abstraction exists. */
    historyInstance: 'none';
    /** Enables metadata-only semantic discovery. */
    discoveryEnabled: boolean;
    /** Hard limit for one discovery pass. */
    discoveryMaxStates: number;
    /** Explicit per-state permission and semantic overrides. */
    statePolicies: StatePolicyInput[];
    /** Explicit environment source priorities. */
    environmentMappings: EnvironmentMappingInput[];
    /** Optional complete manual coordinate override. */
    manualLatitude?: number;
    manualLongitude?: number;
    /** Indicates that potentially unsafe persisted settings were ignored. */
    unsafeConfigurationIgnored: boolean;
}

/**
 * Convert persisted settings to the only configuration supported in Phase 3.
 *
 * @param config Persisted adapter configuration.
 */
export function createRuntimeConfig(config: Partial<ioBroker.AdapterConfig>): RuntimeConfig {
    const requestedMax = Number(config.discoveryMaxStates ?? 20_000);
    return {
        autonomyLevel: 0,
        learningEnabled: false,
        historyInstance: 'none',
        discoveryEnabled: config.discoveryEnabled !== false,
        discoveryMaxStates: Number.isFinite(requestedMax)
            ? Math.max(100, Math.min(50_000, Math.floor(requestedMax)))
            : 20_000,
        statePolicies: Array.isArray(config.statePolicies) ? config.statePolicies : [],
        environmentMappings: Array.isArray(config.environmentMappings) ? config.environmentMappings : [],
        manualLatitude: typeof config.manualLatitude === 'number' ? config.manualLatitude : undefined,
        manualLongitude: typeof config.manualLongitude === 'number' ? config.manualLongitude : undefined,
        unsafeConfigurationIgnored:
            (config.autonomyLevel !== undefined && config.autonomyLevel !== 0) ||
            config.learningEnabled === true ||
            (config.historyInstance !== undefined && config.historyInstance !== 'none'),
    };
}
