import type { RuntimeConfig } from '../config/runtimeConfig';
import { FetchJsonTransport, type JsonHttpTransport } from './httpTransport';
import {
    DisabledLlmProvider,
    OllamaLlmProvider,
    OpenAiCompatibleLlmProvider,
    OpenAiLlmProvider,
    RulesOnlyLlmProvider,
} from './providers';
import type { LlmProvider } from './types';

export function createLlmProvider(
    config: RuntimeConfig,
    transport: JsonHttpTransport = new FetchJsonTransport(),
): LlmProvider {
    switch (config.llmProvider) {
        case 'rules':
            return new RulesOnlyLlmProvider();
        case 'ollama':
            return new OllamaLlmProvider(
                transport,
                config.llmBaseUrl,
                config.llmModel,
                config.llmTimeoutSeconds * 1_000,
            );
        case 'openai':
            return new OpenAiLlmProvider(
                transport,
                config.llmModel,
                config.llmTimeoutSeconds * 1_000,
                config.llmApiKey,
            );
        case 'openai-compatible':
            return new OpenAiCompatibleLlmProvider(
                transport,
                config.llmBaseUrl,
                config.llmModel,
                config.llmTimeoutSeconds * 1_000,
                config.llmApiKey,
            );
        default:
            return new DisabledLlmProvider();
    }
}
