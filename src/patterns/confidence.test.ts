import { expect } from 'chai';
import { calculateConfidence } from './confidence';

describe('pattern confidence', () => {
    it('keeps tiny perfect samples below mature repeated samples', () => {
        const now = Date.UTC(2026, 0, 20);
        const tiny = calculateConfidence({
            opportunities: 2,
            matches: 2,
            distinctDays: 1,
            positiveFeedback: 0,
            negativeFeedback: 0,
            lastSeen: now,
            now,
        });
        const mature = calculateConfidence({
            opportunities: 20,
            matches: 20,
            distinctDays: 10,
            positiveFeedback: 0,
            negativeFeedback: 0,
            lastSeen: now,
            now,
        });
        expect(tiny.confidence).to.be.lessThan(mature.confidence);
        expect(mature.components.sampleMaturity).to.equal(1);
        expect(mature.components.repeatability).to.equal(1);
    });

    it('decays stale evidence and bounds feedback influence', () => {
        const now = Date.UTC(2026, 5, 1);
        const recent = calculateConfidence({
            opportunities: 20,
            matches: 18,
            distinctDays: 10,
            positiveFeedback: 100,
            negativeFeedback: 0,
            lastSeen: now,
            now,
        });
        const stale = calculateConfidence({
            opportunities: 20,
            matches: 18,
            distinctDays: 10,
            positiveFeedback: 0,
            negativeFeedback: 0,
            lastSeen: now - 90 * 24 * 60 * 60 * 1_000,
            now,
        });
        expect(recent.components.feedbackAdjustment).to.equal(0.15);
        expect(stale.confidence).to.be.lessThan(recent.confidence);
    });
});
