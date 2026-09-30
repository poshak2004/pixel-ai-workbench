import { z } from 'zod';
import type { OutputSchemaName } from '../roles/types';

/**
 * Structured output contracts for each deliberation phase. PIXEL stores these structured
 * conclusions and their evidence — never hidden chain-of-thought.
 */

const Confidence = z.coerce.number().min(0).max(1);
const Evidence = z.object({ source: z.string().min(1), detail: z.string().min(1) });
export type EvidenceItem = z.infer<typeof Evidence>;

export const ProposalSchema = z.object({
  summary: z.string().min(1),
  approach: z.string().min(1),
  steps: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  risks: z.array(z.object({ risk: z.string(), mitigation: z.string().default('') })).default([]),
  evidence: z.array(Evidence).default([]),
  confidence: Confidence,
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const SEVERITIES = ['info', 'minor', 'major', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ReviewSchema = z.object({
  reviews: z
    .array(
      z.object({
        targetSeatId: z.string().min(1),
        verdict: z.enum(['approve', 'reject', 'abstain', 'request_evidence']),
        summary: z.string().default(''),
        confidence: Confidence,
        evidence: z.array(Evidence).default([]),
        challenges: z
          .array(
            z.object({
              claim: z.string().min(1),
              severity: z.enum(SEVERITIES),
              evidence: z.array(z.string()).default([]),
              question: z.string().optional(),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
});
export type ReviewOutput = z.infer<typeof ReviewSchema>;

export const RebuttalSchema = z.object({
  responses: z.array(
    z.object({
      challengeId: z.string().min(1),
      stance: z.enum(['concede', 'dispute', 'mitigate']),
      response: z.string().min(1),
      evidence: z.array(z.string()).default([]),
    }),
  ),
});
export type RebuttalOutput = z.infer<typeof RebuttalSchema>;

export const ResolutionSchema = z.object({
  resolutions: z.array(
    z.object({
      challengeId: z.string().min(1),
      outcome: z.enum(['resolved', 'unresolved', 'escalate']),
      reason: z.string().min(1),
    }),
  ),
});
export type ResolutionOutput = z.infer<typeof ResolutionSchema>;

export const AdjudicationSchema = z.object({
  decision: z.enum(['approve', 'reject', 'revise', 'escalate']),
  selectedSeatId: z.string().nullable().default(null),
  rationale: z.string().min(1),
  findings: z
    .array(
      z.object({
        claim: z.string().min(1),
        assessment: z.enum(['supported', 'unsupported', 'contested']),
        note: z.string().default(''),
      }),
    )
    .default([]),
  evidence: z.array(Evidence).default([]),
  confidence: Confidence,
  finalAnswer: z.string().min(1),
});
export type Adjudication = z.infer<typeof AdjudicationSchema>;

export const CONTRACTS = {
  proposal: ProposalSchema,
  review: ReviewSchema,
  rebuttal: RebuttalSchema,
  resolution: ResolutionSchema,
  adjudication: AdjudicationSchema,
} satisfies Record<OutputSchemaName, z.ZodTypeAny>;

/** Human/model-readable shape descriptions rendered into the output contract section of the prompt. */
export const CONTRACT_SHAPES: Record<OutputSchemaName, string> = {
  proposal: `{"summary": string, "approach": string, "steps": string[], "assumptions": string[], "risks": [{"risk": string, "mitigation": string}], "evidence": [{"source": string, "detail": string}], "confidence": number 0..1}`,
  review: `{"reviews": [{"targetSeatId": string, "verdict": "approve"|"reject"|"abstain"|"request_evidence", "summary": string, "confidence": number 0..1, "evidence": [{"source": string, "detail": string}], "challenges": [{"claim": string, "severity": "info"|"minor"|"major"|"critical", "evidence": string[], "question"?: string}]}]}`,
  rebuttal: `{"responses": [{"challengeId": string, "stance": "concede"|"dispute"|"mitigate", "response": string, "evidence": string[]}]}`,
  resolution: `{"resolutions": [{"challengeId": string, "outcome": "resolved"|"unresolved"|"escalate", "reason": string}]}`,
  adjudication: `{"decision": "approve"|"reject"|"revise"|"escalate", "selectedSeatId": string|null, "rationale": string, "findings": [{"claim": string, "assessment": "supported"|"unsupported"|"contested", "note": string}], "evidence": [{"source": string, "detail": string}], "confidence": number 0..1, "finalAnswer": string}`,
};
