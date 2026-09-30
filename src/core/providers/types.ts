/**
 * Provider abstraction. Everything above this layer (agents, tables, workflows, UI)
 * talks to models exclusively through these types — never through a vendor SDK.
 */

export type ProviderKind =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'openrouter'
  | 'openai_compatible'
  | 'local'
  | 'mock';

/**
 * How a provider authenticates. `subscription` providers (consumer plans that authenticate
 * via OAuth rather than a metered key) are modelled explicitly so the UI can distinguish them,
 * even where PIXEL does not yet implement the flow.
 */
export type AuthKind = 'api_key' | 'none' | 'subscription';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl?: string | null;
  authKind: AuthKind;
  enabled: boolean;
  /** Non-secret provider options (e.g. mock persona, org id). Never holds credentials. */
  options: Record<string, unknown>;
  createdAt: number;
}

export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  jsonMode: boolean;
  streaming: boolean;
  reasoning: boolean;
}

export type PricingSource = 'catalog' | 'provider' | 'user' | 'mock';

/** USD per million tokens. */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cachedInputPerMTok?: number;
  cacheWritePerMTok?: number;
  source: PricingSource;
}

export interface ModelInfo {
  /** Model id as the provider knows it. */
  id: string;
  providerId: string;
  displayName: string;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  capabilities: ModelCapabilities;
  /** null means pricing is unknown — never guessed. */
  pricing: ModelPricing | null;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: ToolCallRequest[];
      /** Opaque provider-native turn content, echoed back unchanged to the same adapter only. */
      providerPayload?: unknown;
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export interface CompletionRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Ask for a single JSON object response; `name` identifies the output contract. */
  responseFormat?: { type: 'json'; name: string };
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** Cost reported by the provider itself, when available (e.g. OpenRouter). */
  providerCostUsd?: number;
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface CompletionResponse {
  text: string;
  toolCalls: ToolCallRequest[];
  stopReason: StopReason;
  usage: TokenUsage;
  /** Model id the provider reports having served. */
  model: string;
  /** Opaque provider-native content for multi-turn continuity. Never persisted or shown. */
  providerPayload?: unknown;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
}

export interface ProviderAdapter {
  readonly config: ProviderConfig;
  testConnection(signal?: AbortSignal): Promise<ConnectionTestResult>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

export type FetchLike = typeof fetch;

export interface ProviderDeps {
  fetch: FetchLike;
  /** Scales simulated latency of offline demo providers (0 = instant). Ignored by real providers. */
  latencyScale?: number;
}

/** A provider family PIXEL knows how to talk to. Registered once, instantiated per configured provider. */
export interface ProviderFactory {
  kind: ProviderKind;
  label: string;
  authKind: AuthKind;
  defaultBaseUrl?: string;
  description: string;
  create(config: ProviderConfig, secret: string | undefined, deps: ProviderDeps): ProviderAdapter;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
