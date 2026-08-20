import type { EnvironmentMappingInput, StatePolicyInput } from '../discovery/types';
import type { AutonomyLevel } from '../actions/types';

/** Effective runtime settings available in the read-only learning phase. */
export interface RuntimeConfig {
    /** Effective autonomy level; learning never authorizes device writes. */
    autonomyLevel: AutonomyLevel;
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
    /** Minimum confidence required immediately before an action. */
    minimumActionConfidence: number;
    /** Per-target cooldown following a successful action. */
    actionCooldownSeconds: number;
    /** Explicit deny-list evaluated at the write boundary. */
    blockedStateIds: string[];
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
    const requestedAutonomy = Number(config.autonomyLevel ?? 0);
    const autonomyLevel: AutonomyLevel =
        Number.isInteger(requestedAutonomy) && requestedAutonomy >= 0 && requestedAutonomy <= 3
            ? (requestedAutonomy as AutonomyLevel)
            : 0;
    const requestedConfidence = Number(config.minimumActionConfidence ?? 0.7);
    const requestedCooldown = Number(config.actionCooldownSeconds ?? 300);
    const blockedStateIds = Array.isArray(config.blockedStateIds)
        ? [
              ...new Set(
                  config.blockedStateIds
                      .map(item => (typeof item === 'string' ? item : item?.stateId))
                      .filter((id): id is string => typeof id === 'string')
                      .map(id => id.trim())
                      .filter(Boolean),
              ),
          ].slice(0, 500)
        : [];
    return {
        autonomyLevel,
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
        minimumActionConfidence: Number.isFinite(requestedConfidence)
            ? Math.max(0.58, Math.min(1, requestedConfidence))
            : 0.7,
        actionCooldownSeconds: Number.isFinite(requestedCooldown)
            ? Math.max(5, Math.min(86_400, Math.floor(requestedCooldown)))
            : 300,
        blockedStateIds,
        unsafeConfigurationIgnored: autonomyLevel !== requestedAutonomy || !validHistory,
    };
}
