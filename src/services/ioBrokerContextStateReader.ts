import type { ContextStateReader, ContextStateSample } from '../context/providers/stateContextProviders';

/** Read only explicitly allow-listed context state values. */
export class IoBrokerContextStateReader implements ContextStateReader {
    private readonly allowed: Set<string>;

    public constructor(
        private readonly adapter: ioBroker.Adapter,
        allowedStateIds: string[],
    ) {
        this.allowed = new Set(allowedStateIds);
    }

    public async read(stateIds: string[]): Promise<Record<string, ContextStateSample | undefined>> {
        const safeIds = [...new Set(stateIds)].filter(stateId => this.allowed.has(stateId)).slice(0, 100);
        if (!safeIds.length) {
            return {};
        }
        const states = await this.adapter.getForeignStatesAsync(safeIds);
        return Object.fromEntries(
            safeIds.map(stateId => {
                const state = states[stateId];
                return [stateId, state ? { value: state.val, timestamp: state.ts } : undefined];
            }),
        );
    }
}
