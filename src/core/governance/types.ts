import { z } from 'zod';
import { ActionKindSchema, type ActionKind } from '../roles/types';
import type { PermissionCheck } from '../security/permissions';
import type { Severity } from '../evaluation/contracts';

/** Ordered from least to most restrictive. Combination always takes the most restrictive. */
export const DECISIONS = ['ALLOW', 'RETRY', 'REROUTE', 'WAIT', 'ESCALATE', 'BLOCK'] as const;
export type Decision = (typeof DECISIONS)[number];
export const DecisionSchema = z.enum(DECISIONS);

/** Ordered from highest to lowest precedence. */
export const LAYERS = ['safety', 'system', 'project', 'table', 'role', 'agent', 'task'] as const;
export type Layer = (typeof LAYERS)[number];
export const LayerSchema = z.enum(LAYERS);

export function decisionRank(d: Decision): number {
  return DECISIONS.indexOf(d);
}
export function layerRank(l: Layer): number {
  return LAYERS.indexOf(l);
}

const Scope = z
  .object({ seatIds: z.array(z.string()).optional(), roleIds: z.array(z.string()).optional() })
  .optional();

const base = { id: z.string().min(1), description: z.string().default(''), scope: Scope };

/** Policy rules are data, not code — they can be stored, diffed, hashed and inspected. */
export const RuleSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('enforce_permissions') }),
  z.object({ ...base, type: z.literal('enforce_constitution') }),
  z.object({ ...base, type: z.literal('deny_actions'), actions: z.array(ActionKindSchema).min(1), decision: z.enum(['BLOCK', 'ESCALATE']) }),
  z.object({ ...base, type: z.literal('require_approval'), actions: z.array(ActionKindSchema).min(1) }),
  z.object({ ...base, type: z.literal('protect_paths'), patterns: z.array(z.string()).min(1), actions: z.array(ActionKindSchema).min(1) }),
  z.object({ ...base, type: z.literal('output_retry'), maxAttempts: z.number().int().min(1).max(5) }),
  z.object({ ...base, type: z.literal('min_judge_confidence'), threshold: z.number().min(0).max(1), below: z.enum(['ESCALATE', 'BLOCK']) }),
  z.object({ ...base, type: z.literal('block_on_unresolved') }),
  z.object({ ...base, type: z.literal('escalate_on_unresolved'), atOrAbove: z.enum(['minor', 'major', 'critical']) }),
  z.object({ ...base, type: z.literal('require_judge_evidence'), min: z.number().int().min(1) }),
  z.object({ ...base, type: z.literal('judge_must_approve') }),
  z.object({ ...base, type: z.literal('no_self_judgment') }),
  z.object({ ...base, type: z.literal('min_approval_weight'), threshold: z.number().min(0).max(1) }),
  z.object({ ...base, type: z.literal('require_cross_provider_review') }),
  z.object({ ...base, type: z.literal('budget'), maxCostUsd: z.number().min(0).optional(), maxTokens: z.number().int().min(0).optional() }),
  z.object({ ...base, type: z.literal('human_approval') }),
  z.object({ ...base, type: z.literal('waive'), ruleIds: z.array(z.string()).min(1), justification: z.string().min(1) }),
]);
export type Rule = z.infer<typeof RuleSchema>;
export type RuleType = Rule['type'];

export const PolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  layer: LayerSchema,
  rules: z.array(RuleSchema),
  /** Built-in safety/system policies are immutable from the UI and to agents. */
  locked: z.boolean().default(false),
});
export type Policy = z.infer<typeof PolicySchema>;

export interface UnresolvedChallenge {
  challengeId: string;
  bySeatId: string;
  severity: Severity;
  /** Whether it met the challenger's evidence standard. Unsupported challenges cannot block. */
  supported: boolean;
  /** The challenger's veto threshold. */
  blockAt: 'none' | 'critical' | 'major';
  claim: string;
}

export interface DecisionSummary {
  judgeSeatId: string | null;
  judgeDecision: 'approve' | 'reject' | 'revise' | 'escalate' | null;
  judgeConfidence: number;
  judgeEvidenceCount: number;
  selectedSeatId: string | null;
  unresolved: UnresolvedChallenge[];
  /** Normalised weighted approval of the selected proposal, 0..1. */
  approvalWeight: number;
  authorProviderId: string | null;
  reviewerProviderIds: string[];
  integrityOk: boolean;
  costUsd: number;
  tokens: number;
}

export type GovernedAction =
  | {
      kind: 'tool_call';
      tool: string;
      actionKind: ActionKind;
      seatId: string;
      roleId: string;
      paths: string[];
      permission: PermissionCheck;
      constitution: { allowed: ActionKind[]; forbidden: ActionKind[] };
    }
  | { kind: 'agent_output'; seatId: string; roleId: string; valid: boolean; attempt: number; error?: string }
  | { kind: 'model_call'; seatId: string; roleId: string; runCostUsd: number; runTokens: number }
  | { kind: 'final_decision'; summary: DecisionSummary };

export interface TraceEntry {
  layer: Layer;
  policyId: string;
  ruleId: string;
  ruleType: RuleType;
  outcome: Decision | 'not_applicable' | 'waived';
  message: string;
}

export interface GovernanceVerdict {
  decision: Decision;
  decidingLayer: Layer | null;
  decidingRuleId: string | null;
  reason: string;
  trace: TraceEntry[];
  /** Attempts by lower layers to relax higher-layer governance. Recorded, never honoured. */
  violations: string[];
  policyHash: string;
}
