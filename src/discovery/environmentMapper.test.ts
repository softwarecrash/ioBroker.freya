import { expect } from 'chai';
import { mapEnvironmentCandidates } from './environmentMapper';
import type { SemanticClassification, StateDescriptor } from './types';

function entry(
    id: string,
    room: string,
    classification: SemanticClassification,
): {
    descriptor: StateDescriptor;
    classification: SemanticClassification;
} {
    return {
        descriptor: {
            id,
            name: 'Illuminance',
            role: 'value.brightness',
            valueType: 'number',
            unit: 'lux',
            read: true,
            write: false,
            rooms: [room],
            functions: [],
            ancestorNames: [],
            nativeHints: [],
        },
        classification,
    };
}

describe('environment candidate mapping', () => {
    it('prefers a physical outdoor source over an otherwise equal weather source', () => {
        const classification: SemanticClassification = {
            type: 'illuminance',
            confidence: 0.9,
            evidence: [],
            sensitive: false,
        };
        const result = mapEnvironmentCandidates(
            [
                entry('fixture.0.weather.lux', 'Weather', classification),
                entry('fixture.0.sensor.lux', 'Outdoor', classification),
            ],
            [],
        );
        expect(result.outsideIlluminance[0].stateId).to.equal('fixture.0.sensor.lux');
        expect(result.outsideIlluminance[0].selected).to.equal(true);
        expect(result.outsideIlluminance[1].selected).to.equal(false);
    });

    it('lets an explicit pinned mapping take priority', () => {
        const classification: SemanticClassification = {
            type: 'illuminance',
            confidence: 0.9,
            evidence: [],
            sensitive: false,
        };
        const result = mapEnvironmentCandidates(
            [
                entry('fixture.0.sensor.lux', 'Outdoor', classification),
                entry('fixture.0.weather.lux', 'Weather', classification),
            ],
            [{ key: 'outsideIlluminance', stateId: 'fixture.0.weather.lux', priority: 0, pinned: true }],
        );
        expect(result.outsideIlluminance[0].stateId).to.equal('fixture.0.weather.lux');
        expect(result.outsideIlluminance[0].pinned).to.equal(true);
    });

    it('uses a manual mapping even when automatic classification is unknown', () => {
        const descriptor = entry('fixture.0.custom.value', '', {
            type: 'unknown',
            confidence: 0.1,
            evidence: [],
            sensitive: false,
        }).descriptor;
        const result = mapEnvironmentCandidates(
            [{ descriptor, classification: { type: 'unknown', confidence: 0.1, evidence: [], sensitive: false } }],
            [{ key: 'cloudCover', stateId: descriptor.id, priority: 50, pinned: true }],
        );

        expect(result.cloudCover).to.have.length(1);
        expect(result.cloudCover[0]).to.include({ stateId: descriptor.id, pinned: true, selected: true });
    });
});
