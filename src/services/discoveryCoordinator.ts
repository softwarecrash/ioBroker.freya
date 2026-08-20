import type { DiscoveryResult } from '../discovery/types';
import type { DiscoveryService } from '../discovery/discoveryService';

export interface DiscoveryStatusPort {
    setState(id: string, value: ioBroker.StateValue): Promise<void>;
    info(message: string): void;
    warn(message: string): void;
}

/** Publish only aggregate discovery information into ioBroker states. */
export class DiscoveryCoordinator {
    public constructor(
        private readonly service: DiscoveryService,
        private readonly port: DiscoveryStatusPort,
    ) {}

    /** Execute one discovery pass and publish its aggregate summary. */
    public async run(): Promise<DiscoveryResult> {
        await this.port.setState('discovery.status', 'scanning');
        try {
            const result = await this.service.run();
            const summary = result.summary;
            await this.port.setState('discovery.totalStateCount', summary.totalAvailable);
            await this.port.setState('discovery.scannedStateCount', summary.scanned);
            await this.port.setState('discovery.classifiedStateCount', summary.classified);
            await this.port.setState('discovery.unknownStateCount', summary.unknown);
            await this.port.setState('discovery.sensitiveStateCount', summary.sensitive);
            await this.port.setState('discovery.environmentCandidateCount', summary.environmentCandidates);
            await this.port.setState('permissions.configuredCount', summary.configuredPolicies);
            await this.port.setState('permissions.controllableCount', summary.controllablePolicies);
            await this.port.setState('discovery.lastRun', summary.timestamp);
            await this.port.setState('discovery.status', summary.truncated ? 'completed-truncated' : 'completed');
            this.port.info(
                `[Discovery] Completed metadata scan: ${summary.scanned}/${summary.totalAvailable} states, ${summary.classified} classified, ${summary.unknown} unknown`,
            );
            return result;
        } catch (error) {
            await this.port.setState('discovery.status', 'error');
            this.port.warn(`[Discovery] Metadata scan failed: ${(error as Error).message}`);
            throw error;
        }
    }
}
