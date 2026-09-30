import { describe, expect, it } from 'vitest';
import { AnthropicAdapter, toAnthropicMessages } from './adapters/anthropic';
import { GeminiAdapter, toGeminiContents } from './adapters/gemini';
import { MockAdapter } from './adapters/mock';
import { OpenAICompatibleAdapter, toOpenAIMessages } from './adapters/openai-compatible';
import { ProviderRegistry } from './registry';
import type { ChatMessage, ProviderConfig } from './types';
import { enrichFromCatalog } from '../models/catalog';
import { estimateCost } from '../usage/cost';

const cfg = (kind: ProviderConfig['kind'], over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: `p_${kind}`,
  kind,
  name: kind,
  authKind: 'api_key',
  enabled: true,
  options: {},
  createdAt: 0,
  ...over,
});

type Call = { url: string; init: RequestInit; body: any };
function fakeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const c = { url: String(url), init, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    return handler(c);
  }) as typeof fetch;
  return { f, calls };
}

const HISTORY: ChatMessage[] = [
  { role: 'user', content: 'list files' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'fs_list_dir', arguments: { path: '.' } }, { id: 'c2', name: 'fs_read_file', arguments: { path: 'a' } }] },
  { role: 'tool', toolCallId: 'c1', name: 'fs_list_dir', content: 'file a' },
  { role: 'tool', toolCallId: 'c2', name: 'fs_read_file', content: 'boom', isError: true },
];

describe('provider registry', () => {
  it('registers every initial provider family', () => {
    expect(new ProviderRegistry().list().map((f) => f.kind).sort()).toEqual(['anthropic', 'gemini', 'local', 'mock', 'openai', 'openai_compatible', 'openrouter']);
  });

  it('adding a provider is just registering a factory', () => {
    const r = new ProviderRegistry([]);
    r.register({ kind: 'mock', label: 'X', authKind: 'none', description: '', create: (c) => new MockAdapter(c, { fetch }) });
    expect(r.get('mock').label).toBe('X');
    expect(() => r.get('openai')).toThrow();
  });

  it('api-key providers refuse to construct without a key', () => {
    const { f } = fakeFetch(() => new Response('{}'));
    expect(() => new OpenAICompatibleAdapter(cfg('openai'), undefined, { fetch: f }, 'https://x')).toThrow(/API key/);
    expect(() => new GeminiAdapter(cfg('gemini'), undefined, { fetch: f })).toThrow(/API key/);
    expect(() => new AnthropicAdapter(cfg('anthropic'), undefined, { fetch: f })).toThrow(/API key/);
    expect(() => new OpenAICompatibleAdapter(cfg('local', { authKind: 'none' }), undefined, { fetch: f }, 'http://localhost:11434/v1')).not.toThrow();
  });
});

describe('OpenAI-compatible adapter', () => {
  it('maps tool calls, usage and cost; sends bearer auth', async () => {
    const { f, calls } = fakeFetch(() =>
      Response.json({
        model: 'gpt-x',
        choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'fs_list_dir', arguments: '{"path":"."}' } }] } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 } },
      }),
    );
    const a = new OpenAICompatibleAdapter(cfg('openai'), 'sk-abcdefghijklmnop', { fetch: f }, 'https://api.openai.com/v1');
    const r = await a.complete({ model: 'gpt-x', system: 'SYS', messages: HISTORY, tools: [{ name: 'fs_list_dir', description: 'd', inputSchema: { type: 'object' } }], maxTokens: 100 });
    expect(r.stopReason).toBe('tool_use');
    expect(r.toolCalls).toEqual([{ id: 't1', name: 'fs_list_dir', arguments: { path: '.' } }]);
    expect(r.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 40, reasoningTokens: 5 });
    const c = calls[0]!;
    expect(c.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(new Headers(c.init.headers).get('authorization')).toBe('Bearer sk-abcdefghijklmnop');
    expect(c.body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(c.body.max_completion_tokens).toBe(100);
    expect(c.body.tools[0].function.name).toBe('fs_list_dir');
  });

  it('uses OpenRouter-reported pricing and cost', async () => {
    const { f } = fakeFetch((c) =>
      c.url.endsWith('/models')
        ? Response.json({ data: [{ id: 'meta/llama', name: 'Llama', context_length: 8192, pricing: { prompt: '0.000001', completion: '0.000002' } }] })
        : Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0042 } }),
    );
    const a = new OpenAICompatibleAdapter(cfg('openrouter'), 'sk-or-v1-abcdefghijklmnopqrst', { fetch: f }, 'https://openrouter.ai/api/v1');
    const [m] = await a.listModels();
    expect(m!.pricing).toEqual({ inputPerMTok: 1, outputPerMTok: 2, source: 'provider' });
    expect(m!.contextWindow).toBe(8192);
    const r = await a.complete({ model: 'meta/llama', system: '', messages: [{ role: 'user', content: 'x' }], responseFormat: { type: 'json', name: 'proposal' } });
    expect(estimateCost(r.usage, m!.pricing).costUsd).toBe(0.0042);
  });

  it('surfaces 401 as invalid key and 5xx as retryable', async () => {
    const a401 = new OpenAICompatibleAdapter(cfg('openai'), 'sk-abcdefghijklmnop', { fetch: fakeFetch(() => new Response('', { status: 401 })).f }, 'https://x');
    await expect(a401.complete({ model: 'm', system: '', messages: [] })).rejects.toMatchObject({ message: 'Invalid API key', retryable: false });
    const a503 = new OpenAICompatibleAdapter(cfg('openai'), 'sk-abcdefghijklmnop', { fetch: fakeFetch(() => new Response('', { status: 503 })).f }, 'https://x');
    await expect(a503.complete({ model: 'm', system: '', messages: [] })).rejects.toMatchObject({ retryable: true });
    expect((await a401.testConnection()).ok).toBe(false);
  });

  it('converts neutral history into OpenAI messages', () => {
    const m = toOpenAIMessages(HISTORY);
    expect(m[1]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'c1' }, { id: 'c2' }] });
    expect(m[3]).toEqual({ role: 'tool', tool_call_id: 'c2', content: 'boom' });
  });
});

