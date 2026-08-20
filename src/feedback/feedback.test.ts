import { expect } from 'chai';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ActionResult, FrozenActionRequest } from '../actions/types';
import { ActionRepository } from './actionRepository';
import { FeedbackService } from './feedbackService';

function request(index = 1): FrozenActionRequest {
    return {
        correlationId: `correlation-${index}`,
        patternId: '0123456789abcdef',
        targetStateId: 'alias.0.room.light',
        value: true,
        createdAt: 1_000,
        expiresAt: 2_000,
        contextTimestamp: 1_000,
    };
}

const executed: ActionResult = { correlationId: 'correlation-1', executed: true, reasons: [] };

describe('action persistence and feedback attribution', () => {
    let directory = '';
    let filename = '';

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'smartbrain-feedback-'));
        filename = join(directory, 'actions.json');
    });

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    it('persists schema-versioned complete action records and reloads them', async () => {
        const repository = new ActionRepository(filename);
        await repository.load();
        await repository.requested(request(), 1_000);
        await repository.completed(request(), executed, 1_100);
        await repository.feedback('correlation-1', 'positive', 'explicit', 1_200, 'system.adapter.admin.0');

        const stored = JSON.parse(await readFile(filename, 'utf8')) as { schemaVersion: number };
        expect(stored.schemaVersion).to.equal(1);
        const reloaded = new ActionRepository(filename);
        await reloaded.load();
        expect(reloaded.find('correlation-1')).to.deep.include({ executed: true, completedAt: 1_100 });
        expect(reloaded.summary()).to.include({ actionCount: 1, positiveCount: 1, pendingCount: 0 });
    });

    it('rejects an invalid persisted schema instead of trusting it', async () => {
        await writeFile(filename, JSON.stringify({ schemaVersion: 99, actions: [] }));
        let code = '';
        try {
            await new ActionRepository(filename).load();
        } catch (error) {
            code = (error as Error).message;
        }
        expect(code).to.equal('action_repository_schema_invalid');
    });

    it('migrates schema 0 and recovers a valid backup when the primary is corrupt', async () => {
        const legacyRecord = {
            correlationId: 'correlation-1',
            patternId: '0123456789abcdef',
            targetStateId: 'alias.0.room.light',
            expectedValue: true,
            requestedAt: 1_000,
            executed: false,
            reasons: [],
        };
        await writeFile(filename, JSON.stringify({ schemaVersion: 0, records: [legacyRecord] }));
        const migrated = new ActionRepository(filename);
        await migrated.load();
        expect((JSON.parse(await readFile(filename, 'utf8')) as { schemaVersion: number }).schemaVersion).to.equal(1);
        await migrated.completed(request(), executed, 1_100);
        await writeFile(filename, '{corrupt');

        const recovered = new ActionRepository(filename);
        await recovered.load();
        expect(recovered.find('correlation-1')).to.not.equal(undefined);
    });

    it('marks only the newest opposing target change and keeps ambiguous sources unknown', async () => {
        const repository = new ActionRepository(filename);
        await repository.load();
        await repository.requested(request(), 1_000);
        await repository.completed(request(), executed, 1_100);
        const service = new FeedbackService(repository, 'system.adapter.smartbrain.0', 10_000);

        await service.observe(
            'alias.0.unrelated',
            { val: false, ack: false, ts: 1_200, lc: 1_200, from: 'system.adapter.admin.0' },
            1_200,
        );
        expect(repository.find('correlation-1')?.feedback).to.equal(undefined);
        await service.observe(
            'alias.0.room.light',
            { val: true, ack: false, ts: 1_300, lc: 1_300, from: 'system.adapter.admin.0' },
            1_300,
        );
        expect(repository.find('correlation-1')?.feedback).to.equal(undefined);
        await service.observe(
            'alias.0.room.light',
            { val: false, ack: true, ts: 1_400, lc: 1_400, from: 'system.adapter.device.0' },
            1_400,
        );
        expect(repository.find('correlation-1')?.feedback).to.include({ outcome: 'unknown', source: 'implicit' });
    });

    it('attributes an opposing Admin change conservatively and lets explicit feedback override it', async () => {
        const repository = new ActionRepository(filename);
        await repository.load();
        await repository.requested(request(), 1_000);
        await repository.completed(request(), executed, 1_100);
        const service = new FeedbackService(repository, 'system.adapter.smartbrain.0', 10_000);
        await service.observe(
            'alias.0.room.light',
            { val: false, ack: false, ts: 1_400, lc: 1_400, from: 'system.adapter.admin.0' },
            1_400,
        );
        expect(repository.find('correlation-1')?.feedback).to.include({ outcome: 'negative', source: 'implicit' });

        const result = await service.explicit('correlation-1', 'positive', 'system.adapter.admin.0', 1_500, 'worked');
        expect(result).to.include({ accepted: true, reason: 'feedback_recorded' });
        expect(repository.find('correlation-1')?.feedback).to.include({ outcome: 'positive', source: 'explicit' });
        await repository.feedback('correlation-1', 'negative', 'implicit', 1_600);
        expect(repository.find('correlation-1')?.feedback).to.include({ outcome: 'positive', source: 'explicit' });
    });

    it('expires unchanged actions as neutral without changing confidence totals', async () => {
        const repository = new ActionRepository(filename);
        await repository.load();
        await repository.requested(request(), 1_000);
        await repository.completed(request(), executed, 1_100);
        const service = new FeedbackService(repository, 'system.adapter.smartbrain.0', 5_000);
        await service.expire(6_101);
        expect(repository.find('correlation-1')?.feedback).to.include({ outcome: 'neutral', source: 'implicit' });
        expect(repository.totals('0123456789abcdef')).to.deep.equal({ positive: 0, negative: 0 });
    });
});
