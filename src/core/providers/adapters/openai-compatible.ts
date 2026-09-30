import { enrichFromCatalog } from '../../models/catalog';
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  ModelInfo,
  ModelPricing,
  ProviderAdapter,
  ProviderConfig,
  ProviderDeps,
  ProviderFactory,
  ProviderKind,
  StopReason,
  ToolCallRequest,
} from '../types';
import { ProviderError } from '../types';

/**
 * One adapter for every endpoint speaking the OpenAI Chat Completions dialect:
 * OpenAI itself, OpenRouter, arbitrary compatible gateways and local servers (Ollama, LM Studio, vLLM).
 */
export class OpenAICompatibleAdapter implements ProviderAdapter {
  private readonly baseUrl: string;

  constructor(
    readonly config: ProviderConfig,
    private readonly secret: string | undefined,
    private readonly deps: ProviderDeps,
    defaultBaseUrl: string,
  ) {
    this.baseUrl = (config.baseUrl || defaultBaseUrl).replace(/\/+$/, '');
    if (config.authKind === 'api_key' && !secret) {
      throw new ProviderError(`${config.name} requires an API key`, config.id);
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.secret) h.authorization = `Bearer ${this.secret}`;
    if (this.config.kind === 'openrouter') {
      h['x-title'] = 'PIXEL';
    }
    return h;
  }

  private async request(path: string, init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }) {
    let res: Response;
    try {
      res = await this.deps.fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: this.headers(),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      throw new ProviderError(`Cannot reach ${this.baseUrl}: ${(err as Error).message}`, this.config.id, undefined, true);
    }
    if (!res.ok) {
      const detail = await safeText(res);
      const message = res.status === 401 ? 'Invalid API key' : `HTTP ${res.status}: ${detail.slice(0, 300)}`;
      throw new ProviderError(message, this.config.id, res.status, res.status === 429 || res.status >= 500);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  async testConnection(signal?: AbortSignal) {
    const started = Date.now();
    try {
      await this.request('/models', { method: 'GET', signal });
      return { ok: true, message: 'Connected', latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, message: (err as Error).message, latencyMs: Date.now() - started };
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const body = await this.request('/models', { method: 'GET', signal });
    const data = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
    return data
      .filter((m) => typeof m.id === 'string')
      .map((m) => {
        const id = m.id as string;
        const meta = enrichFromCatalog(this.config.kind, id);
        return {
          id,
          providerId: this.config.id,
          displayName: typeof m.name === 'string' ? m.name : id,
          contextWindow: typeof m.context_length === 'number' ? m.context_length : (meta.contextWindow ?? null),
          maxOutputTokens: meta.maxOutputTokens ?? null,
          capabilities: meta.capabilities,
          pricing: parseOpenRouterPricing(m.pricing) ?? meta.pricing,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const kind = this.config.kind;
    const body: Record<string, unknown> = {
      model: request.model,
      messages: [{ role: 'system', content: request.system }, ...toOpenAIMessages(request.messages)],
    };
    if (request.maxTokens) body[kind === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = request.maxTokens;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    } else if (request.responseFormat && supportsJsonMode(kind)) {
      body.response_format = { type: 'json_object' };
    }
    if (kind === 'openrouter') body.usage = { include: true };

    const json = await this.request('/chat/completions', { method: 'POST', body, signal: request.signal });
    const choice = (json.choices as Record<string, unknown>[] | undefined)?.[0];
    if (!choice) throw new ProviderError('Provider returned no choices', this.config.id);
    const message = (choice.message ?? {}) as Record<string, unknown>;
    const toolCalls: ToolCallRequest[] = ((message.tool_calls as Record<string, unknown>[] | undefined) ?? []).map((tc, i) => {
      const fn = (tc.function ?? {}) as { name?: string; arguments?: string };
      return {
        id: typeof tc.id === 'string' ? tc.id : `call_${i}`,
        name: fn.name ?? 'unknown',
        arguments: parseArgs(fn.arguments),
      };
    });
    const usage = (json.usage ?? {}) as Record<string, unknown>;
    const promptDetails = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
    const completionDetails = (usage.completion_tokens_details ?? {}) as Record<string, unknown>;
    return {
      text: typeof message.content === 'string' ? message.content : '',
      toolCalls,
      stopReason: mapFinish(choice.finish_reason as string | undefined, toolCalls.length),
      model: typeof json.model === 'string' ? json.model : request.model,
      usage: {
        inputTokens: num(usage.prompt_tokens),
        outputTokens: num(usage.completion_tokens),
        cachedInputTokens: num(promptDetails.cached_tokens),
        reasoningTokens: num(completionDetails.reasoning_tokens),
        ...(typeof usage.cost === 'number' ? { providerCostUsd: usage.cost } : {}),
      },
    };
  }
}

function supportsJsonMode(kind: ProviderKind) {
  return kind === 'openai' || kind === 'openrouter';
}

export function toOpenAIMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.content };
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.arguments) },
              })),
            }
          : {}),
      };
    }
    return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  });
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return { _raw: raw };
  }
}

function mapFinish(reason: string | undefined, toolCount: number): StopReason {
  if (toolCount > 0 || reason === 'tool_calls') return 'tool_use';
  if (reason === 'stop') return 'end';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  return 'other';
}

/** OpenRouter reports USD per token as strings. */
function parseOpenRouterPricing(p: unknown): ModelPricing | null {
  if (!p || typeof p !== 'object') return null;
  const { prompt, completion } = p as { prompt?: string; completion?: string };
  const input = Number(prompt);
  const output = Number(completion);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return { inputPerMTok: input * 1e6, outputPerMTok: output * 1e6, source: 'provider' };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function factory(kind: ProviderKind, label: string, defaultBaseUrl: string, authKind: 'api_key' | 'none', description: string): ProviderFactory {
  return {
    kind,
    label,
    authKind,
    defaultBaseUrl,
    description,
    create: (config, secret, deps) => new OpenAICompatibleAdapter(config, secret, deps, defaultBaseUrl),
  };
}

export const openaiFactory = factory('openai', 'OpenAI', 'https://api.openai.com/v1', 'api_key', 'GPT models via the OpenAI API.');
export const openrouterFactory = factory('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'api_key', 'Hundreds of models behind one key; reports live pricing.');
export const openaiCompatibleFactory = factory('openai_compatible', 'OpenAI-compatible', 'http://localhost:8000/v1', 'api_key', 'Any gateway implementing /v1/chat/completions.');
export const localFactory = factory('local', 'Local server', 'http://localhost:11434/v1', 'none', 'Ollama, LM Studio, vLLM or llama.cpp on this Mac. No key, no network egress.');
