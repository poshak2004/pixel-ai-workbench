import { useEffect, useMemo, useState } from 'react';
import { subscribe } from './ipc';
import { useQuery } from './store';
import type { RunDetail, RunEvent } from './types';

/** Run detail from the DB, plus events streamed live from main (deduplicated by seq). */
export function useRun(runId: string | null | undefined) {
  const detail = useQuery('runs.detail', { id: runId ?? '' }, { enabled: !!runId });
  const [live, setLive] = useState<RunEvent[]>([]);
  useEffect(() => {
    setLive([]);
    if (!runId) return;
    return subscribe<RunEvent>('run:event', (e) => {
      if (e.runId === runId) setLive((l) => [...l, e]);
    });
  }, [runId]);
  const events = useMemo(() => {
    const byseq = new Map<number, RunEvent>();
    for (const e of detail.data?.events ?? []) byseq.set(e.seq, e);
    for (const e of live) byseq.set(e.seq, e);
    return [...byseq.values()].sort((a, b) => a.seq - b.seq);
  }, [detail.data, live]);
  return { detail: detail.data as RunDetail | null | undefined, events, loading: detail.loading, error: detail.error, reload: detail.reload };
}

export interface SeatLive {
  seatId: string;
  name: string;
  role: string;
  roleId: string;
  providerId: string;
  model: string;
  authority?: { weight: number; blockAt: string; canJudge: boolean; canPropose: boolean; canCritique: boolean };
  status: 'idle' | 'thinking' | 'tool' | 'done' | 'error' | 'waiting';
  phase: string | null;
  lastDecision: string | null;
  confidence: number | null;
  tokens: number;
  latencyMs: number;
  costUsd: number;
  toolCalls: number;
  calls: number;
}

/** Fold the event stream into per-seat live state. Pure. */
export function seatStates(events: RunEvent[]): Map<string, SeatLive> {
  const seats = new Map<string, SeatLive>();
  const started = events.find((e) => e.type === 'run.started');
  for (const s of (started?.payload.seats as Omit<SeatLive, 'status' | 'phase' | 'lastDecision' | 'confidence' | 'tokens' | 'latencyMs' | 'costUsd' | 'toolCalls' | 'calls'>[] | undefined) ?? []) {
    seats.set(s.seatId, { ...s, status: 'idle', phase: null, lastDecision: null, confidence: null, tokens: 0, latencyMs: 0, costUsd: 0, toolCalls: 0, calls: 0 });
  }
  const finished = events.some((e) => e.type === 'run.completed' || e.type === 'run.failed' || e.type === 'run.cancelled');
  for (const e of events) {
    if (e.type === 'run.status' && e.payload.seat) {
      const s = e.payload.seat as SeatLive;
      if (!seats.has(s.seatId)) seats.set(s.seatId, { ...s, status: 'idle', phase: null, lastDecision: null, confidence: null, tokens: 0, latencyMs: 0, costUsd: 0, toolCalls: 0, calls: 0 });
    }
    const s = e.seatId ? seats.get(e.seatId) : undefined;
    if (!s) continue;
    switch (e.type) {
      case 'agent.started':
        s.status = 'thinking';
        s.phase = String(e.payload.phase ?? '');
        break;
      case 'tool.requested':
        s.status = 'tool';
        s.toolCalls++;
        break;
      case 'tool.result':
        s.status = 'thinking';
        break;
      case 'approval.requested':
        s.status = 'waiting';
        break;
      case 'model.call': {
        const u = e.payload.usage as { inputTokens: number; outputTokens: number; latencyMs: number; costUsd: number | null };
        s.tokens += u.inputTokens + u.outputTokens;
        s.latencyMs += u.latencyMs;
        s.costUsd += u.costUsd ?? 0;
        s.calls++;
        break;
      }
      case 'agent.output': {
        s.status = 'done';
        const out = e.payload.output as { confidence?: number; decision?: string; reviews?: { verdict: string; confidence: number }[] };
        if (typeof out?.confidence === 'number') s.confidence = out.confidence;
        if (out?.decision) s.lastDecision = out.decision;
        else if (out?.reviews?.length) {
          s.lastDecision = out.reviews.map((r) => r.verdict).join(' / ');
          s.confidence = out.reviews.reduce((n, r) => n + r.confidence, 0) / out.reviews.length;
        } else s.lastDecision = String(e.payload.contract ?? 'output');
        break;
      }
      case 'judgment.recorded': {
        const j = e.payload.judgment as { kind: string; decision: string; confidence: number | null };
        if (j.kind !== 'challenge') s.lastDecision = j.decision;
        if (j.confidence !== null && j.confidence !== undefined) s.confidence = j.confidence;
        break;
      }
      case 'agent.error':
        if (!e.payload.retrying) s.status = 'error';
        break;
    }
  }
  if (finished) for (const s of seats.values()) if (s.status === 'thinking' || s.status === 'tool' || s.status === 'waiting') s.status = 'done';
  return seats;
}

