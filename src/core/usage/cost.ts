import type { ModelPricing, TokenUsage } from '../providers/types';

export interface CostEstimate {
  costUsd: number | null;
  source: ModelPricing['source'] | 'provider' | null;
}

/**
 * Cost for one call. Provider-reported cost wins; otherwise estimate from pricing metadata.
 * `inputTokens` is the total prompt size including cached/cache-write tokens.
 */
export function estimateCost(usage: TokenUsage, pricing: ModelPricing | null): CostEstimate {
  if (typeof usage.providerCostUsd === 'number') return { costUsd: usage.providerCostUsd, source: 'provider' };
  if (!pricing) return { costUsd: null, source: null };
  const cached = usage.cachedInputTokens ?? 0;
  const written = usage.cacheWriteTokens ?? 0;
  const fresh = Math.max(0, usage.inputTokens - cached - written);
  const cost =
    fresh * pricing.inputPerMTok +
    cached * (pricing.cachedInputPerMTok ?? pricing.inputPerMTok) +
    written * (pricing.cacheWritePerMTok ?? pricing.inputPerMTok) +
    usage.outputTokens * pricing.outputPerMTok;
  return { costUsd: cost / 1_000_000, source: pricing.source };
}

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  toolCalls: number;
  latencyMs: number;
  costUsd: number;
  /** Calls whose cost could not be determined — surfaced rather than silently counted as $0. */
  unpricedCalls: number;
}

export function emptyTotals(): UsageTotals {
  return { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, toolCalls: 0, latencyMs: 0, costUsd: 0, unpricedCalls: 0 };
}

export function addUsage(
  t: UsageTotals,
  r: { inputTokens: number; outputTokens: number; cachedInputTokens: number; reasoningTokens: number; toolCalls: number; latencyMs: number; costUsd: number | null },
): UsageTotals {
  return {
    calls: t.calls + 1,
    inputTokens: t.inputTokens + r.inputTokens,
    outputTokens: t.outputTokens + r.outputTokens,
    cachedInputTokens: t.cachedInputTokens + r.cachedInputTokens,
    reasoningTokens: t.reasoningTokens + r.reasoningTokens,
    toolCalls: t.toolCalls + r.toolCalls,
    latencyMs: t.latencyMs + r.latencyMs,
    costUsd: t.costUsd + (r.costUsd ?? 0),
    unpricedCalls: t.unpricedCalls + (r.costUsd === null ? 1 : 0),
  };
}
