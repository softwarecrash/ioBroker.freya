export type ContextQuality = 'measured' | 'calculated' | 'inferred';

export interface ContextFieldProvenance {
    providerId: string;
    quality: ContextQuality;
    confidence: number;
    timestamp: number;
    sourceId?: string;
}

export interface ContextProviderFailure {
    providerId: string;
    code: 'unavailable' | 'timeout' | 'error';
    message?: string;
}

export interface TimeContext {
    hour: number;
    minute: number;
    weekday: number;
    isWeekend: boolean;
}

export interface SunContext {
    sunrise?: number;
    sunset?: number;
    elevation?: number;
    azimuth?: number;
    phase?: 'dawn' | 'day' | 'dusk' | 'night';
    minutesSinceSunrise?: number;
    minutesUntilSunset?: number;
}

export interface EnvironmentContext {
    outsideTemperature?: number;
    outsideIlluminance?: number;
    humidity?: number;
    cloudCover?: number;
    precipitation?: boolean;
    windSpeed?: number;
}

export interface PresenceContext {
    home?: boolean;
    personsHome?: number;
}

export interface ContextData {
    time?: TimeContext;
    sun?: SunContext;
    environment?: EnvironmentContext;
    presence?: PresenceContext;
    states?: Record<string, unknown>;
}

export interface ContextSnapshot extends Omit<ContextData, 'time'> {
    timestamp: number;
    time: TimeContext;
    provenance: Record<string, ContextFieldProvenance>;
    failures: ContextProviderFailure[];
}

export interface ContextRequest {
    timestamp: number;
    triggerStateId?: string;
    relatedStateIds?: string[];
}

export interface ContextProviderResult {
    context: ContextData;
    provenance: Record<string, ContextFieldProvenance>;
}

export interface ContextProvider {
    readonly id: string;
    isAvailable(): Promise<boolean>;
    getContext(request: ContextRequest): Promise<ContextProviderResult>;
}
