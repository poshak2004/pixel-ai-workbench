import { EventBus } from '../events/types';
import type { RunsRepo } from '../storage/repos/runs';
import type { ApprovalRecord } from '../runs/types';
import type { Clock, IdGenerator } from '../util/runtime';
import { AbortError } from '../util/runtime';
import type { ApprovalGate, ApprovalRequest, ApprovalResolution } from './approvals';

/**
 * Durable human-approval gate. Requests are persisted and surfaced in the UI; the waiting run
 * resumes when a human resolves them. On restart, stale pending approvals are expired.
 */
export class ApprovalService implements ApprovalGate {
  private readonly waiters = new Map<string, (r: ApprovalResolution) => void>();
  readonly changes = new EventBus<ApprovalRecord>();

  constructor(
    private readonly repo: RunsRepo,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async request(req: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalResolution> {
    const record: ApprovalRecord = {
      id: this.ids.next('apr'),
      runId: req.runId,
      seatId: req.seatId,
      kind: req.kind,
      title: req.title,
      reason: req.reason,
      detail: req.detail,
      status: 'pending',
      resolvedBy: null,
      note: null,
      createdAt: this.clock.now(),
      resolvedAt: null,
    };
    await this.repo.createApproval(record);
    this.changes.publish(record);
    return new Promise<ApprovalResolution>((resolve, reject) => {
      this.waiters.set(record.id, resolve);
      signal?.addEventListener(
        'abort',
        () => {
          this.waiters.delete(record.id);
          void this.repo.resolveApproval(record.id, { status: 'expired', resolvedBy: 'system', note: 'Run cancelled', resolvedAt: this.clock.now() });
          reject(new AbortError());
        },
        { once: true },
      );
    });
  }

  async resolve(id: string, decision: 'approved' | 'denied', note?: string): Promise<void> {
    const [pending] = (await this.repo.approvals({ status: 'pending' })).filter((a) => a.id === id);
    if (!pending) throw new Error('Approval not found or already resolved');
    const patch = { status: decision, resolvedBy: 'user', note: note ?? null, resolvedAt: this.clock.now() } as const;
    await this.repo.resolveApproval(id, patch);
    this.changes.publish({ ...pending, ...patch });
    const waiter = this.waiters.get(id);
    this.waiters.delete(id);
    waiter?.({ decision, by: 'user', note });
  }

  pending(): Promise<ApprovalRecord[]> {
    return this.repo.approvals({ status: 'pending' });
  }

  /** Called at startup: nothing can be waiting on approvals from a previous process. */
  async expireOrphans(): Promise<number> {
    const stale = (await this.repo.approvals({ status: 'pending' })).filter((a) => !this.waiters.has(a.id));
    for (const a of stale) await this.repo.resolveApproval(a.id, { status: 'expired', resolvedBy: 'system', note: 'PIXEL restarted', resolvedAt: this.clock.now() });
    return stale.length;
  }
}
