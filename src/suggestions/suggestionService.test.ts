import { expect } from 'chai';
import type { LearnedPattern } from '../patterns/types';
import { SuggestionService } from './suggestionService';

function pattern(overrides: Partial<LearnedPattern> = {}): LearnedPattern {
    return {
        id: '0123456789abcdef',
        triggerStateId: 'motion',
        actionStateId: 'light',
        expectedAction: true,
        actionWindowMs: 120_000,
        suggestionEligible: true,
        rooms: ['hall'],
        conditions: [{ feature: 'sun.sunsetOffset', value: -15 }],
        opportunities: 12,
        matches: 11,
        distinctDays: 6,
        positiveFeedback: 0,
        negativeFeedback: 0,
        confidence: 0.81,
        confidenceComponents: {
            smoothedMatchRate: 0.86,
            sampleMaturity: 0.6,
            repeatability: 1,
            recency: 1,
            feedbackAdjustment: 0,
        },
        heldOutImprovement: 0.2,
        firstSeen: 1,
        lastSeen: 2,
        status: 'candidate',
        explanation: 'source explanation',
        ...overrides,
    };
}

describe('SuggestionService', () => {
    it('creates a rules-only suggestion only with explicit suggestion eligibility', () => {
        const service = new SuggestionService();
        service.synchronize([pattern({ suggestionEligible: false })], 10);
        expect(service.summary().candidates).to.equal(0);

        service.synchronize([pattern()], 11);
        const [suggestion] = service.list(undefined).items;
        expect(suggestion.status).to.equal('candidate');
        expect(suggestion.explanation).to.contain('11/12');
        expect(suggestion.explanation).to.contain('within 120 seconds');
        expect(suggestion.explanation).to.contain('maturity 60%');
        expect(suggestion).not.to.have.property('control');
    });

    it('preserves a learned presence-off to light-off action', () => {
        const service = new SuggestionService();
        service.synchronize([pattern({ expectedAction: false })], 10);
        const [suggestion] = service.list(undefined).items;
        expect(suggestion.expectedAction).to.equal(false);
        expect(suggestion.explanation).to.contain('trigger becomes false');
        expect(suggestion.explanation).to.contain('light usually becomes false');
    });

    it('allows only candidate-approved-disabled-candidate transitions', () => {
        const service = new SuggestionService();
        service.synchronize([pattern()], 10);

        expect(service.transition('0123456789abcdef', 'approved', 'admin', 11).accepted).to.equal(true);
        expect(service.summary().approved).to.equal(1);
        const invalid = service.transition('0123456789abcdef', 'candidate', 'admin', 12);
        expect(invalid).to.include({ accepted: false, changed: false, reason: 'invalid_transition' });
        expect(service.transition('0123456789abcdef', 'disabled', 'admin', 13).accepted).to.equal(true);
        expect(service.transition('0123456789abcdef', 'candidate', 'admin', 14).accepted).to.equal(true);
        expect(service.summary().candidates).to.equal(1);
        expect(service.activityPage().items.map(item => item.type)).to.include.members([
            'candidate_created',
            'status_changed',
            'status_rejected',
        ]);
    });

    it('retains an approved audit object but marks it ineligible when evidence disappears', () => {
        const service = new SuggestionService();
        service.synchronize([pattern()], 10);
        service.transition('0123456789abcdef', 'approved', 'admin', 11);
        service.synchronize([], 12);

        const [suggestion] = service.list('approved').items;
        expect(suggestion.eligible).to.equal(false);
        expect(service.summary()).to.include({ approved: 1, ineligible: 1 });
    });

    it('rejects unknown patterns and bounds paging', () => {
        const service = new SuggestionService();
        expect(service.transition('missing', 'approved', 'admin', 1).reason).to.equal('pattern_not_found');
        expect(service.list(undefined, -1, 1_000)).to.include({ page: 0, pageSize: 100, total: 0 });
    });

    it('hard-bounds retained suggestions', () => {
        const service = new SuggestionService(undefined, 10);
        const patterns = Array.from({ length: 15 }, (_, index) =>
            pattern({ id: index.toString(16).padStart(16, '0') }),
        );
        service.synchronize(patterns, 10);
        expect(service.list(undefined).total).to.equal(10);
    });
});
