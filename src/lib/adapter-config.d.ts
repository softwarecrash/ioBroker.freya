import type { EnvironmentMappingInput, StatePolicyInput } from '../discovery/types';

declare global {
    namespace ioBroker {
        interface AdapterConfig {
            autonomyLevel: number;
            learningEnabled: boolean;
            historyInstance: string;
            discoveryEnabled: boolean;
            discoveryMaxStates: number;
            statePolicies: StatePolicyInput[];
            environmentMappings: EnvironmentMappingInput[];
            manualLatitude?: number;
            manualLongitude?: number;
            minimumActionConfidence: number;
            actionCooldownSeconds: number;
            blockedStateIds: Array<string | { stateId: string }>;
        }
    }
}

export {};
