import type { DiscoverySource } from './discoveryService';
import type { StateDescriptor } from './types';

const NATIVE_HINT_KEYS = ['type', 'deviceType', 'category', 'kind'];

function displayName(name: ioBroker.StringOrTranslated | undefined): string {
    if (!name) {
        return '';
    }
    if (typeof name === 'string') {
        return name;
    }
    return name.en ?? name.de ?? Object.values(name).find((value): value is string => typeof value === 'string') ?? '';
}

function ancestorIds(id: string): string[] {
    const parts = id.split('.');
    const result: string[] = [];
    for (let length = parts.length - 1; length >= 2; length--) {
        result.push(parts.slice(0, length).join('.'));
    }
    return result;
}

function primitiveHint(value: unknown): string | undefined {
    if (typeof value === 'string') {
        return value.slice(0, 80);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return undefined;
}

/** Read state/object metadata without reading state values or changing ioBroker. */
export class IoBrokerDiscoverySource implements DiscoverySource {
    public constructor(private readonly adapter: ioBroker.Adapter) {}

    /** Load a bounded, normalized metadata snapshot. */
    public async load(
        maxStates: number,
    ): Promise<{ descriptors: StateDescriptor[]; totalAvailable: number; truncated: boolean }> {
        const objects = await this.adapter.getForeignObjectsAsync('*');
        const enumObjects = Object.values(objects).filter(
            (object): object is ioBroker.EnumObject => object?.type === 'enum',
        );
        const stateObjects = Object.values(objects)
            .filter(
                (object): object is ioBroker.StateObject =>
                    object?.type === 'state' && !object._id.startsWith(`${this.adapter.namespace}.`),
            )
            .sort((a, b) => a._id.localeCompare(b._id));
        const selected = stateObjects.slice(0, maxStates);

        const descriptors = selected.map(object => {
            const ancestors = ancestorIds(object._id);
            const memberships = enumObjects.filter(enumObject => {
                const members = enumObject.common.members ?? [];
                return members.includes(object._id) || ancestors.some(id => members.includes(id));
            });
            const rooms = memberships
                .filter(item => item._id.startsWith('enum.rooms.'))
                .map(item => displayName(item.common.name));
            const functions = memberships
                .filter(item => item._id.startsWith('enum.functions.'))
                .map(item => displayName(item.common.name));
            const ancestorNames = ancestors
                .map(id => objects[id])
                .filter((item): item is ioBroker.Object => !!item)
                .map(item => displayName(item.common.name));
            const nativeHints = NATIVE_HINT_KEYS.map(key => primitiveHint(object.native?.[key])).filter(
                (value): value is string => !!value,
            );

            return {
                id: object._id,
                name: displayName(object.common.name),
                role: object.common.role,
                valueType: object.common.type,
                unit: object.common.unit,
                read: object.common.read === true,
                write: object.common.write === true,
                rooms,
                functions,
                ancestorNames,
                nativeHints,
            };
        });

        return { descriptors, totalAvailable: stateObjects.length, truncated: stateObjects.length > selected.length };
    }
}
