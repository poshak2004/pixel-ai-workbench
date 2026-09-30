import type { ArtifactRecord } from '../artifacts/types';
import type { JudgmentRecord } from '../evaluation/types';
import type { EventBus, RunEvent, RunEventType } from '../events/types';
import type { SecretRedactor } from '../security/redaction';
import type { ToolCallRecord } from '../tools/records';
import type { UsageRecord } from '../usage/types';
import type { Clock, IdGenerator } from '../util/runtime';

/** Where journal entries are persisted. SQLite in the app; memory in tests. */
export interface JournalStore {
  appendEvent(e: RunEvent): Promise<void>;
  addJudgment(j: JudgmentRecord): Promise<void>;
  addUsage(u: UsageRecord): Promise<void>;
  addToolCall(t: ToolCallRecord): Promise<void>;
  addArtifact(a: ArtifactRecord): Promise<void>;
}

export interface JournalDeps {
  store: JournalStore;
  redactor: SecretRedactor;
  bus?: EventBus<RunEvent>;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * The single write path for everything observable about a run. Redacts before persisting or
 * publishing, sequences events, and serialises writes so persisted order equals emission order.
 */
export class RunJournal {
  private seq: number;
  private chain: Promise<void> = Promise.resolve();
  private failure: Error | null = null;

  constructor(
    readonly runId: string,
    private readonly deps: JournalDeps,
    startSeq = 0,
  ) {
    this.seq = startSeq;
  }

  get ids() {
    return this.deps.ids;
  }
  get clock() {
    return this.deps.clock;
  }

  /** Redact text before it leaves PIXEL's trust boundary (e.g. tool output sent to a model). */
  redact(text: string): string {
    return this.deps.redactor.redactString(text);
  }

  event(type: RunEventType, payload: Record<string, unknown>, seatId: string | null = null): RunEvent {
    const e: RunEvent = {
      id: this.deps.ids.next('evt'),
      runId: this.runId,
      seq: ++this.seq,
      ts: this.deps.clock.now(),
      type,
      seatId,
      payload: this.deps.redactor.redact(payload),
    };
    this.enqueue(() => this.deps.store.appendEvent(e));
    this.deps.bus?.publish(e);
    return e;
  }

  judgment(j: Omit<JudgmentRecord, 'id' | 'runId' | 'createdAt'>): JudgmentRecord {
    const rec: JudgmentRecord = this.deps.redactor.redact({ ...j, id: this.deps.ids.next('jdg'), runId: this.runId, createdAt: this.deps.clock.now() });
    this.enqueue(() => this.deps.store.addJudgment(rec));
    this.event('judgment.recorded', { judgment: rec }, rec.judgeSeatId);
    return rec;
  }

  usage(u: Omit<UsageRecord, 'id' | 'runId' | 'createdAt'>): UsageRecord {
    const rec: UsageRecord = { ...u, id: this.deps.ids.next('use'), runId: this.runId, createdAt: this.deps.clock.now() };
    this.enqueue(() => this.deps.store.addUsage(rec));
    return rec;
  }

  toolCall(t: Omit<ToolCallRecord, 'id' | 'runId' | 'createdAt'>): ToolCallRecord {
    const rec: ToolCallRecord = this.deps.redactor.redact({ ...t, id: this.deps.ids.next('tc'), runId: this.runId, createdAt: this.deps.clock.now() });
    this.enqueue(() => this.deps.store.addToolCall(rec));
    return rec;
  }

  artifact(a: Omit<ArtifactRecord, 'id' | 'runId' | 'createdAt'>): ArtifactRecord {
    const rec: ArtifactRecord = this.deps.redactor.redact({ ...a, id: this.deps.ids.next('art'), runId: this.runId, createdAt: this.deps.clock.now() });
    this.enqueue(() => this.deps.store.addArtifact(rec));
    this.event('artifact.created', { artifactId: rec.id, kind: rec.kind, title: rec.title }, rec.seatId);
    return rec;
  }

  /** Resolves once every queued write has been persisted; rethrows the first persistence failure. */
  async flush(): Promise<void> {
    await this.chain;
    if (this.failure) throw this.failure;
  }

  private enqueue(write: () => Promise<void>) {
    this.chain = this.chain.then(write).catch((err: unknown) => {
      this.failure ??= err instanceof Error ? err : new Error(String(err));
    });
  }
}

export class MemoryJournalStore implements JournalStore {
  events: RunEvent[] = [];
  judgments: JudgmentRecord[] = [];
  usage: UsageRecord[] = [];
  toolCalls: ToolCallRecord[] = [];
  artifacts: ArtifactRecord[] = [];

  async appendEvent(e: RunEvent) {
    this.events.push(e);
  }
  async addJudgment(j: JudgmentRecord) {
    this.judgments.push(j);
  }
  async addUsage(u: UsageRecord) {
    this.usage.push(u);
  }
  async addToolCall(t: ToolCallRecord) {
    this.toolCalls.push(t);
  }
  async addArtifact(a: ArtifactRecord) {
    this.artifacts.push(a);
  }
}
