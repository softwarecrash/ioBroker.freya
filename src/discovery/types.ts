export type SemanticType =
    | 'light'
    | 'dimmer'
    | 'motion'
    | 'presence'
    | 'illuminance'
    | 'temperature'
    | 'humidity'
    | 'cloudCover'
    | 'precipitation'
    | 'windSpeed'
    | 'contact'
    | 'lock'
    | 'alarm'
    | 'switch'
    | 'unknown';

export type EvidenceSource = 'role' | 'name' | 'unit' | 'type' | 'enum' | 'native';

export interface SemanticEvidence {
    source: EvidenceSource;
    value: string;
    weight: number;
}

export interface StateDescriptor {
    id: string;
    name: string;
    role?: string;
    valueType?: ioBroker.CommonType;
    unit?: string;
    read: boolean;
    write: boolean;
    rooms: string[];
    functions: string[];
    ancestorNames: string[];
    nativeHints: string[];
}

export interface SemanticClassification {
    type: SemanticType;
    confidence: number;
    evidence: SemanticEvidence[];
    sensitive: boolean;
}

export interface StatePermissions {
    observe: boolean;
    learn: boolean;
    suggest: boolean;
    control: boolean;
}

export type StateScope = 'auto' | 'room' | 'global';
export type RoomAssignmentStatus = 'resolved' | 'global' | 'unresolved' | 'missing' | 'not-required';

export interface StatePolicyInput extends StatePermissions {
    stateId: string;
    semanticType?: SemanticType | 'auto';
    scope?: StateScope;
    /** Cached Admin-only display value; ignored by permission and learning logic. */
    roomAssignment?: string;
}

export interface EffectiveStatePolicy {
    stateId: string;
    semanticType: SemanticType;
    scope: StateScope;
    roomStatus: RoomAssignmentStatus;
    permissions: StatePermissions;
    violations: string[];
}

export type EnvironmentKey =
    'outsideTemperature' | 'outsideIlluminance' | 'humidity' | 'cloudCover' | 'precipitation' | 'windSpeed';

export interface EnvironmentMappingInput {
    key: EnvironmentKey;
    stateId: string;
    priority: number;
    pinned: boolean;
}

export interface EnvironmentCandidate {
    key: EnvironmentKey;
    stateId: string;
    score: number;
    sourceKind: 'physical' | 'weather' | 'derived' | 'unknown';
    selected: boolean;
    pinned: boolean;
}

export interface DiscoveredStateView {
    id: string;
    name: string;
    role?: string;
    valueType?: ioBroker.CommonType;
    unit?: string;
    read: boolean;
    write: boolean;
    rooms: string[];
    functions: string[];
    semanticType: SemanticType;
    scope: StateScope;
    roomStatus: RoomAssignmentStatus;
    confidence: number;
    sensitive: boolean;
    permissions: StatePermissions;
    permissionViolations: string[];
}

export interface DiscoverySummary {
    totalAvailable: number;
    scanned: number;
    classified: number;
    unknown: number;
    sensitive: number;
    environmentCandidates: number;
    configuredPolicies: number;
    controllablePolicies: number;
    truncated: boolean;
    timestamp: number;
}

export interface DiscoveryResult {
    summary: DiscoverySummary;
    states: DiscoveredStateView[];
    environment: Record<EnvironmentKey, EnvironmentCandidate[]>;
}
