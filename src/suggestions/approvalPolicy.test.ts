import { expect } from 'chai';
import { isTrustedApprovalSource } from './approvalPolicy';

describe('approval source policy', () => {
    it('accepts only an ioBroker Admin adapter instance', () => {
        expect(isTrustedApprovalSource('system.adapter.admin.0')).to.equal(true);
        expect(isTrustedApprovalSource('system.adapter.javascript.0')).to.equal(false);
        expect(isTrustedApprovalSource('system.host.test')).to.equal(false);
        expect(isTrustedApprovalSource('admin.0')).to.equal(false);
    });
});