/** Human-readable one-liner for a timeline row. */
export function describeEvent(e: RunEvent): { actor: string; verb: string; detail: string; tone: 'neutral' | 'sage' | 'blue' | 'lav' | 'peach' | 'verm' | 'amber' } {
  const p = e.payload as Record<string, any>;
  switch (e.type) {
    case 'run.started':
      return { actor: 'RUN', verb: 'started', detail: String(p.task ?? '').slice(0, 140), tone: 'neutral' };
    case 'phase.started':
      return { actor: 'PROTOCOL', verb: `${String(p.phase).toUpperCase()} phase`, detail: `${(p.seats as string[] | undefined)?.length ?? 0} seat(s)`, tone: 'neutral' };
    case 'phase.completed':
      return { actor: 'PROTOCOL', verb: `${String(p.phase).toUpperCase()} done`, detail: '', tone: 'neutral' };
    case 'agent.started':
      return { actor: e.seatId ?? '', verb: `thinking · ${p.phase}`, detail: `${p.model}`, tone: 'blue' };
    case 'agent.context':
      return { actor: e.seatId ?? '', verb: 'received context', detail: `${p.manifest?.totalTokens ?? '?'} tokens · ${p.manifest?.sections?.length ?? 0} sections`, tone: 'neutral' };
    case 'agent.output': {
      const o = p.output ?? {};
      const verb = p.contract === 'proposal' ? 'proposal' : p.contract === 'review' ? 'review' : p.contract === 'rebuttal' ? 'rebuttal' : p.contract === 'resolution' ? 'resolution' : p.contract === 'adjudication' ? 'decision' : String(p.contract);
      const detail = o.summary ?? o.rationale ?? (o.reviews ? o.reviews.map((r: any) => `${r.targetSeatId}: ${r.verdict}`).join(' · ') : o.responses ? `${o.responses.length} response(s)` : o.resolutions ? o.resolutions.map((r: any) => `${r.challengeId}: ${r.outcome}`).join(' · ') : '');
      return { actor: e.seatId ?? '', verb, detail: String(detail), tone: p.contract === 'adjudication' ? 'lav' : 'sage' };
    }
    case 'agent.error':
      return { actor: e.seatId ?? 'RUN', verb: p.retrying ? 'transient error (retrying)' : 'error', detail: String(p.message ?? ''), tone: 'verm' };
    case 'model.call': {
      const u = p.usage ?? {};
      return { actor: e.seatId ?? '', verb: 'model call', detail: `${u.modelId} · ${u.inputTokens}→${u.outputTokens} tok · ${u.latencyMs}ms`, tone: 'neutral' };
    }
    case 'tool.requested':
      return { actor: e.seatId ?? '', verb: `tool · ${p.tool}`, detail: JSON.stringify(p.args ?? {}).slice(0, 120), tone: 'lav' };
    case 'tool.result':
      return { actor: e.seatId ?? '', verb: `tool ${p.status}`, detail: `${p.tool}${p.durationMs !== undefined ? ` · ${p.durationMs}ms` : ''}`, tone: p.status === 'ok' ? 'neutral' : 'verm' };
    case 'governance.decision': {
      const v = p.verdict ?? {};
      return { actor: 'GOVERNOR', verb: `${v.decision}`, detail: `${p.subject === 'final_decision' ? 'final decision' : p.subject}${p.tool ? ` · ${p.tool}` : ''} — ${v.reason ?? ''}`, tone: v.decision === 'ALLOW' ? 'sage' : v.decision === 'BLOCK' ? 'verm' : 'amber' };
    }
    case 'judgment.recorded': {
      const j = p.judgment ?? {};
      const verb = j.kind === 'challenge' ? `challenge (${j.severity})` : j.kind === 'adjudication' ? `judgment: ${j.decision}` : `${j.kind}: ${j.decision}`;
      return { actor: j.judgeSeatId ?? e.seatId ?? '', verb, detail: `${j.targetSeatId ? `→ ${j.targetSeatId} · ` : ''}${j.claim ?? ''}`, tone: j.kind === 'challenge' ? (j.severity === 'critical' ? 'verm' : 'peach') : j.kind === 'adjudication' ? 'lav' : 'neutral' };
    }
    case 'approval.requested':
      return { actor: 'HUMAN', verb: 'approval requested', detail: String(p.request?.title ?? ''), tone: 'amber' };
    case 'approval.resolved':
      return { actor: 'HUMAN', verb: String(p.resolution?.decision ?? 'resolved'), detail: String(p.resolution?.note ?? ''), tone: p.resolution?.decision === 'approved' ? 'sage' : 'verm' };
    case 'artifact.created':
      return { actor: e.seatId ?? 'RUN', verb: `artifact · ${p.kind}`, detail: String(p.title ?? ''), tone: 'neutral' };
    case 'constitution.violation':
      return { actor: e.seatId ?? '', verb: 'constitution', detail: String(p.message ?? ''), tone: 'peach' };
    case 'node.started':
    case 'node.completed':
    case 'node.failed':
    case 'node.skipped':
      return { actor: String(p.nodeId), verb: `${e.type.split('.')[1]} · ${p.nodeType}`, detail: p.error ? String(p.error) : String(p.label ?? ''), tone: e.type === 'node.failed' ? 'verm' : e.type === 'node.completed' ? 'sage' : 'neutral' };
    case 'run.status':
      return { actor: 'RUN', verb: 'status', detail: p.workspace ? `workspace: ${p.workspace}${p.branch ? ` (${p.branch})` : ''}` : p.checkpoint ? `checkpoint ${String(p.checkpoint).slice(0, 8)}` : '', tone: 'neutral' };
    case 'run.completed':
      return { actor: 'RUN', verb: 'completed', detail: String(p.outcome ?? ''), tone: 'sage' };
    case 'run.failed':
      return { actor: 'RUN', verb: 'failed', detail: String(p.error ?? p.reason ?? ''), tone: 'verm' };
    case 'run.cancelled':
      return { actor: 'RUN', verb: 'cancelled', detail: '', tone: 'neutral' };
    default:
      return { actor: e.seatId ?? '', verb: e.type, detail: '', tone: 'neutral' };
  }
}
