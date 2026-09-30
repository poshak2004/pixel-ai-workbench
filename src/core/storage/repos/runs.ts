import { and, asc, desc, eq, gt, gte, inArray } from 'drizzle-orm';
import type { ArtifactRecord } from '../../artifacts/types';
import type { JudgmentRecord, JudgmentKind } from '../../evaluation/types';
import type { RunEvent, RunEventType } from '../../events/types';
import type { ProviderKind, PricingSource } from '../../providers/types';
import type { Authority } from '../../roles/types';
import type { JournalStore } from '../../runs/journal';
import type { ApprovalRecord, RunKind, RunRecord, RunStatus } from '../../runs/types';
import type { ToolCallRecord, ToolCallStatus } from '../../tools/records';
import type { UsageRecord } from '../../usage/types';
import type { Decision } from '../../governance/types';
import type { ActionKind } from '../../roles/types';
import type { ArtifactKind } from '../../artifacts/types';
import type { PixelDb } from '../db';
import { agentSeats, approvals, artifacts, judgments, runEvents, runs, toolCalls, usageRecords } from '../schema';

export interface SeatInstance {
  runId: string;
  seatId: string;
  name: string;
  roleId: string;
  providerId: string;
  modelId: string;
  constitutionHash: string;
  authority: Authority;
}

/** Persistence for runs and everything journaled about them. Implements the journal's store port. */
export class RunsRepo implements JournalStore {
  constructor(private readonly db: PixelDb) {}

  // ── runs ──
  async create(run: RunRecord): Promise<void> {
    await this.db.insert(runs).values({ ...run, lastSeq: 0 });
  }

  async update(id: string, patch: Partial<Pick<RunRecord, 'status' | 'outcome' | 'error' | 'startedAt' | 'finishedAt' | 'workspacePath' | 'branch'>>): Promise<void> {
    await this.db.update(runs).set(patch).where(eq(runs.id, id));
  }

  async get(id: string): Promise<RunRecord | null> {
    const [r] = await this.db.select().from(runs).where(eq(runs.id, id));
    return r ? toRun(r) : null;
  }

  async list(opts: { projectId?: string; limit?: number } = {}): Promise<RunRecord[]> {
    const q = this.db.select().from(runs);
    const rows = await (opts.projectId ? q.where(eq(runs.projectId, opts.projectId)) : q).orderBy(desc(runs.createdAt)).limit(opts.limit ?? 200);
    return rows.map(toRun);
  }

  async listByStatus(statuses: RunStatus[]): Promise<RunRecord[]> {
    const rows = await this.db.select().from(runs).where(inArray(runs.status, statuses));
    return rows.map(toRun);
  }

  async addSeats(seats: SeatInstance[]): Promise<void> {
    if (!seats.length) return;
    await this.db.insert(agentSeats).values(seats.map((s) => ({ id: `${s.runId}:${s.seatId}`, ...s })));
  }

  async seats(runId: string): Promise<SeatInstance[]> {
    const rows = await this.db.select().from(agentSeats).where(eq(agentSeats.runId, runId));
    return rows.map(({ id: _id, ...rest }) => rest);
  }

  // ── journal store ──
  async appendEvent(e: RunEvent): Promise<void> {
    await this.db.insert(runEvents).values(e);
  }

  async addJudgment(j: JudgmentRecord): Promise<void> {
    await this.db.insert(judgments).values(j);
  }

  async addUsage(u: UsageRecord): Promise<void> {
    await this.db.insert(usageRecords).values(u);
  }

  async addToolCall(t: ToolCallRecord): Promise<void> {
    await this.db.insert(toolCalls).values(t);
  }

  async addArtifact(a: ArtifactRecord): Promise<void> {
    await this.db.insert(artifacts).values(a);
  }

  // ── reads ──
  async maxSeq(runId: string): Promise<number> {
    const [row] = await this.db.select({ seq: runEvents.seq }).from(runEvents).where(eq(runEvents.runId, runId)).orderBy(desc(runEvents.seq)).limit(1);
    return row?.seq ?? 0;
  }

  async events(runId: string, afterSeq = 0): Promise<RunEvent[]> {
    const rows = await this.db.select().from(runEvents).where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq))).orderBy(asc(runEvents.seq));
    return rows.map((r) => ({ ...r, type: r.type as RunEventType }));
  }

  async judgments(runId: string): Promise<JudgmentRecord[]> {
    const rows = await this.db.select().from(judgments).where(eq(judgments.runId, runId)).orderBy(asc(judgments.createdAt));
    return rows.map((r) => ({ ...r, kind: r.kind as JudgmentKind }));
  }

  async usage(filter: { runId?: string; since?: number } = {}): Promise<UsageRecord[]> {
    const conds = [filter.runId ? eq(usageRecords.runId, filter.runId) : undefined, filter.since ? gte(usageRecords.createdAt, filter.since) : undefined].filter(Boolean);
    const q = this.db.select().from(usageRecords);
    const rows = await (conds.length ? q.where(and(...conds)) : q).orderBy(asc(usageRecords.createdAt));
    return rows.map((r) => ({ ...r, providerKind: r.providerKind as ProviderKind, pricingSource: r.pricingSource as PricingSource | null }));
  }

  async toolCalls(runId: string): Promise<ToolCallRecord[]> {
    const rows = await this.db.select().from(toolCalls).where(eq(toolCalls.runId, runId)).orderBy(asc(toolCalls.createdAt));
    return rows.map((r) => ({ ...r, actionKind: r.actionKind as ActionKind, status: r.status as ToolCallStatus, governanceDecision: r.governanceDecision as Decision }));
  }

  async artifacts(runId: string): Promise<ArtifactRecord[]> {
    const rows = await this.db.select().from(artifacts).where(eq(artifacts.runId, runId)).orderBy(asc(artifacts.createdAt));
    return rows.map((r) => ({ ...r, kind: r.kind as ArtifactKind }));
  }

  // ── approvals ──
  async createApproval(a: ApprovalRecord): Promise<void> {
    await this.db.insert(approvals).values(a);
  }

  async resolveApproval(id: string, patch: Pick<ApprovalRecord, 'status' | 'resolvedBy' | 'note' | 'resolvedAt'>): Promise<void> {
    await this.db.update(approvals).set(patch).where(eq(approvals.id, id));
  }

  async approvals(filter: { runId?: string; status?: ApprovalRecord['status'] } = {}): Promise<ApprovalRecord[]> {
    const conds = [filter.runId ? eq(approvals.runId, filter.runId) : undefined, filter.status ? eq(approvals.status, filter.status) : undefined].filter(Boolean);
    const q = this.db.select().from(approvals);
    const rows = await (conds.length ? q.where(and(...conds)) : q).orderBy(asc(approvals.createdAt));
    return rows.map((r) => ({ ...r, kind: r.kind as ApprovalRecord['kind'], status: r.status as ApprovalRecord['status'] }));
  }
}

function toRun(r: typeof runs.$inferSelect): RunRecord {
  const { lastSeq: _lastSeq, ...rest } = r;
  return { ...rest, kind: r.kind as RunKind, status: r.status as RunStatus };
}
