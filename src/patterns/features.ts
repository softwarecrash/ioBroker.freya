import type { ContextSnapshot } from '../context/types';
import type { PatternFeatures } from './types';

function band(value: number | undefined, limits: number[], labels: string[]): string | undefined {
    if (value === undefined || !Number.isFinite(value)) {
        return undefined;
    }
    const index = limits.findIndex(limit => value < limit);
    return labels[index < 0 ? labels.length - 1 : index];
}

function offsetBucket(value: number | undefined): number | undefined {
    return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value / 15) * 15;
}

/** Convert provider-neutral context into bounded, explainable categorical features. */
export function extractPatternFeatures(
    context: ContextSnapshot | undefined,
    rooms: string[],
    localIlluminance?: number,
): PatternFeatures {
    const values: PatternFeatures['values'] = {};
    if (!context) {
        return { values };
    }
    values['time.halfHour'] = context.time.hour * 2 + Math.floor(context.time.minute / 30);
    values['time.weekend'] = context.time.isWeekend;
    if (rooms.length === 1) {
        values['location.room'] = rooms[0];
    }
    const elevation = band(context.sun?.elevation, [-6, 0, 6], ['night', 'twilight-below', 'twilight-above', 'day']);
    if (elevation !== undefined) {
        values['sun.elevationBand'] = elevation;
    }
    const sunriseOffset = offsetBucket(context.sun?.minutesSinceSunrise);
    if (sunriseOffset !== undefined) {
        values['sun.sunriseOffset'] = sunriseOffset;
    }
    const sunsetOffset = offsetBucket(
        context.sun?.minutesUntilSunset === undefined ? undefined : -context.sun.minutesUntilSunset,
    );
    if (sunsetOffset !== undefined) {
        values['sun.sunsetOffset'] = sunsetOffset;
    }
    const roomIlluminance = band(localIlluminance, [20, 200, 1_000], ['dark', 'dim', 'lit', 'bright']);
    if (roomIlluminance !== undefined) {
        values['room.illuminanceBand'] = roomIlluminance;
    }
    const illuminance = band(
        context.environment?.outsideIlluminance,
        [20, 200, 1_000],
        ['dark', 'dim', 'overcast', 'bright'],
    );
    if (illuminance !== undefined) {
        values['environment.illuminanceBand'] = illuminance;
    }
    const temperature = band(
        context.environment?.outsideTemperature,
        [0, 10, 20, 30],
        ['freezing', 'cold', 'mild', 'warm', 'hot'],
    );
    if (temperature !== undefined) {
        values['environment.temperatureBand'] = temperature;
    }
    if (context.presence?.home !== undefined) {
        values['presence.home'] = context.presence.home;
    }
    return { values };
}
