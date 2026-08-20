declare global {
    namespace ioBroker {
        interface AdapterConfig {
            autonomyLevel: number;
            learningEnabled: boolean;
            historyInstance: string;
        }
    }
}

export {};
