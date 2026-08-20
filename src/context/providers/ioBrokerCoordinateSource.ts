import type { CoordinateSource, Coordinates } from './sunContextProvider';

function normalizedCoordinates(
    latitude: unknown,
    longitude: unknown,
): Pick<Coordinates, 'latitude' | 'longitude'> | undefined {
    const valid =
        typeof latitude === 'number' &&
        Number.isFinite(latitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        typeof longitude === 'number' &&
        Number.isFinite(longitude) &&
        longitude >= -180 &&
        longitude <= 180;
    return valid ? { latitude, longitude } : undefined;
}

/** Resolve manual coordinates first, then ioBroker's system configuration. */
export class IoBrokerCoordinateSource implements CoordinateSource {
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly manualLatitude?: number,
        private readonly manualLongitude?: number,
    ) {}

    public async resolve(): Promise<Coordinates | undefined> {
        const manual = normalizedCoordinates(this.manualLatitude, this.manualLongitude);
        if (manual) {
            return { ...manual, sourceId: 'manual' };
        }
        const systemConfig = await this.adapter.getForeignObjectAsync('system.config');
        const latitude = systemConfig?.common.latitude;
        const longitude = systemConfig?.common.longitude;
        const system = normalizedCoordinates(latitude, longitude);
        return system ? { ...system, sourceId: 'system' } : undefined;
    }
}
