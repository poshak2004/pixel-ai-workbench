export type RunKind = 'table' | 'agent' | 'workflow' | 'compare';
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';

export interface RunRecord {
  id: string;
  kind: RunKind;
  projectId: string | null;
  sessionId: string | null;
  tableId: string | null;
  workflowId: string | null;
  parentRunId: string | null;
  title: string;
  task: string;
  status: RunStatus;
  /** Governance-level outcome: approved / blocked / rejected / revise / failed / cancelled. */
  outcome: string | null;
  snapshot: Record<string, unknown>;
  workspacePath: string | null;
  branch: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  seatId: string | null;
  kind: 'tool_call' | 'final_decision';
  title: string;
  reason: string;
  detail: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  resolvedBy: string | null;
  note: string | null;
  createdAt: number;
  resolvedAt: number | null;
}
