import type { PricingSource, ProviderKind } from '../providers/types';

export interface UsageRecord {
  id: string;
  runId: string;
  seatId: string | null;
  agentName: string;
  tableId: string | null;
  workflowId: string | null;
  providerId: string;
  providerKind: ProviderKind;
  modelId: string;
  phase: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  toolCalls: number;
  latencyMs: number;
  /** Estimated from pricing metadata; null when pricing is unknown. */
  costUsd: number | null;
  providerCostUsd: number | null;
  pricingSource: PricingSource | null;
  createdAt: number;
}
