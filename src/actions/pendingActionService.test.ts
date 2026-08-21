import { expect } from 'chai';
import type { PatternSuggestion } from '../suggestions/types';
import { PendingActionService } from './pendingActionService';

function suggestion(): PatternSuggestion {
    return {
        id: '0123456789abcdef',
        patternId: '0123456789abcdef',
        status: 'approved',
        eligible: true,
        triggerStateId: 'presence',
        actionStateId: 'light',
        expectedAction: true,
        rooms: ['kitchen'],
        conditions: [],
        opportunities: 12,
        matches: 11,
        confidence: 0.9,
        confidenceComponents: {
            smoothedMatchRate: 0.9,
            sampleMaturity: 0.8,
            repeatability: 1,
            recency: 1,
            feedbackAdjustment: 0,
        },
        actionWindowMs: 120_000,
        explanation: 'fixture',
        createdAt: 1,
        updatedAt: 2,
    };
}

describe('PendingActionService', () => {
    it('claims a level-2 proposal exactly once and retains the execution result', () => {
        const service = new PendingActionService(20, 10_000);
        expect(service.propose(suggestion(), 1_000, 'action-1')?.status).to.equal('pending');
        const claim = service.claimOneShot('action-1', 2_000);
        expect(claim.request).to.include({
            authorization: 'one-shot',
            targetStateId: 'light',
            value: true,
            createdAt: 2_000,
            contextTimestamp: 2_000,
        });
        expect(service.claimOneShot('action-1', 2_001)).to.include({
            accepted: false,
            reason: 'pending_action_executing',
        });
        service.complete('action-1', { correlationId: 'action-1', executed: true, reasons: [] }, 3_000);
        expect(service.list('executed').items[0]).to.include({ status: 'executed', completedAt: 3_000 });
    });

    it('expires proposals and never replays an interrupted execution after restore', () => {
        const service = new PendingActionService(20, 5_000);
        service.propose(suggestion(), 1_000, 'expired');
        service.propose({ ...suggestion(), id: 'fedcba9876543210', patternId: 'fedcba9876543210' }, 2_000, 'running');
        service.claimOneShot('running', 2_500);

        const restored = new PendingActionService(20, 5_000);
        restored.restore(service.snapshot(), 7_000);
        expect(restored.list('expired').items.map(item => item.id)).to.deep.equal(['expired']);
        expect(restored.list('denied').items[0]).to.include({ id: 'running', errorCode: 'execution_interrupted' });
    });

    it('creates only one active proposal for a pattern', () => {
        const service = new PendingActionService();
        expect(service.propose(suggestion(), 1, 'one')).not.to.equal(undefined);
        expect(service.propose(suggestion(), 2, 'two')).to.equal(undefined);
        expect(service.reject('one', 3).accepted).to.equal(true);
        expect(service.propose(suggestion(), 4, 'two')).not.to.equal(undefined);
    });

    it('claims a level-3 live trigger with automatic authorization', () => {
        const service = new PendingActionService();
        const claim = service.beginAutomatic(suggestion(), 1_000, 'automatic-1');
        expect(claim).to.include({ accepted: true, reason: 'automatic_claimed' });
        expect(claim.request).to.include({ authorization: 'automatic', patternId: suggestion().id });
        expect(service.beginAutomatic(suggestion(), 1_001, 'automatic-2').accepted).to.equal(false);
    });
});
