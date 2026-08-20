import { expect } from 'chai';
import { HistoryService } from './historyService';
import { IoBrokerHistoryProvider, IoBrokerHistoryTransport, type HistoryTransport } from './ioBrokerHistoryProvider';
import { NoneHistoryProvider } from './noneHistoryProvider';
import { normalizeHistoryResponse } from './normalizer';
import {
    HistoryProviderDiscovery,
    IoBrokerHistoryInstanceSource,
    type HistoryInstanceSource,
} from './providerDiscovery';
import type { HistoryProvider, HistoryProviderDescriptor } from './types';

const influx: HistoryProviderDescriptor = {
    id: 'influxdb.0',
    adapterName: 'influxdb',
    enabled: true,
    alive: true,
    supportsGetHistory: true,
};

describe('history normalization', () => {
    it('sorts, deduplicates, validates and bounds provider values', () => {
        const result = normalizeHistoryResponse(
            {
                result: [
                    { ts: 30, val: 'x'.repeat(5_000), ack: true, q: 0, from: 'fixture.0' },
                    { ts: 10, val: false },
                    { ts: 20, val: { unsafe: true } },
                    { ts: 30, val: 'x'.repeat(5_000), ack: true, q: 0, from: 'fixture.0' },
                    { ts: 40, val: true },
                ],
            },
            10,
            30,
            2,
        );

        expect(result.map(entry => entry.timestamp)).to.deep.equal([10, 30]);
        expect(result[1].value).to.equal('x'.repeat(4_096));
    });

    it('rejects invalid and explicit provider error responses', () => {
        expect(() => normalizeHistoryResponse(undefined, 0, 1, 10)).to.throw('history_invalid_response');
        expect(() => normalizeHistoryResponse({ error: 'failed' }, 0, 1, 10)).to.throw('history_provider_error:failed');
    });
});

describe('HistoryProviderDiscovery', () => {
    it('requires enabled, alive capability and prioritizes InfluxDB, SQL and History', async () => {
        const source: HistoryInstanceSource = {
            list: () =>
                Promise.resolve([
                    { id: 'history.0', adapterName: 'history', enabled: true, alive: true, supportsGetHistory: true },
                    { id: 'sql.0', adapterName: 'sql', enabled: true, alive: true, supportsGetHistory: true },
                    influx,
                    { id: 'dead.0', adapterName: 'other', enabled: true, alive: false, supportsGetHistory: true },
                    { id: 'fake.0', adapterName: 'other', enabled: true, alive: true, supportsGetHistory: false },
                ]),
        };

        const result = await new HistoryProviderDiscovery(source).available();

        expect(result.map(item => item.id)).to.deep.equal(['influxdb.0', 'sql.0', 'history.0']);
    });

    it('derives capability and liveness from instance objects and alive states', async () => {
        let aliveIds: string[] = [];
        const adapter = {
            getObjectViewAsync: () =>
                Promise.resolve({
                    rows: [
                        {
                            id: 'system.adapter.influxdb.0',
                            value: {
                                _id: 'system.adapter.influxdb.0',
                                type: 'instance',
                                common: { enabled: true, getHistory: true },
                                native: {},
                            },
                        },
                        {
                            id: 'system.adapter.unrelated.0',
                            value: {
                                _id: 'system.adapter.unrelated.0',
                                type: 'instance',
                                common: { enabled: true },
                                native: {},
                            },
                        },
                    ],
                }),
            getForeignStatesAsync: (ids: string[]) => {
                aliveIds = ids;
                return Promise.resolve({
                    'system.adapter.influxdb.0.alive': {
                        val: true,
                        ack: true,
                        ts: 1,
                        lc: 1,
                        q: 0,
                        from: 'system.host.fixture',
                    },
                });
            },
        } as unknown as ioBroker.Adapter;

        const descriptors = await new IoBrokerHistoryInstanceSource(adapter).list();

        expect(aliveIds).to.deep.equal(['system.adapter.influxdb.0.alive']);
        expect(descriptors).to.deep.equal([influx]);
    });
});

