import { expect } from 'chai';
import { selectPatternFeatures } from './featureSelection';
import type { PatternExample } from './types';

describe('pattern feature selection', () => {
    it('selects predictive illuminance and rejects unrelated temperature', () => {
        const examples: PatternExample[] = Array.from({ length: 40 }, (_, index) => {
            const dark = index % 2 === 0;
            return {
                timestamp: index,
                matched: dark,
                features: {
                    values: {
                        'environment.illuminanceBand': dark ? 'dark' : 'bright',
                        'environment.temperatureBand': index % 4 < 2 ? 'cold' : 'warm',
                        'time.weekend': index % 7 > 4,
                    },
                },
            };
        });

        const selection = selectPatternFeatures(examples);
        expect(selection.conditions).to.deep.equal([{ feature: 'environment.illuminanceBand', value: 'dark' }]);
        expect(selection.heldOutImprovement).to.be.greaterThan(0.1);
    });

    it('prefers a stable sunset-relative relationship over changing clock time', () => {
        const examples: PatternExample[] = Array.from({ length: 48 }, (_, index) => {
            const nearSunset = index % 2 === 0;
            return {
                timestamp: index,
                matched: nearSunset,
                features: {
                    values: {
                        'time.halfHour': index % 12,
                        'sun.sunsetOffset': nearSunset ? -15 : -120,
                        'environment.temperatureBand': index % 3 === 0 ? 'cold' : 'warm',
                    },
                },
            };
        });

        const selection = selectPatternFeatures(examples);
        expect(selection.conditions).to.deep.equal([{ feature: 'sun.sunsetOffset', value: -15 }]);
    });

    it('does not invent conditions for sparse or random observations', () => {
        expect(selectPatternFeatures([]).conditions).to.deep.equal([]);
        const randomLike: PatternExample[] = Array.from({ length: 30 }, (_, index) => ({
            timestamp: index,
            matched: index % 2 === 0,
            features: { values: { 'presence.home': Math.floor(index / 2) % 2 === 0 } },
        }));
        expect(selectPatternFeatures(randomLike).conditions).to.deep.equal([]);
    });
});
