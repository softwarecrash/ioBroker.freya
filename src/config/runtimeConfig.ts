import type { EnvironmentMappingInput, StatePolicyInput } from '../discovery/types';

/** Effective runtime settings available in the read-only learning phase. */
export interface RuntimeConfig {
    /** Effective autonomy level; learning never authorizes device writes. */
    autonomyLevel: 0;
    /** Enables in-memory learning for states with explicit learn permission. */
    learningEnabled: boolean;
    /** Explicit read-only history provider selection. */
    historyInstance: string;
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
 * Convert persisted settings to the safe configuration supported in Phase 5.
 *
 * @param config Persisted adapter configuration.
 */
export function createRuntimeConfig(config: Partial<ioBroker.AdapterConfig>): RuntimeConfig {
    const requestedMax = Number(config.discoveryMaxStates ?? 20_000);
    const requestedHistory = typeof config.historyInstance === 'string' ? config.historyInstance.trim() : 'none';
    const validHistory =
        requestedHistory === 'none' || requestedHistory === 'auto' || /^[a-z0-9_-]+\.\d+$/i.test(requestedHistory);
    return {
        autonomyLevel: 0,
        learningEnabled: config.learningEnabled === true,
        historyInstance: validHistory ? requestedHistory : 'none',
        discoveryEnabled: config.discoveryEnabled !== false,
        discoveryMaxStates: Number.isFinite(requestedMax)
            ? Math.max(100, Math.min(50_000, Math.floor(requestedMax)))
            : 20_000,
        statePolicies: Array.isArray(config.statePolicies) ? config.statePolicies : [],
        environmentMappings: Array.isArray(config.environmentMappings) ? config.environmentMappings : [],
        manualLatitude: typeof config.manualLatitude === 'number' ? config.manualLatitude : undefined,
        manualLongitude: typeof config.manualLongitude === 'number' ? config.manualLongitude : undefined,
        unsafeConfigurationIgnored: (config.autonomyLevel !== undefined && config.autonomyLevel !== 0) || !validHistory,
    };
}