describe('Anthropic adapter (official SDK, injected fetch)', () => {
  it('sends x-api-key, maps tool_use and cache usage, preserves provider payload', async () => {
    const { f, calls } = fakeFetch(() =>
      Response.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [
          { type: 'text', text: 'Looking.' },
          { type: 'tool_use', id: 'tu_1', name: 'fs_list_dir', input: { path: '.' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
      }),
    );
    const a = new AnthropicAdapter(cfg('anthropic'), 'sk-ant-test-abcdefghijklmnopqrstuvwxyz', { fetch: f });
    const r = await a.complete({ model: 'claude-opus-5-5', system: 'SYS', messages: HISTORY, tools: [{ name: 'fs_list_dir', description: 'd', inputSchema: { type: 'object', properties: {} } }] });
    expect(r.stopReason).toBe('tool_use');
    expect(r.toolCalls).toEqual([{ id: 'tu_1', name: 'fs_list_dir', arguments: { path: '.' } }]);
    expect(r.usage).toMatchObject({ inputTokens: 150, outputTokens: 10, cachedInputTokens: 100 });
    expect(Array.isArray(r.providerPayload)).toBe(true);
    const c = calls[0]!;
    expect(c.url).toMatch(/\/v1\/messages$/);
    expect(new Headers(c.init.headers).get('x-api-key')).toBe('sk-ant-test-abcdefghijklmnopqrstuvwxyz');
    expect(c.body.system).toBe('SYS');
    expect(c.body.temperature).toBeUndefined();
    expect(c.body.tools[0].input_schema).toEqual({ type: 'object', properties: {} });
    // Parallel tool results are returned in ONE user message.
    expect(c.body.messages).toHaveLength(3);
    expect(c.body.messages[2].content.map((b: { type: string }) => b.type)).toEqual(['tool_result', 'tool_result']);
    expect(c.body.messages[2].content[1].is_error).toBe(true);
  });

  it('echoes provider payload back verbatim on the next turn', () => {
    const blocks = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'x', name: 'n', input: {} }];
    const out = toAnthropicMessages([{ role: 'user', content: 'u' }, { role: 'assistant', content: '', providerPayload: blocks }]);
    expect(out[1]!.content).toBe(blocks);
  });

  it('discovers models with context windows and catalog pricing', async () => {
    const { f } = fakeFetch(() => Response.json({ data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z', max_input_tokens: 1000000, max_tokens: 128000 }], has_more: false, first_id: 'a', last_id: 'a' }));
    const a = new AnthropicAdapter(cfg('anthropic'), 'sk-ant-test-abcdefghijklmnopqrstuvwxyz', { fetch: f });
    const [m] = await a.listModels();
    expect(m).toMatchObject({ id: 'claude-opus-5-5', contextWindow: 1_000_000, pricing: { inputPerMTok: 4, outputPerMTok: 20, source: 'catalog' } });
  });
});

describe('Gemini adapter', () => {
  it('maps function calls and usage; uses header auth, not query string', async () => {
    const { f, calls } = fakeFetch(() =>
      Response.json({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'fs_list_dir', args: { path: '.' } } }] } }],
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 5, thoughtsTokenCount: 7 },
      }),
    );
    const a = new GeminiAdapter(cfg('gemini'), 'AIzaSyTESTKEY1234567890abcdefghijklmn', { fetch: f });
    const r = await a.complete({ model: 'gemini-x', system: 'SYS', messages: HISTORY, tools: [{ name: 'fs_list_dir', description: '', inputSchema: { type: 'object', additionalProperties: false } }] });
    expect(r.stopReason).toBe('tool_use');
    expect(r.toolCalls[0]!.name).toBe('fs_list_dir');
    expect(r.usage).toMatchObject({ inputTokens: 30, outputTokens: 12, reasoningTokens: 7 });
    expect(calls[0]!.url).not.toContain('key=');
    expect(new Headers(calls[0]!.init.headers).get('x-goog-api-key')).toBe('AIzaSyTESTKEY1234567890abcdefghijklmn');
    expect(calls[0]!.body.tools[0].functionDeclarations[0].parameters.additionalProperties).toBeUndefined();
  });

  it('merges consecutive same-role turns', () => {
    const c = toGeminiContents(HISTORY);
    expect(c.map((x) => x.role)).toEqual(['user', 'model', 'user']);
    expect(c[2]!.parts).toHaveLength(2);
  });
});

describe('catalog & mock', () => {
  it('normalises dated snapshots and leaves unknown pricing unknown', () => {
    expect(enrichFromCatalog('anthropic', 'claude-haiku-4-5-20251001').pricing?.inputPerMTok).toBe(1);
    expect(enrichFromCatalog('openai', 'gpt-something').pricing).toBeNull();
  });

  it('mock provider rejects models it does not serve', async () => {
    const a = new MockAdapter(cfg('mock', { options: { persona: 'cirrus', latencyScale: 0 } }), { fetch });
    await expect(a.complete({ model: 'atlas-large', system: '', messages: [] })).rejects.toThrow(/not served/);
    expect((await a.listModels()).map((m) => m.id)).toEqual(['cirrus-7b-local']);
  });
});
