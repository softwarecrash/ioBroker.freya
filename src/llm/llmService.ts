import type { PatternSuggestion } from '../suggestions/types';
import { buildPatternDisclosure, disclosurePreview } from './disclosure';
import type { DisclosurePreview, LlmAnalysis, LlmProvider } from './types';

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

    public status(): { provider: LlmProvider['kind']; external: boolean; endpointOrigin?: string } {
        return { provider: this.provider.kind, external: this.provider.external, endpointOrigin: this.endpointOrigin };
    }
}
