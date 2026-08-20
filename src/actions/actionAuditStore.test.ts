import { expect } from 'chai';
import { ActionAuditStore } from './actionAuditStore';

describe('ActionAuditStore', () => {
    it('bounds retention, paging and returned copies', () => {
        const store = new ActionAuditStore(20);
        for (let index = 0; index < 25; index++) {
            store.append({
                correlationId: `correlation-${index}`,
                patternId: '0123456789abcdef',
                targetStateId: 'alias.0.room.light',
                timestamp: index,
                stage: 'requested',
                reasons: [],
            });
        }
        const page = store.page(1, 5);
        expect(page).to.include({ page: 1, pageSize: 5, total: 20 });
        expect(page.items.map(item => item.timestamp)).to.deep.equal([19, 18, 17, 16, 15]);
        page.items[0].reasons.push('target_blocked');
        expect(store.page(1, 5).items[0].reasons).to.be.empty;
    });
});
