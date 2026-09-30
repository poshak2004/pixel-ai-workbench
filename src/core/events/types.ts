/** Every observable step of a run is an event. Events are append-only, sequenced and redacted. */
export const RUN_EVENT_TYPES = [
  'run.created',
  'run.started',
  'run.status',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'phase.started',
  'phase.completed',
  'agent.started',
  'agent.context',
  'agent.output',
  'agent.error',
  'model.call',
  'tool.requested',
  'tool.result',
  'governance.decision',
  'judgment.recorded',
  'approval.requested',
  'approval.resolved',
  'artifact.created',
  'constitution.violation',
  'node.started',
  'node.completed',
  'node.failed',
  'node.skipped',
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export interface RunEvent {
  id: string;
  runId: string;
  seq: number;
  ts: number;
  type: RunEventType;
  seatId: string | null;
  payload: Record<string, unknown>;
}

export type Listener<T> = (value: T) => void;

/** Minimal typed pub/sub used to fan run events out to the UI. */
export class EventBus<T> {
  private readonly listeners = new Set<Listener<T>>();

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(value: T): void {
    for (const l of this.listeners) {
      try {
        l(value);
      } catch {
        // A faulty subscriber must never break a run.
      }
    }
  }
}