describe('IoBrokerHistoryProvider', () => {
    it('delegates timeout enforcement to the ioBroker message API', async () => {
        let options: { timeout?: number } | undefined;
        const adapter = {
            sendToAsync: (
                _instanceId: string,
                _command: string,
                _message: Record<string, unknown>,
                receivedOptions: { timeout?: number },
            ) => {
                options = receivedOptions;
                return Promise.resolve({ result: [] });
            },
        } as unknown as ioBroker.Adapter;

        await new IoBrokerHistoryTransport(adapter).request('influxdb.0', {}, 5_000);

        expect(options).to.deep.equal({ timeout: 5_000 });
    });

    it('sends a bounded standard getHistory request and normalizes the result', async () => {
        let sent: { instanceId: string; message: Record<string, unknown>; timeoutMs: number } | undefined;
        const transport: HistoryTransport = {
            request: (instanceId, message, timeoutMs) => {
                sent = { instanceId, message, timeoutMs };
                return Promise.resolve({ result: [{ ts: 10, val: true }] });
            },
        };
        const provider = new IoBrokerHistoryProvider(influx, transport, 1_000, 100);

        const result = await provider.getHistory('fixture.0.allowed', 0, 20, { limit: 500 });

        expect(result).to.deep.equal([{ timestamp: 10, value: true }]);
        expect(sent?.instanceId).to.equal('influxdb.0');
        expect(sent?.timeoutMs).to.equal(1_000);
        expect(sent?.message).to.deep.equal({
            id: 'fixture.0.allowed',
            options: {
                start: 0,
                end: 20,
                aggregate: 'onchange',
                count: 100,
                limit: 100,
                ack: true,
                q: true,
                from: true,
            },
        });
    });

    it('supports cancellation before dispatch', async () => {
        let called = false;
        const transport: HistoryTransport = {
            request: () => {
                called = true;
                return Promise.resolve({ result: [] });
            },
        };
        const controller = new AbortController();
        controller.abort();
        const provider = new IoBrokerHistoryProvider(influx, transport);

        let error: Error | undefined;
        try {
            await provider.getHistory('fixture.0.allowed', 0, 20, { signal: controller.signal });
        } catch (caught) {
            error = caught as Error;
        }

        expect(error?.message).to.equal('history_query_cancelled');
        expect(called).to.equal(false);
    });

    it('cancels an in-flight request without accepting its later response', async () => {
        const transport: HistoryTransport = { request: () => new Promise(() => undefined) };
        const controller = new AbortController();
        const provider = new IoBrokerHistoryProvider(influx, transport);
        const pending = provider.getHistory('fixture.0.allowed', 0, 20, { signal: controller.signal });

        controller.abort();

        let error: Error | undefined;
        try {
            await pending;
        } catch (caught) {
            error = caught as Error;
        }
        expect(error?.message).to.equal('history_query_cancelled');
    });
});

describe('HistoryService', () => {
    function provider(getHistory: HistoryProvider['getHistory']): HistoryProvider {
        return { id: 'influxdb.0', isAvailable: () => Promise.resolve(true), getHistory };
    }

    it('allows only permission-gated states and clamps results', async () => {
        let receivedLimit: number | undefined;
        const service = new HistoryService(
            'auto',
            provider((_stateId, _start, _end, options) => {
                receivedLimit = options?.limit;
                return Promise.resolve([
                    { timestamp: 1, value: 1 },
                    { timestamp: 2, value: 2 },
                ]);
            }),
            [influx],
            ['fixture.0.allowed'],
            { maxRangeMs: 1_000, maxResults: 1, maxConcurrent: 1 },
        );

        const entries = await service.query('fixture.0.allowed', 0, 10, 100);

        expect(receivedLimit).to.equal(1);
        expect(entries).to.deep.equal([{ timestamp: 2, value: 2 }]);
        expect((await service.summary()).queryCount).to.equal(1);
    });

    it('rejects denied states, invalid ranges and excessive ranges before dispatch', async () => {
        let calls = 0;
        const service = new HistoryService(
            'auto',
            provider(() => {
                calls++;
                return Promise.resolve([]);
            }),
            [influx],
            ['fixture.0.allowed'],
            { maxRangeMs: 100, maxResults: 10, maxConcurrent: 1 },
        );

        for (const request of [
            () => service.query('fixture.0.denied', 0, 10),
            () => service.query('fixture.0.allowed', 20, 10),
            () => service.query('fixture.0.allowed', 0, 101),
        ]) {
            let rejected = false;
            try {
                await request();
            } catch {
                rejected = true;
            }
            expect(rejected).to.equal(true);
        }
        expect(calls).to.equal(0);
    });

    it('uses the disabled provider as a no-data safe default', async () => {
        const none = new NoneHistoryProvider();
        expect(await none.isAvailable()).to.equal(false);
        expect(await none.getHistory('fixture.0.allowed', 0, 1)).to.deep.equal([]);
    });

    it('rejects concurrent work above the configured bound', async () => {
        let finish: (() => void) | undefined;
        const blocked = new Promise<void>(resolve => (finish = resolve));
        const service = new HistoryService(
            'auto',
            provider(async () => {
                await blocked;
                return [];
            }),
            [influx],
            ['fixture.0.allowed'],
            { maxRangeMs: 100, maxResults: 10, maxConcurrent: 1 },
        );
        const first = service.query('fixture.0.allowed', 0, 10);

        let error: Error | undefined;
        try {
            await service.query('fixture.0.allowed', 0, 10);
        } catch (caught) {
            error = caught as Error;
        }
        finish?.();
        await first;

        expect(error?.message).to.equal('history_query_overloaded');
    });
});
