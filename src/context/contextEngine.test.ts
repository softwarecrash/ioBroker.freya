import { expect } from 'chai';
import { ContextEngine } from './contextEngine';
import { TimeContextProvider } from './providers/timeContextProvider';
import type { ContextProvider } from './types';

describe('ContextEngine', () => {
    it('keeps a snapshot when an optional provider is unavailable', async () => {
        const unavailable: ContextProvider = {
            id: 'optional',
            isAvailable: () => Promise.resolve(false),
            getContext: () => Promise.reject(new Error('must not run')),
        };
        const timestamp = Date.parse('2026-08-20T10:00:00.000Z');
        const snapshot = await new ContextEngine(new TimeContextProvider('UTC'), [unavailable], {
            providerTimeoutMs: 50,
        }).snapshot({ timestamp });

        expect(snapshot.timestamp).to.equal(timestamp);
        expect(snapshot.time.hour).to.equal(10);
        expect(snapshot.failures).to.deep.equal([{ providerId: 'optional', code: 'unavailable' }]);
    });

    it('isolates optional provider timeouts', async () => {
        const hanging: ContextProvider = {
            id: 'hanging',
            isAvailable: () => Promise.resolve(true),
            getContext: () => new Promise(() => undefined),
        };
        const snapshot = await new ContextEngine(new TimeContextProvider('UTC'), [hanging], {
            providerTimeoutMs: 10,
        }).snapshot({ timestamp: 0 });

        expect(snapshot.failures).to.deep.equal([{ providerId: 'hanging', code: 'timeout', message: undefined }]);
    });
});
