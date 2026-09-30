import { z } from 'zod';
import { AgentSpecSchema } from '../agents/types';
import { AuthoritySchema } from '../roles/types';
import { RuleSchema } from '../governance/types';

/** A seat embeds a full agent spec so a table is self-contained and reproducible. */
export const SeatSchema = z.object({
  id: z.string().min(1),
  order: z.number().int(),
  spec: AgentSpecSchema,
  /**
   * Optional per-seat authority adjustments (e.g. weight). Merged over the role's authority;
   * a seat can never gain judge/veto powers its role does not grant.
   */
  authority: AuthoritySchema.partial().optional(),
  /** Agent template this seat was created from, if any (informational). */
  sourceAgentId: z.string().nullable().optional(),
});
export type Seat = z.infer<typeof SeatSchema>;

export const EVALUATION_STRATEGIES = ['judge_arbitration', 'weighted_authority', 'consensus', 'human_approval'] as const;

export const ProtocolSchema = z.object({
  critique: z.boolean().default(true),
  rebuttal: z.boolean().default(true),
  /** Reviewers see proposals but never each other's reviews (prevents herding). */
  blindReviews: z.boolean().default(true),
  /** Require at least one reviewer on a different provider than the selected author. */
  requireCrossProviderReview: z.boolean().default(false),
  evaluation: z.enum(EVALUATION_STRATEGIES).default('judge_arbitration'),
  /** Used by weighted_authority / consensus. */
  approvalThreshold: z.number().min(0).max(1).default(0.5),
  maxConcurrency: z.number().int().min(1).max(16).default(4),
});
export type Protocol = z.infer<typeof ProtocolSchema>;

export const TableSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  description: z.string().default(''),
  projectId: z.string().nullable(),
  seats: z.array(SeatSchema),
  protocol: ProtocolSchema,
  /** Table-constitution rules (governance layer "table"). */
  rules: z.array(RuleSchema).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Table = z.infer<typeof TableSchema>;
export type TableInput = Omit<Table, 'id' | 'createdAt' | 'updatedAt'>;
