import * as SunCalc from 'suncalc';
import type { ContextProvider, ContextProviderResult, ContextRequest, SunContext } from '../types';

export interface Coordinates {
    latitude: number;
    longitude: number;
    sourceId: 'manual' | 'system';
}

export interface CoordinateSource {
    resolve(): Promise<Coordinates | undefined>;
}

function validDate(value: Date | null): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime());
}

/** Calculate solar context locally; no network service is used. */
export class SunContextProvider implements ContextProvider {
    public readonly id = 'sun';

    public constructor(private readonly coordinates: CoordinateSource) {}

    public async isAvailable(): Promise<boolean> {
        return (await this.coordinates.resolve()) !== undefined;
    }

    public async getContext(request: ContextRequest): Promise<ContextProviderResult> {
        const coordinates = await this.coordinates.resolve();
        if (!coordinates) {
            return { context: {}, provenance: {} };
        }
        const date = new Date(request.timestamp);
        const position = SunCalc.getPosition(date, coordinates.latitude, coordinates.longitude);
        const times = SunCalc.getTimes(date, coordinates.latitude, coordinates.longitude);
        const sunrise = validDate(times.sunrise) ? times.sunrise.getTime() : undefined;
        const sunset = validDate(times.sunset) ? times.sunset.getTime() : undefined;
        const dawn = validDate(times.dawn) ? times.dawn.getTime() : undefined;
        const dusk = validDate(times.dusk) ? times.dusk.getTime() : undefined;
        const timestamp = request.timestamp;
        let phase: SunContext['phase'];
        if (sunrise !== undefined && sunset !== undefined && timestamp >= sunrise && timestamp < sunset) {
            phase = 'day';
        } else if (dawn !== undefined && sunrise !== undefined && timestamp >= dawn && timestamp < sunrise) {
            phase = 'dawn';
        } else if (sunset !== undefined && dusk !== undefined && timestamp >= sunset && timestamp < dusk) {
            phase = 'dusk';
        } else {
            phase = position.altitude >= 0 ? 'day' : 'night';
        }
        const sun: SunContext = {
            sunrise,
            sunset,
            elevation: Number(position.altitude.toFixed(3)),
            azimuth: Number(position.azimuth.toFixed(3)),
            phase,
            minutesSinceSunrise:
                sunrise === undefined ? undefined : Number(((timestamp - sunrise) / 60_000).toFixed(2)),
            minutesUntilSunset: sunset === undefined ? undefined : Number(((sunset - timestamp) / 60_000).toFixed(2)),
        };
        const provenance = Object.fromEntries(
            Object.entries(sun)
                .filter(([, value]) => value !== undefined)
                .map(([key]) => [
                    `sun.${key}`,
                    {
                        providerId: this.id,
                        quality: 'calculated' as const,
                        confidence: 0.99,
                        timestamp,
                        sourceId: coordinates.sourceId,
                    },
                ]),
        );
        return { context: { sun }, provenance };
    }
}
