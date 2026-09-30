import { z } from 'zod';

/** Categories of side-effecting action an agent may attempt. Tools map onto these. */
export const ACTION_KINDS = [
  'fs.read',
  'fs.write',
  'shell.exec',
  'git.read',
  'git.write',
  'browser.use',
  'network.request',
  'mac.control',
  'mcp.call',
] as const;
export const ActionKindSchema = z.enum(ACTION_KINDS);
export type ActionKind = z.infer<typeof ActionKindSchema>;

/** Which output contract a role produces in each deliberation phase. */
export const OUTPUT_SCHEMAS = ['proposal', 'review', 'rebuttal', 'resolution', 'adjudication'] as const;
export const OutputSchemaNameSchema = z.enum(OUTPUT_SCHEMAS);
export type OutputSchemaName = z.infer<typeof OutputSchemaNameSchema>;

export const AuthoritySchema = z.object({
  /** May submit independent work in the proposal phase. */
  canPropose: z.boolean(),
  /** May review other seats' work. */
  canCritique: z.boolean(),
  /** May adjudicate the final decision. */
  canJudge: z.boolean(),
  /**
   * Veto power: unresolved challenges from this seat at or above this severity block execution.
   * 'none' means the seat can object but never block.
   */
  blockAt: z.enum(['none', 'critical', 'major']),
  /** Explicit weight used by weighted-authority evaluation. Inspectable, never implicit. */
  weight: z.number().min(0).max(10),
});
export type Authority = z.infer<typeof AuthoritySchema>;

export const EvidenceStandardSchema = z.object({
  /** Major/critical challenges without cited evidence are recorded as unsupported and cannot block. */
  challengesRequireEvidence: z.boolean(),
  /** Approvals without independently cited evidence are downgraded to abstentions. */
  approvalsRequireEvidence: z.boolean(),
  /** Minimum evidence items for a proposal to be considered supported. */
  minProposalEvidence: z.number().int().min(0),
});
export type EvidenceStandard = z.infer<typeof EvidenceStandardSchema>;

/**
 * A role constitution. Free-text rules are rendered into the model context; the structured
 * fields (allowed/forbidden actions, evidence standard, authority) are enforced deterministically
 * by PIXEL regardless of what the model outputs.
 */
export const ConstitutionSchema = z.object({
  mission: z.string().min(1),
  responsibilities: z.array(z.string()),
  allowedActions: z.array(ActionKindSchema),
  forbiddenActions: z.array(ActionKindSchema),
  evidenceStandard: EvidenceStandardSchema,
  challengeRules: z.array(z.string()),
  decisionRules: z.array(z.string()),
  escalationRules: z.array(z.string()),
  outputSchema: OutputSchemaNameSchema,
  authority: AuthoritySchema,
});
export type Constitution = z.infer<typeof ConstitutionSchema>;

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string(),
  constitution: ConstitutionSchema,
  builtIn: z.boolean(),
  version: z.number().int().min(1),
});
export type Role = z.infer<typeof RoleSchema>;
