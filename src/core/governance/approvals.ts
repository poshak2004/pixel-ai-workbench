export type ApprovalKind = 'tool_call' | 'final_decision';

export interface ApprovalRequest {
  runId: string;
  seatId: string | null;
  kind: ApprovalKind;
  title: string;
  reason: string;
  detail: Record<string, unknown>;
}

export interface ApprovalResolution {
  decision: 'approved' | 'denied';
  by: string;
  note?: string;
}

/**
 * Human-in-the-loop gate. The app implementation persists the request and resolves when the user
 * decides in the UI; runs simply await it.
 */
export interface ApprovalGate {
  request(req: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalResolution>;
}

/** Deterministic gate for tests and headless use. */
export class StaticApprovalGate implements ApprovalGate {
  readonly requests: ApprovalRequest[] = [];
  constructor(private readonly decision: 'approved' | 'denied' = 'denied') {}
  async request(req: ApprovalRequest): Promise<ApprovalResolution> {
    this.requests.push(req);
    return { decision: this.decision, by: 'policy:static' };
  }
}
