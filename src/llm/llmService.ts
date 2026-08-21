import type { PatternSuggestion } from '../suggestions/types';
import { buildPatternDisclosure, disclosurePreview } from './disclosure';
import type { DisclosurePreview, LlmAnalysis, LlmPatternDisclosure, LlmProvider } from './types';

export interface LlmConnectionResult {
    ok: true;
    provider: LlmProvider['kind'];
    external: boolean;
    endpointOrigin?: string;
}

/** Advisory-only boundary. Its output type has no executable fields. */
export class LlmService {
    public constructor(
        private readonly provider: LlmProvider,
        private readonly endpointOrigin?: string,
    ) {}

    public preview(suggestion: PatternSuggestion, requestId: string): DisclosurePreview {
        return disclosurePreview(
            this.provider.kind,
            buildPatternDisclosure(suggestion, requestId),
            this.provider.external,
            this.endpointOrigin,
        );
    }

    public analyze(suggestion: PatternSuggestion, requestId: string, signal?: AbortSignal): Promise<LlmAnalysis> {
        return this.provider.analyze(buildPatternDisclosure(suggestion, requestId), signal);
    }

    /** Explicit, data-free provider/model/authentication check. Remote providers may bill one tiny request. */
    public async testConnection(requestId: string, signal?: AbortSignal): Promise<LlmConnectionResult> {
        const disclosure: LlmPatternDisclosure = {
            requestId,
            pattern: {
                conditionCount: 0,
                conditions: [],
                confidence: 0,
                opportunities: 0,
                matches: 0,
                actionWindowSeconds: 0,
                roomCount: 0,
            },
        };
        await this.provider.analyze(disclosure, signal);
        return {
            ok: true,
            provider: this.provider.kind,
            external: this.provider.external,
            endpointOrigin: this.endpointOrigin,
        };
    }

    public status(): { provider: LlmProvider['kind']; external: boolean; endpointOrigin?: string } {
        return { provider: this.provider.kind, external: this.provider.external, endpointOrigin: this.endpointOrigin };
    }
}
