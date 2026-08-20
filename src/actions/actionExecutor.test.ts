import { expect } from 'chai';
import { ActionAuditStore } from './actionAuditStore';
import { ActionExecutor, type ActionEnvironmentProvider, type ActionWriter } from './actionExecutor';
import { SafetyEngine } from './safetyEngine';
import type { FrozenActionRequest, SafetyEnvironment } from './types';

function request(): FrozenActionRequest {
    return {
        correlationId: 'correlation-1',
        patternId: '0123456789abcdef',
        targetStateId: 'alias.0.room.light',
        value: true,
        createdAt: 9_900,
        expiresAt: 15_000,
        contextTimestamp: 9_950,
    };
}

function validEnvironment(): SafetyEnvironment {
    return {
        now: 10_000,
        autonomyLevel: 3,
        pattern: {
            id: '0123456789abcdef',
            actionStateId: 'alias.0.room.light',
            status: 'approved',
            eligible: true,
            confidence: 0.9,
        },
        permissions: { observe: true, learn: true, suggest: true, control: true },
        target: { exists: true, objectType: 'state', write: true, valueType: 'boolean' },
        targetBlocked: false,
        cooldownUntil: 0,
        conditionsSatisfied: true,
        minimumConfidence: 0.7,
        maximumContextAgeMs: 60_000,
        maximumRequestWindowMs: 30_000,
    };
}

describe('ActionExecutor', () => {
    it('never writes a denied request', async () => {
        const writes: string[] = [];
        const audit = new ActionAuditStore();
        const provider: ActionEnvironmentProvider = {
            inspect: () => Promise.resolve({ ...validEnvironment(), autonomyLevel: 0 }),
            markExecuted: () => undefined,
        };
        const result = await new ActionExecutor(
            new SafetyEngine(),
            provider,
            { write: id => Promise.resolve(void writes.push(id)) },
            audit,
        ).execute(request());
        expect(result.executed).to.equal(false);
        expect(result.reasons).to.include('autonomy_denied');
        expect(writes).to.be.empty;
        expect(audit.page().items.map(item => item.stage)).to.deep.equal(['denied', 'requested']);
    });

    it('revalidates, writes exactly once and starts the cooldown', async () => {
        let inspections = 0;
        const writes: Array<[string, ioBroker.StateValue]> = [];
        const cooldowns: Array<[string, number]> = [];
        const audit = new ActionAuditStore();
        const provider: ActionEnvironmentProvider = {
            inspect: () => {
                inspections++;
                return Promise.resolve(validEnvironment());
            },
            markExecuted: (id, timestamp) => cooldowns.push([id, timestamp]),
        };
        const writer: ActionWriter = { write: (id, value) => Promise.resolve(void writes.push([id, value])) };
        const result = await new ActionExecutor(new SafetyEngine(), provider, writer, audit).execute(request());
        expect(result.executed).to.equal(true);
        expect(inspections).to.equal(1);
        expect(writes).to.deep.equal([['alias.0.room.light', true]]);
        expect(cooldowns).to.deep.equal([['alias.0.room.light', 10_000]]);
        expect(audit.page().items.map(item => item.stage)).to.deep.equal(['succeeded', 'write_started', 'requested']);
    });

    it('audits a failed writer without starting cooldown', async () => {
        let marked = false;
        const audit = new ActionAuditStore();
        const provider: ActionEnvironmentProvider = {
            inspect: () => Promise.resolve(validEnvironment()),
            markExecuted: () => {
                marked = true;
            },
        };
        const writer: ActionWriter = { write: async () => Promise.reject(new Error('permission_denied: detail')) };
        const result = await new ActionExecutor(new SafetyEngine(), provider, writer, audit).execute(request());
        expect(result).to.include({ executed: false, errorCode: 'permission_denied' });
        expect(marked).to.equal(false);
        expect(audit.page().items[0]).to.include({ stage: 'failed', errorCode: 'permission_denied' });
    });

    it('fails closed when last-moment inspection is unavailable', async () => {
        const writes: string[] = [];
        const audit = new ActionAuditStore();
        const provider: ActionEnvironmentProvider = {
            inspect: () => Promise.reject(new Error('database_closed')),
            markExecuted: () => undefined,
        };
        const result = await new ActionExecutor(
            new SafetyEngine(),
            provider,
            { write: id => Promise.resolve(void writes.push(id)) },
            audit,
        ).execute(request());
        expect(result).to.include({ executed: false, errorCode: 'safety_environment_unavailable' });
        expect(writes).to.be.empty;
        expect(audit.page().items.map(item => item.stage)).to.deep.equal(['failed', 'requested']);
    });
});
