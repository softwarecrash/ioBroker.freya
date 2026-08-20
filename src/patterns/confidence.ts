import type { ConfidenceComponents } from './types';

const DAY_MS = 24 * 60 * 60 * 1_000;

function clamp(value: number, minimum = 0, maximum = 1): number {
    return Math.max(minimum, Math.min(maximum, value));
}

export function calculateConfidence(input: {
    opportunities: number;
    matches: number;
    distinctDays: number;
    positiveFeedback: number;
    negativeFeedback: number;
    lastSeen: number;
    now: number;
}): { confidence: number; components: ConfidenceComponents } {
    const smoothedMatchRate = (input.matches + 1) / (input.opportunities + 2);
    const sampleMaturity = clamp(input.opportunities / 20);
    const repeatability = clamp(input.distinctDays / 4);
    const ageDays = Math.max(0, input.now - input.lastSeen) / DAY_MS;
    const recency = Math.exp(-ageDays / 45);
    const feedbackAdjustment = clamp((input.positiveFeedback - input.negativeFeedback) * 0.02, -0.15, 0.15);
    const evidenceWeight = 0.25 + 0.45 * sampleMaturity + 0.3 * repeatability;
    const confidence = clamp(smoothedMatchRate * evidenceWeight * recency + feedbackAdjustment);
    return {
        confidence,
        components: { smoothedMatchRate, sampleMaturity, repeatability, recency, feedbackAdjustment },
    };
}
