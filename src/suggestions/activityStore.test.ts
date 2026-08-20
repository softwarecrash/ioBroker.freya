import { expect } from 'chai';
import { ActivityStore } from './activityStore';

describe('ActivityStore', () => {
    it('keeps a bounded newest-first audit page', () => {
        const store = new ActivityStore(20);
        for (let index = 0; index < 25; index++) {
            store.append({
                timestamp: index,
                type: 'status_rejected',
                patternId: 'pattern',
                actor: 'test',
                outcome: 'rejected',
                reason: 'invalid_transition',
            });
        }
        const firstPage = store.page(0, 5);
        expect(firstPage.total).to.equal(20);
        expect(firstPage.items.map(item => item.timestamp)).to.deep.equal([24, 23, 22, 21, 20]);
        expect(store.page(-2, 1_000).pageSize).to.equal(100);
    });
});
