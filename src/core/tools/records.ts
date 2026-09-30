import type { Decision } from '../governance/types';
import type { ActionKind } from '../roles/types';

export type ToolCallStatus = 'ok' | 'error' | 'blocked' | 'denied_by_human' | 'pending_approval';

export interface ToolCallRecord {
  id: string;
  runId: string;
  seatId: string;
  tool: string;
  actionKind: ActionKind;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  governanceDecision: Decision;
  resultPreview: string;
  durationMs: number;
  createdAt: number;
}
