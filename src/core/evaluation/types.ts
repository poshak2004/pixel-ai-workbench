export type JudgmentKind = 'review' | 'challenge' | 'rebuttal' | 'resolution' | 'adjudication';

/** A structured judgment of one agent by another. Conclusions and evidence only — no hidden reasoning. */
export interface JudgmentRecord {
  id: string;
  runId: string;
  kind: JudgmentKind;
  judgeSeatId: string;
  targetSeatId: string | null;
  /** For challenges/rebuttals/resolutions: the challenge id this refers to. */
  challengeId: string | null;
  claim: string;
  evidence: string[];
  reasoningSummary: string;
  confidence: number | null;
  decision: string;
  severity: string | null;
  providerId: string;
  model: string;
  tokens: number;
  toolCalls: number;
  createdAt: number;
}
