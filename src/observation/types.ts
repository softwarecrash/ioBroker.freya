import type { ContextSnapshot } from '../context/types';
import type { SemanticType } from '../discovery/types';
import type { ChangeAttribution } from '../attribution/sourceAttribution';

export interface ObservationMetadata {
    semanticType: SemanticType;
    role?: string;
    rooms: string[];
    functions: string[];
    relatedStateIds: string[];
}

export interface Observation {
    sequence: number;
    stateId: string;
    value: ioBroker.StateValue;
    previousValue?: ioBroker.StateValue;
    timestamp: number;
    receivedAt: number;
    ack: boolean;
    quality: number;
    source?: string;
    attribution?: ChangeAttribution;
    deleted: boolean;
    semanticType: SemanticType;
    role?: string;
    rooms: string[];
    functions: string[];
    context?: ContextSnapshot;
    contextError?: string;
}

export interface ObservationSummary {
    subscribedStates: number;
    retainedObservations: number;
    queuedEvents: number;
    droppedEvents: number;
    lastObservationTimestamp: number;
}
