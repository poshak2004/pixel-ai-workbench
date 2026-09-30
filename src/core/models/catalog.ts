import type { ModelCapabilities, ModelPricing, ProviderKind } from '../providers/types';

/**
 * Static metadata used to enrich what providers report during discovery.
 * This is *metadata*, not a model list: the selectable models always come from discovery.
 * Pricing here is only used when the provider itself does not report it; unknown stays unknown.
 */
interface CatalogEntry {
  kind: ProviderKind;
  match: (modelId: string) => boolean;
  pricing?: Omit<ModelPricing, 'source'>;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: Partial<ModelCapabilities>;
}

const exact = (id: string) => (m: string) => m === id;

const CATALOG: CatalogEntry[] = [
  // Anthropic first-party list prices (USD / MTok), cached 2026-09.
  { kind: 'anthropic', match: exact('claude-fable-5-1'), pricing: { inputPerMTok: 10, outputPerMTok: 50, cachedInputPerMTok: 0.25 }, contextWindow: 1_000_000, maxOutputTokens: 128_000 },
  { kind: 'anthropic', match: exact('claude-fable-5'), pricing: { inputPerMTok: 10, outputPerMTok: 50 }, contextWindow: 1_000_000, maxOutputTokens: 128_000 },
  { kind: 'anthropic', match: exact('claude-opus-5-5'), pricing: { inputPerMTok: 4, outputPerMTok: 20, cachedInputPerMTok: 0.2 }, contextWindow: 1_000_000, maxOutputTokens: 128_000 },
  { kind: 'anthropic', match: exact('claude-opus-5'), pricing: { inputPerMTok: 5, outputPerMTok: 25 }, contextWindow: 1_000_000, maxOutputTokens: 128_000 },
  { kind: 'anthropic', match: exact('claude-opus-4-8'), pricing: { inputPerMTok: 5, outputPerMTok: 25 }, contextWindow: 1_000_000, maxOutputTokens: 128_000 },
  { kind: 'anthropic', match: exact('claude-opus-4-7'), pricing: { inputPerMTok: 5, outputPerMTok: 25 }, contextWindow: 1_000_000, maxOutputTokens: 128_000 },
  { kind: 'anthropic', match: exact('claude-opus-4-6'), pricing: { inputPerMTok: 5, outputPerMTok: 25 }, contextWindow: 1_000_000, maxOutputTokens: 128_000 },
  { kind: 'anthropic', match: exact('claude-sonnet-5-5'), pricing: { inputPerMTok: 2, outputPerMTok: 10, cachedInputPerMTok: 0.2 }, contextWindow: 1_000_000, maxOutputTokens: 128_000 },
  { kind: 'anthropic', match: exact('claude-sonnet-5'), pricing: { inputPerMTok: 2, outputPerMTok: 10 }, contextWindow: 1_000_000, maxOutputTokens: 128_000 },
  { kind: 'anthropic', match: exact('claude-sonnet-4-6'), pricing: { inputPerMTok: 3, outputPerMTok: 15 }, contextWindow: 1_000_000, maxOutputTokens: 128_000 },
  { kind: 'anthropic', match: exact('claude-haiku-4-5'), pricing: { inputPerMTok: 1, outputPerMTok: 5 }, contextWindow: 200_000, maxOutputTokens: 64_000 },
];

export const DEFAULT_CAPABILITIES: Record<ProviderKind, ModelCapabilities> = {
  anthropic: { tools: true, vision: true, jsonMode: true, streaming: true, reasoning: true },
  openai: { tools: true, vision: true, jsonMode: true, streaming: true, reasoning: false },
  gemini: { tools: true, vision: true, jsonMode: true, streaming: true, reasoning: false },
  openrouter: { tools: true, vision: false, jsonMode: true, streaming: true, reasoning: false },
  openai_compatible: { tools: true, vision: false, jsonMode: false, streaming: true, reasoning: false },
  local: { tools: false, vision: false, jsonMode: false, streaming: true, reasoning: false },
  mock: { tools: true, vision: false, jsonMode: true, streaming: false, reasoning: false },
};

export interface CatalogEnrichment {
  pricing: ModelPricing | null;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities: ModelCapabilities;
}

export function enrichFromCatalog(kind: ProviderKind, modelId: string): CatalogEnrichment {
  // Normalise dated snapshot ids (e.g. "claude-haiku-4-5-20251001") onto their family entry.
  const normalised = modelId.replace(/-\d{8}$/, '');
  const entry = CATALOG.find((e) => e.kind === kind && (e.match(modelId) || e.match(normalised)));
  return {
    pricing: entry?.pricing ? { ...entry.pricing, source: 'catalog' } : null,
    contextWindow: entry?.contextWindow,
    maxOutputTokens: entry?.maxOutputTokens,
    capabilities: { ...DEFAULT_CAPABILITIES[kind], ...entry?.capabilities },
  };
}
