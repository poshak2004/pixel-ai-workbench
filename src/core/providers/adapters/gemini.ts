import { enrichFromCatalog } from '../../models/catalog';
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  ModelInfo,
  ProviderAdapter,
  ProviderConfig,
  ProviderDeps,
  ProviderFactory,
  StopReason,
  ToolCallRequest,
} from '../types';
import { ProviderError } from '../types';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Google Gemini via the generateContent REST API. */
export class GeminiAdapter implements ProviderAdapter {
  private readonly baseUrl: string;

  constructor(
    readonly config: ProviderConfig,
    private readonly secret: string | undefined,
    private readonly deps: ProviderDeps,
  ) {
    if (!secret) throw new ProviderError('Gemini requires an API key', config.id);
    this.baseUrl = (config.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  }

  private async call(path: string, body?: unknown, signal?: AbortSignal) {
    let res: Response;
    try {
      res = await this.deps.fetch(`${this.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.secret ?? '' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      throw new ProviderError(`Cannot reach Gemini: ${(err as Error).message}`, this.config.id, undefined, true);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const message = res.status === 400 || res.status === 403 ? `Gemini rejected the request (${res.status}): ${text.slice(0, 200)}` : `HTTP ${res.status}`;
      throw new ProviderError(message, this.config.id, res.status, res.status === 429 || res.status >= 500);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  async testConnection(signal?: AbortSignal) {
    const started = Date.now();
    try {
      await this.call('/models?pageSize=1', undefined, signal);
      return { ok: true, message: 'Authenticated', latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, message: (err as Error).message, latencyMs: Date.now() - started };
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const body = await this.call('/models?pageSize=200', undefined, signal);
    const models = (body.models as Record<string, unknown>[] | undefined) ?? [];
    return models
      .filter((m) => ((m.supportedGenerationMethods as string[] | undefined) ?? []).includes('generateContent'))
      .map((m) => {
        const id = String(m.name).replace(/^models\//, '');
        const meta = enrichFromCatalog('gemini', id);
        return {
          id,
          providerId: this.config.id,
          displayName: typeof m.displayName === 'string' ? m.displayName : id,
          contextWindow: typeof m.inputTokenLimit === 'number' ? m.inputTokenLimit : null,
          maxOutputTokens: typeof m.outputTokenLimit === 'number' ? m.outputTokenLimit : null,
          capabilities: meta.capabilities,
          pricing: meta.pricing,
        };
      });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: toGeminiContents(request.messages),
      generationConfig: {
        ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
        ...(request.responseFormat && !request.tools?.length ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (request.tools?.length) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: stripUnsupported(t.inputSchema),
          })),
        },
      ];
    }
    const json = await this.call(`/models/${encodeURIComponent(request.model)}:generateContent`, body, request.signal);
    const candidate = (json.candidates as Record<string, unknown>[] | undefined)?.[0];
    const parts = (((candidate?.content ?? {}) as Record<string, unknown>).parts as Record<string, unknown>[] | undefined) ?? [];
    let text = '';
    const toolCalls: ToolCallRequest[] = [];
    parts.forEach((p, i) => {
      if (typeof p.text === 'string' && !p.thought) text += p.text;
      const fc = p.functionCall as { id?: string; name?: string; args?: Record<string, unknown> } | undefined;
      if (fc?.name) toolCalls.push({ id: fc.id ?? `gemini_call_${i}`, name: fc.name, arguments: fc.args ?? {} });
    });
    const meta = (json.usageMetadata ?? {}) as Record<string, number | undefined>;
    return {
      text,
      toolCalls,
      stopReason: mapFinish(candidate?.finishReason as string | undefined, toolCalls.length),
      model: typeof json.modelVersion === 'string' ? json.modelVersion : request.model,
      usage: {
        inputTokens: meta.promptTokenCount ?? 0,
        outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
        cachedInputTokens: meta.cachedContentTokenCount ?? 0,
        reasoningTokens: meta.thoughtsTokenCount ?? 0,
      },
    };
  }
}

export function toGeminiContents(messages: ChatMessage[]) {
  const contents: { role: 'user' | 'model'; parts: Record<string, unknown>[] }[] = [];
  const push = (role: 'user' | 'model', part: Record<string, unknown>) => {
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(part);
    else contents.push({ role, parts: [part] });
  };
  for (const m of messages) {
    if (m.role === 'user') push('user', { text: m.content });
    else if (m.role === 'assistant') {
      if (m.content) push('model', { text: m.content });
      for (const c of m.toolCalls ?? []) push('model', { functionCall: { name: c.name, args: c.arguments } });
    } else {
      push('user', { functionResponse: { name: m.name, response: { content: m.content, isError: !!m.isError } } });
    }
  }
  return contents;
}

/** Gemini accepts an OpenAPI subset; drop keywords it rejects. */
function stripUnsupported(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripUnsupported);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === '$schema') continue;
    out[k] = stripUnsupported(v);
  }
  return out;
}

function mapFinish(reason: string | undefined, toolCount: number): StopReason {
  if (toolCount > 0) return 'tool_use';
  if (reason === 'STOP') return 'end';
  if (reason === 'MAX_TOKENS') return 'max_tokens';
  if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT') return 'refusal';
  return 'other';
}

export const geminiFactory: ProviderFactory = {
  kind: 'gemini',
  label: 'Google Gemini',
  authKind: 'api_key',
  defaultBaseUrl: DEFAULT_BASE,
  description: 'Gemini models via the Generative Language API.',
  create: (config, secret, deps) => new GeminiAdapter(config, secret, deps),
};
