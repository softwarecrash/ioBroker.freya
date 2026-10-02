import { buildPatternDisclosure, disclosurePreview } from './disclosure';
import type { DisclosurePreview, LlmAnalysis, LlmPatternDisclosure, LlmPatternInput, LlmProvider } from './types';

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

    public preview(pattern: LlmPatternInput, requestId: string): DisclosurePreview {
        return disclosurePreview(
            this.provider.kind,
            buildPatternDisclosure(pattern, requestId),
            this.provider.external,
            this.endpointOrigin,
        );
    }

    public async analyze(pattern: LlmPatternInput, requestId: string, signal?: AbortSignal): Promise<LlmAnalysis> {
        const analysis = await this.provider.analyze(buildPatternDisclosure(pattern, requestId), signal);
        // A model may only request a prospective test of a bucket actually disclosed for this pattern.
        const hypothesis =
            analysis.hypothesis &&
            pattern.evidence?.some(
                row => row.feature === analysis.hypothesis?.feature && row.value === analysis.hypothesis.value,
            )
                ? analysis.hypothesis
                : null;
        // The model may explain evidence, but cannot downgrade the automation risk of an immature relationship.
        if (pattern.confidence < 0.58 || pattern.matches < 5 || (pattern.distinctDays ?? 0) < 3) {
            return { ...analysis, hypothesis, riskLevel: 'high' };
        }
        return { ...analysis, hypothesis };
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
