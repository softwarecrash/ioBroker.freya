import { expect } from 'chai';
import { classifyState } from './classifier';
import type { StateDescriptor } from './types';

function descriptor(overrides: Partial<StateDescriptor> = {}): StateDescriptor {
    return {
        id: 'fixture.0.device.state',
        name: 'Generic state',
        read: true,
        write: false,
        rooms: [],
        functions: [],
        ancestorNames: [],
        nativeHints: [],
        ...overrides,
    };
}

describe('semantic classifier', () => {
    it('classifies a light from strong role evidence', () => {
        const result = classifyState(descriptor({ role: 'switch.light', valueType: 'boolean', write: true }));
        expect(result.type).to.equal('light');
        expect(result.confidence).to.be.greaterThan(0.8);
        expect(result.sensitive).to.equal(false);
    });

    it('classifies illuminance from unit and name without an adapter-specific ID', () => {
        const result = classifyState(descriptor({ name: 'Outdoor illuminance', unit: 'lux', valueType: 'number' }));
        expect(result.type).to.equal('illuminance');
        expect(result.evidence.map(item => item.source)).to.include('unit');
    });

    it('returns unknown when weak metadata does not clear the threshold', () => {
        const result = classifyState(descriptor({ name: 'Living room value', role: 'value', valueType: 'number' }));
        expect(result.type).to.equal('unknown');
        expect(result.confidence).to.be.lessThan(0.5);
    });

    it('marks lock and security metadata as sensitive', () => {
        const result = classifyState(descriptor({ name: 'Front door lock', role: 'switch.lock', write: true }));
        expect(result.type).to.equal('lock');
        expect(result.sensitive).to.equal(true);
    });
});
