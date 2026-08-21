import { expect } from 'chai';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LearningSnapshot } from './learningRepository';
import { LearningRepository } from './learningRepository';

function snapshot(): LearningSnapshot {
    return {
        patterns: [
            {
                key: 'motion\u0000light\u0000true',
                triggerStateId: 'motion',
                actionStateId: 'light',
                rooms: ['hall'],
                examples: [
                    {
                        timestamp: 1,
                        matched: true,
                        features: { values: { 'presence.home': true } },
                    },
                ],
                firstSeen: 1,
                lastSeen: 1,
                positiveFeedback: 0,
                negativeFeedback: 0,
                expectedAction: true,
            },
        ],
        suggestions: [
            {
                id: '0123456789abcdef',
                patternId: '0123456789abcdef',
                status: 'approved',
                eligible: true,
                triggerStateId: 'motion',
                actionStateId: 'light',
                expectedAction: true,
                rooms: ['hall'],
                conditions: [{ feature: 'presence.home', value: true }],
                opportunities: 12,
                matches: 11,
                confidence: 0.8,
                confidenceComponents: {
                    smoothedMatchRate: 0.8,
                    sampleMaturity: 0.6,
                    repeatability: 1,
                    recency: 1,
                    feedbackAdjustment: 0,
                },
                actionWindowMs: 120_000,
                explanation: 'test',
                createdAt: 1,
                updatedAt: 2,
            },
        ],
    };
}

describe('LearningRepository', () => {
    let directory = '';
    let filename = '';

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'freya-learning-'));
        filename = join(directory, 'learning.v1.json');
    });

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    it('atomically persists and reloads learned evidence and approval state', async () => {
        const repository = new LearningRepository(filename);
        await repository.save(snapshot());
        expect(await repository.load()).to.deep.equal(snapshot());
        expect(JSON.parse(await readFile(filename, 'utf8')).schemaVersion).to.equal(1);
    });

    it('returns an empty snapshot for a new installation', async () => {
        expect(await new LearningRepository(filename).load()).to.deep.equal({ patterns: [], suggestions: [] });
    });

    it('rejects an invalid schema and recovers the previous valid backup', async () => {
        const repository = new LearningRepository(filename);
        await repository.save(snapshot());
        const newer = snapshot();
        newer.suggestions[0].status = 'disabled';
        await repository.save(newer);
        await writeFile(filename, '{"schemaVersion":1,"patterns":"invalid"}\n', 'utf8');
        expect(await repository.load()).to.deep.equal(snapshot());
    });
});
