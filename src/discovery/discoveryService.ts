import { classifyState } from './classifier';
import { mapEnvironmentCandidates } from './environmentMapper';
import type { DiscoveryResult, EnvironmentMappingInput, StateDescriptor, StatePolicyInput } from './types';
import { PermissionRegistry } from '../permissions/registry';

export interface DiscoverySource {
    load(maxStates: number): Promise<{ descriptors: StateDescriptor[]; totalAvailable: number; truncated: boolean }>;
}

export interface DiscoveryOptions {
    maxStates: number;
    policies: StatePolicyInput[];
    environmentMappings: EnvironmentMappingInput[];
}

/** Coordinate read-only semantic discovery and retain a bounded result page source. */
export class DiscoveryService {
    private result?: DiscoveryResult;
    private readonly configuredStateIds: Set<string>;

    public constructor(
        private readonly source: DiscoverySource,
        private readonly options: DiscoveryOptions,
    ) {
        this.configuredStateIds = new Set(options.policies.map(policy => policy.stateId));
    }

    /** Run one bounded discovery pass. */
    public async run(): Promise<DiscoveryResult> {
        const loaded = await this.source.load(this.options.maxStates);
        const registry = new PermissionRegistry(this.options.policies);
        const classified = loaded.descriptors.map(descriptor => ({
            descriptor,
            classification: classifyState(descriptor),
        }));
        const environment = mapEnvironmentCandidates(classified, this.options.environmentMappings);
        const states = classified.map(({ descriptor, classification }) => {
            const policy = registry.resolve(descriptor, classification);
            return {
                id: descriptor.id,
                name: descriptor.name,
                role: descriptor.role,
                valueType: descriptor.valueType,
                unit: descriptor.unit,
                read: descriptor.read,
                write: descriptor.write,
                rooms: descriptor.rooms,
                functions: descriptor.functions,
                semanticType: policy.semanticType,
                scope: policy.scope,
                roomStatus: policy.roomStatus,
                confidence: classification.confidence,
                sensitive: classification.sensitive,
                permissions: policy.permissions,
                permissionViolations: policy.violations,
            };
        });
        const environmentCandidates = Object.values(environment).reduce(
            (sum, candidates) => sum + candidates.length,
            0,
        );
        const controllablePolicies = states.filter(state => state.permissions.control).length;
        this.result = {
            states,
            environment,
            summary: {
                totalAvailable: loaded.totalAvailable,
                scanned: states.length,
                classified: states.filter(state => state.semanticType !== 'unknown').length,
                unknown: states.filter(state => state.semanticType === 'unknown').length,
                sensitive: states.filter(state => state.sensitive).length,
                environmentCandidates,
                configuredPolicies: registry.configuredCount,
                controllablePolicies,
                truncated: loaded.truncated,
                timestamp: Date.now(),
            },
        };
        return this.result;
    }

    /** Return one bounded page for Admin integrations without creating dynamic states. */
    public page(
        page: number,
        pageSize: number,
        query = '',
    ): { total: number; page: number; pageSize: number; items: DiscoveryResult['states'] } {
        const safePage = Math.max(0, Math.floor(page));
        const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
        const needle = query.trim().toLowerCase();
        const filtered = (this.result?.states ?? []).filter(state =>
            needle
                ? `${state.id} ${state.name} ${state.role ?? ''} ${state.semanticType}`.toLowerCase().includes(needle)
                : true,
        );
        const start = safePage * safePageSize;
        return {
            total: filtered.length,
            page: safePage,
            pageSize: safePageSize,
            items: filtered.slice(start, start + safePageSize),
        };
    }

    /** Return the latest aggregate summary, if discovery has run. */
    public summary(): DiscoveryResult['summary'] | undefined {
        return this.result?.summary;
    }

    /** Build a bounded read-only room/scope diagnostic table for configured states. */
    public roomDiagnostics(limit = 500): Array<{
        stateId: string;
        semanticType: string;
        scope: string;
        rooms: string;
        warning: string;
    }> {
        return (this.result?.states ?? [])
            .filter(state => this.configuredStateIds.has(state.id))
            .slice(0, Math.max(1, Math.min(500, Math.floor(limit))))
            .map(state => ({
                stateId: state.id,
                semanticType: state.semanticType,
                scope: state.scope,
                rooms: state.rooms.join(', ') || '—',
                warning: state.roomStatus === 'missing' || state.roomStatus === 'unresolved' ? '⚠' : '✓',
            }));
    }

    /** Add current room information to the editable policy rows shown in Admin. */
    public statePoliciesWithRoomDiagnostics(): Array<StatePolicyInput & { roomAssignment: string }> {
        const statesById = new Map((this.result?.states ?? []).map(state => [state.id, state]));
        return this.options.policies.map(policy => {
            const state = statesById.get(policy.stateId);
            let roomAssignment = '? —';
            if (state?.roomStatus === 'global') {
                roomAssignment = '✓ Global';
            } else if (state?.roomStatus === 'missing' || state?.roomStatus === 'unresolved') {
                roomAssignment = '⚠ —';
            } else if (state?.rooms.length) {
                roomAssignment = `✓ ${state.rooms.join(', ')}`;
            } else if (state?.roomStatus === 'not-required') {
                roomAssignment = '—';
            }
            return { ...policy, roomAssignment };
        });
    }
}
