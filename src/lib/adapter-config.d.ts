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
        }
    }
}

export {};
