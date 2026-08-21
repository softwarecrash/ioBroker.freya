import { expect } from 'chai';
import { SourceAttributionService } from './sourceAttribution';

function state(value: ioBroker.StateValue, ack: boolean, source: string, timestamp: number): ioBroker.State {
    return { val: value, ack, from: source, ts: timestamp, lc: timestamp, q: 0 };
}

describe('SourceAttributionService', () => {
    it('correlates a generic foreign command with its device acknowledgement', () => {
        const service = new SourceAttributionService('system.adapter.freya.0');
        expect(
            service.classify('alias.0.light', state(true, false, 'system.adapter.node-red.0', 1_000), 1_000),
        ).to.include({
            kind: 'external-command',
            reason: 'foreign_command',
        });
        expect(
            service.classify('alias.0.light', state(true, true, 'system.adapter.zigbee2mqtt.0', 1_100), 1_100),
        ).to.include({
            kind: 'confirmation',
            commandKind: 'external-command',
            commandSource: 'system.adapter.node-red.0',
        });
    });

    it('recognizes direct Admin commands and unsolicited device changes without naming device adapters', () => {
        const service = new SourceAttributionService('system.adapter.freya.0');
        expect(
            service.classify('alias.0.light', state(true, false, 'system.adapter.admin.0', 1_000), 1_000),
        ).to.include({
            kind: 'direct-user',
        });
        expect(
            service.classify('alias.0.other', state(true, true, 'system.adapter.any-device.0', 1_100), 1_100),
        ).to.include({
            kind: 'device-originated',
        });
    });

    it('recognizes Freya writes and does not correlate stale commands', () => {
        const service = new SourceAttributionService('system.adapter.freya.0', 1_000);
        expect(
            service.classify('alias.0.light', state(true, false, 'system.adapter.freya.0', 1_000), 1_000),
        ).to.include({ kind: 'self' });
        expect(
            service.classify('alias.0.light', state(true, true, 'system.adapter.device.0', 2_001), 2_001),
        ).to.include({
            kind: 'device-originated',
        });
    });

    it('uses a per-event bridge intent without classifying the whole adapter', () => {
        const service = new SourceAttributionService('system.adapter.freya.0');
        expect(service.reportIntent('alias.0.light', true, 'user', 'system.adapter.node-red.0', 1_000)).to.equal(true);
        expect(
            service.classify('alias.0.light', state(true, false, 'system.adapter.node-red.0', 1_100), 1_100),
        ).to.include({
            kind: 'direct-user',
            reason: 'reported_user_intent',
        });
        expect(
            service.classify('alias.0.other', state(true, false, 'system.adapter.node-red.0', 1_200), 1_200),
        ).to.include({
            kind: 'external-command',
        });
    });
});
