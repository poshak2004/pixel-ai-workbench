import Anthropic from '@anthropic-ai/sdk';
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
} from '../types';
import { ProviderError } from '../types';

type MessageParam = Anthropic.MessageParam;
type ContentBlockParam = Anthropic.ContentBlockParam;

export const DEFAULT_ANTHROPIC_MAX_TOKENS = 16000;

export class AnthropicAdapter implements ProviderAdapter {
  private readonly client: Anthropic;

  constructor(
    readonly config: ProviderConfig,
    secret: string | undefined,
    deps: ProviderDeps,
  ) {
    if (!secret) throw new ProviderError('Anthropic requires an API key', config.id);
    this.client = new Anthropic({
      apiKey: secret,
      baseURL: config.baseUrl ?? undefined,
      fetch: deps.fetch,
      maxRetries: 2,
    });
  }

  async testConnection(signal?: AbortSignal) {
    const started = Date.now();
    try {
      await this.client.models.list({ limit: 1 }, { signal });
      return { ok: true, message: 'Authenticated', latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, message: describeError(err), latencyMs: Date.now() - started };
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    for await (const m of this.client.models.list({ limit: 100 }, { signal })) {
      const meta = enrichFromCatalog('anthropic', m.id);
      models.push({
        id: m.id,
        providerId: this.config.id,
        displayName: m.display_name,
        contextWindow: m.max_input_tokens ?? meta.contextWindow ?? null,
        maxOutputTokens: m.max_tokens ?? meta.maxOutputTokens ?? null,
        capabilities: meta.capabilities,
        pricing: meta.pricing,
      });
    }
    return models;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const response = await this.client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
          system: request.system,
          messages: toAnthropicMessages(request.messages),
          ...(request.tools?.length
            ? {
                tools: request.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
                })),
              }
            : {}),
        },
        { signal: request.signal },
      );
      let text = '';
      const toolCalls = [];
      for (const block of response.content) {
        if (block.type === 'text') text += block.text;
        else if (block.type === 'tool_use') {
          toolCalls.push({ id: block.id, name: block.name, arguments: (block.input ?? {}) as Record<string, unknown> });
        }
      }
      const usage = response.usage;
      return {
        text,
        toolCalls,
        stopReason: mapStop(response.stop_reason),
        model: response.model,
        usage: {
          inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens,
          cachedInputTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        },
        // Echoed back verbatim on the next turn so thinking/tool blocks stay intact.
        providerPayload: response.content,
      };
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        const retryable = err.status === 429 || (err.status ?? 0) >= 500;
        throw new ProviderError(describeError(err), this.config.id, err.status, retryable);
      }
      throw err;
    }
  }
}

function mapStop(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

/** Convert provider-neutral history; consecutive tool results collapse into one user turn. */
export function toAnthropicMessages(messages: ChatMessage[]): MessageParam[] {
  const out: MessageParam[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      if (Array.isArray(msg.providerPayload)) {
        out.push({ role: 'assistant', content: msg.providerPayload as ContentBlockParam[] });
        continue;
      }
      const content: ContentBlockParam[] = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const call of msg.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      out.push({ role: 'assistant', content });
    } else {
      const block: ContentBlockParam = {
        type: 'tool_result',
        tool_use_id: msg.toolCallId,
        content: msg.content,
        ...(msg.isError ? { is_error: true } : {}),
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as ContentBlockParam[]).push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    }
  }
  return out;
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) return 'Invalid API key';
    if (err.status === 429) return 'Rate limited';
    return `Anthropic API error ${err.status ?? ''}: ${err.message}`.trim();
  }
  return err instanceof Error ? err.message : String(err);
}

export const anthropicFactory: ProviderFactory = {
  kind: 'anthropic',
  label: 'Anthropic',
  authKind: 'api_key',
  defaultBaseUrl: 'https://api.anthropic.com',
  description: 'Claude models via the Anthropic Messages API.',
  create: (config, secret, deps) => new AnthropicAdapter(config, secret, deps),
};
