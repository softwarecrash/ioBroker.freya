import { clearTimeout as cancelTimeout, setTimeout as scheduleTimeout } from 'node:timers';

export interface JsonHttpTransport {
    post(
        url: string,
        body: unknown,
        headers: Record<string, string>,
        timeoutMs: number,
        signal?: AbortSignal,
    ): Promise<unknown>;
}

export async function boundedJson(response: Response, maximumBytes = 65_536): Promise<unknown> {
    if (!response.ok) {
        throw new Error(`llm_http_${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('llm_response_empty');
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
        const result = await reader.read();
        if (result.done) {
            break;
        }
        length += result.value.length;
        if (length > maximumBytes) {
            await reader.cancel();
            throw new Error('llm_response_too_large');
        }
        chunks.push(result.value);
    }
    const merged = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }
    try {
        return JSON.parse(new TextDecoder().decode(merged)) as unknown;
    } catch {
        throw new Error('llm_response_json_invalid');
    }
}

export class FetchJsonTransport implements JsonHttpTransport {
    public async post(
        url: string,
        body: unknown,
        headers: Record<string, string>,
        timeoutMs: number,
        signal?: AbortSignal,
    ): Promise<unknown> {
        const controller = new AbortController();
        const timeout = scheduleTimeout(() => controller.abort(), Math.max(100, Math.min(timeoutMs, 60_000)));
        const abort = (): void => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...headers },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            return await boundedJson(response);
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                throw new Error('llm_timeout');
            }
            throw error;
        } finally {
            cancelTimeout(timeout);
            signal?.removeEventListener('abort', abort);
        }
    }
}
