import { ArrowLeft, GitBranch, RotateCcw, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ModelSelect } from '../components/agents/ModelSelect';
import { ApprovalBanner } from '../components/run/ApprovalBanner';
import { Debate } from '../components/run/Debate';
import { Inspector } from '../components/run/Inspector';
import { QUIET_EVENTS, Timeline } from '../components/run/Timeline';
import { VerdictView } from '../components/run/VerdictView';
import { Badge, Card, Empty, SectionTitle, Stamp, Stat, StatusDot } from '../components/ui/display';
import { Markdown } from '../components/ui/markdown';
import { Dialog, Tabs } from '../components/ui/overlay';
import { Button, Field, Textarea, Toggle } from '../components/ui/primitives';
import { fmtCost, fmtMs, fmtTime, fmtTokens } from '../lib/format';
import { call } from '../lib/ipc';
import { useModelOptions } from '../lib/models';
import { navigate } from '../lib/router';
import { useAction, useQuery } from '../lib/store';
import { useToast } from '../lib/toast';
import type { RunEvent, Verdict } from '../lib/types';
import { seatStates, useRun } from '../lib/useRun';
import { cn } from '../lib/cn';

type Tab = 'timeline' | 'debate' | 'result' | 'usage' | 'artifacts';

export function RunView({ id }: { id: string }) {
  const toast = useToast();
  const { detail, events, error } = useRun(id);
  const approvals = useQuery('approvals.pending');
  const { label } = useModelOptions();
  const [tab, setTab] = useState<Tab>('timeline');
  const [selected, setSelected] = useState<RunEvent | null>(null);
  const [seatFilter, setSeatFilter] = useState<string | null>(null);
  const [verbose, setVerbose] = useState(false);
  const [branching, setBranching] = useState(false);

  const seats = useMemo(() => seatStates(events), [events]);
  const seatName = (sid: string) => seats.get(sid)?.name ?? sid;
  const cancel = useAction(() => call('runs.cancel', { id }));
  const replay = useAction(async () => {
    const r = await call('runs.rerun', { id });
    toast('info', 'Replaying from the original snapshot');
    navigate(`/runs/${r.id}`);
  }, { onError: (m) => toast('error', m) });

  if (error) return <div className="p-8 text-verm">{error}</div>;
  if (!detail) return <div className="p-8 text-ink-3">Loading run…</div>;
  const run = detail.run;
  const pending = (approvals.data ?? []).filter((a) => a.runId === id);
  const finalGov = [...events].reverse().find((e) => e.type === 'governance.decision' && e.payload.subject === 'final_decision');
  const verdict = finalGov?.payload.verdict as Verdict | undefined;
  const finalArtifact = detail.artifacts.find((a) => a.kind === 'final_result');
  const report = detail.artifacts.find((a) => a.kind === 'report');
  const diff = detail.artifacts.find((a) => a.kind === 'diff');
  const usage = detail.usage;
  const totals = usage.reduce(
    (t, u) => ({ inT: t.inT + u.inputTokens, outT: t.outT + u.outputTokens, cost: t.cost + (u.costUsd ?? 0), unpriced: t.unpriced + (u.costUsd === null ? 1 : 0), lat: t.lat + u.latencyMs }),
    { inT: 0, outT: 0, cost: 0, unpriced: 0, lat: 0 },
  );
  const liveUsage = events.filter((e) => e.type === 'model.call').map((e) => e.payload.usage as (typeof usage)[number]);
  const calls = Math.max(usage.length, liveUsage.length);
  const liveTokens = liveUsage.reduce((n, u) => n + u.inputTokens + u.outputTokens, 0);
  const liveCost = liveUsage.reduce((n, u) => n + (u.costUsd ?? 0), 0);
  const wall = run.startedAt ? (run.finishedAt ?? Date.now()) - run.startedAt : null;
  const active = run.status === 'running' || run.status === 'queued' || run.status === 'awaiting_approval';
  const shown = events.filter((e) => (verbose || !QUIET_EVENTS.has(e.type)) && (!seatFilter || e.seatId === seatFilter));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-line px-6 pt-2 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <button onClick={() => (run.tableId ? navigate(`/tables/${run.tableId}`) : navigate('/runs'))} className="mt-1 text-ink-3 hover:text-ink" aria-label="Back">
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.14em] text-ink-3 uppercase">
                <StatusDot status={run.status} /> {run.kind} run · {run.status.replace('_', ' ')} · {fmtTime(run.createdAt)}
                {run.parentRunId ? (
                  <button className="normal-case underline decoration-dotted" onClick={() => navigate(`/runs/${run.parentRunId}`)}>
                    from {run.parentRunId.slice(0, 12)}
                  </button>
                ) : null}
              </div>
              <h1 className="truncate text-[18px] font-semibold tracking-tight" data-selectable>{run.task}</h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {run.outcome ? <Stamp value={run.outcome.split(':')[0]!} size="md" className="mr-2" /> : null}
            {active ? (
              <Button variant="danger" size="sm" onClick={() => cancel.run()} busy={cancel.busy}>
                <Square size={11} /> Cancel
              </Button>
            ) : run.kind === 'table' ? (
              <>
                <Button size="sm" onClick={() => replay.run()} busy={replay.busy} title="Re-run from the exact same snapshot">
                  <RotateCcw size={12} /> Replay
                </Button>
                <Button size="sm" onClick={() => setBranching(true)} title="New run with a different task or models">
                  <GitBranch size={12} /> Branch
                </Button>
              </>
            ) : null}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-6 gap-4">
          <Stat label="Tokens" value={fmtTokens(usage.length ? totals.inT + totals.outT : liveTokens)} sub={usage.length ? `${fmtTokens(totals.inT)} in · ${fmtTokens(totals.outT)} out` : 'live'} />
          <Stat label="Est. cost" value={fmtCost(usage.length ? totals.cost : liveCost, totals.unpriced)} sub={totals.unpriced ? `${totals.unpriced} unpriced` : 'from pricing metadata'} />
          <Stat label="Wall time" value={fmtMs(wall)} sub={`${fmtMs(totals.lat)} model time`} />
          <Stat label="Model calls" value={calls} sub={`${seats.size} agents`} />
          <Stat label="Tool calls" value={detail.toolCalls.length || events.filter((e) => e.type === 'tool.requested').length} sub={`${detail.toolCalls.filter((t) => t.status !== 'ok').length} blocked/failed`} />
          <Stat label="Judgments" value={events.filter((e) => e.type === 'judgment.recorded').length} sub={`${events.filter((e) => e.type === 'constitution.violation').length} constitution flags`} />
        </div>
        {run.error ? <div className="mt-2 text-[12px] text-verm">{run.error}</div> : null}
      </header>

      {pending.map((a) => (
        <ApprovalBanner key={a.id} approval={a} />
      ))}

      <div className="flex min-h-0 flex-1">
        {/* Agent tree */}
        <aside className="scroll-thin w-[240px] shrink-0 overflow-y-auto border-r border-line bg-card-2/60 px-3 py-3" data-testid="agent-tree">
          <SectionTitle>Agents</SectionTitle>
          <button onClick={() => setSeatFilter(null)} className={cn('mb-1 w-full rounded-[5px] px-2 py-1 text-left font-mono text-[11px]', !seatFilter ? 'bg-card text-ink shadow-paper' : 'text-ink-3 hover:text-ink')}>
            all events
          </button>
          {[...seats.values()].map((s) => (
            <button key={s.seatId} onClick={() => setSeatFilter(s.seatId === seatFilter ? null : s.seatId)} className={cn('mb-1 w-full rounded-[5px] border px-2 py-1.5 text-left', seatFilter === s.seatId ? 'border-ink bg-card' : 'border-transparent hover:bg-card')}>
              <div className="flex items-center gap-1.5">
                <StatusDot status={s.status} />
                <span className="truncate text-[12.5px] font-medium">{s.name}</span>
              </div>
              <div className="truncate font-mono text-[10px] text-ink-3">
                {s.role} · {label({ providerId: s.providerId, modelId: s.model })}
              </div>
              <div className="mt-0.5 flex gap-2 font-mono text-[10px] text-ink-3">
                <span>{fmtTokens(s.tokens)} tok</span>
                <span>{fmtMs(s.latencyMs)}</span>
                {s.lastDecision ? <span className="truncate text-ink-2">{s.lastDecision}</span> : null}
              </div>
            </button>
          ))}
          <div className="mt-2 rounded-[5px] border border-line bg-card px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-[0.16em] text-ink-3">GOVERNOR</span>
              {verdict ? <Stamp value={verdict.decision} size="sm" /> : <span className="font-mono text-[10px] text-ink-3">—</span>}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-ink-3">{events.filter((e) => e.type === 'governance.decision').length} decisions</div>
          </div>
          {run.branch ? (
            <div className="mt-3 rounded-[5px] border border-line bg-card px-2 py-1.5 font-mono text-[10.5px] text-ink-2">
              <div className="text-ink-3">ISOLATED WORKTREE</div>
              {run.branch}
            </div>
          ) : null}
        </aside>

        {/* Main */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-4">
            <Tabs
              tabs={[
                { id: 'timeline', label: 'Timeline', count: shown.length },
                { id: 'debate', label: 'Debate', count: detail.judgments.length },
                { id: 'result', label: 'Result' },
                { id: 'usage', label: 'Usage', count: usage.length },
                { id: 'artifacts', label: 'Artifacts', count: detail.artifacts.length },
              ]}
              value={tab}
              onChange={setTab}
              className="flex-1"
            />
            {tab === 'timeline' ? <Toggle checked={verbose} onChange={setVerbose} label={<span className="text-[11.5px] text-ink-3">all events</span>} /> : null}
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {tab === 'timeline' ? <Timeline events={shown} selected={selected?.id} onSelect={setSelected} seatName={seatName} /> : null}
            {tab === 'debate' ? <Debate events={events} judgments={detail.judgments} seatName={seatName} /> : null}
            {tab === 'result' ? (
              <div className="flex flex-col gap-4 p-4">
                {verdict ? (
                  <Card className="p-4">
                    <SectionTitle>Governance decision</SectionTitle>
                    <VerdictView verdict={verdict} />
                  </Card>
                ) : null}
                {finalArtifact ? (
                  <Card className="p-4" data-testid="final-result">
                    <Markdown text={finalArtifact.content} />
                  </Card>
                ) : null}
                {report && run.kind === 'compare' ? <CompareReport content={report.content} label={label} /> : null}
                {report && run.kind === 'workflow' ? <WorkflowReport content={report.content} /> : null}
                {!verdict && !finalArtifact && !report ? <Empty title={active ? 'Deliberating…' : 'No result'}>{active ? 'The result appears when the judge and governor have decided.' : run.error ?? ''}</Empty> : null}
              </div>
            ) : null}
            {tab === 'usage' ? (
              <table className="w-full font-mono text-[11.5px]">
                <thead className="sticky top-0 bg-paper">
                  <tr className="text-left text-[10px] tracking-wider text-ink-3 uppercase">
                    {['Agent', 'Phase', 'Provider · model', 'In', 'Cached', 'Out', 'Tools', 'Latency', 'Cost'].map((h) => (
                      <th key={h} className="border-b border-line px-3 py-1.5 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {usage.map((u) => (
                    <tr key={u.id} className="border-b border-line-2">
                      <td className="px-3 py-1">{u.agentName}</td>
                      <td className="px-3 py-1 text-ink-2">{u.phase}</td>
                      <td className="px-3 py-1 text-ink-2">{label({ providerId: u.providerId, modelId: u.modelId })}</td>
                      <td className="px-3 py-1 tabular-nums">{u.inputTokens}</td>
                      <td className="px-3 py-1 tabular-nums text-ink-3">{u.cachedInputTokens}</td>
                      <td className="px-3 py-1 tabular-nums">{u.outputTokens}</td>
                      <td className="px-3 py-1 tabular-nums">{u.toolCalls}</td>
                      <td className="px-3 py-1 tabular-nums">{fmtMs(u.latencyMs)}</td>
                      <td className="px-3 py-1 tabular-nums">{fmtCost(u.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {tab === 'artifacts' ? (
              <div className="flex flex-col gap-3 p-4">
                {diff ? (
                  <Card className="p-3">
                    <SectionTitle>Workspace diff · {diff.title}</SectionTitle>
                    <pre className="scroll-thin max-h-[420px] overflow-auto font-mono text-[11px]" data-selectable>
                      {diff.content.split('\n').map((l, i) => (
                        <div key={i} className={l.startsWith('+') ? 'text-sage-ink' : l.startsWith('-') ? 'text-verm' : 'text-ink-2'}>
                          {l}
                        </div>
                      ))}
                    </pre>
                  </Card>
                ) : null}
                {detail.artifacts
                  .filter((a) => a.kind !== 'diff')
                  .map((a) => (
                    <details key={a.id} className="rounded-[6px] border border-line bg-card">
                      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[12.5px]">
                        <Badge>{a.kind}</Badge>
                        <span className="truncate">{a.title}</span>
                        <span className="ml-auto font-mono text-[10.5px] text-ink-3">{a.seatId ? seatName(a.seatId) : ''}</span>
                      </summary>
                      <div className="border-t border-line-2 p-3">{a.mimeType === 'text/markdown' ? <Markdown text={a.content} /> : <pre className="max-h-[360px] overflow-auto font-mono text-[11px] whitespace-pre-wrap" data-selectable>{a.content}</pre>}</div>
                    </details>
                  ))}
              </div>
            ) : null}
          </div>
        </section>

        {/* Inspector */}
        <aside className="scroll-thin w-[400px] shrink-0 overflow-y-auto border-l border-line bg-card-2/60 px-4 py-3">
          <SectionTitle>Inspector</SectionTitle>
          <Inspector event={selected} seatName={seatName} />
        </aside>
      </div>
      <BranchDialog open={branching} onClose={() => setBranching(false)} runId={id} task={run.task} seats={[...seats.values()]} />
    </div>
  );
}

function BranchDialog({ open, onClose, runId, task, seats }: { open: boolean; onClose: () => void; runId: string; task: string; seats: { seatId: string; name: string; providerId: string; model: string }[] }) {
  const [t, setT] = useState(task);
  const [models, setModels] = useState<Record<string, { providerId: string; modelId: string }>>({});
  const toast = useToast();
  const go = useAction(async () => {
    const r = await call('runs.rerun', { id: runId, task: t, seatModels: models });
    onClose();
    navigate(`/runs/${r.id}`);
  }, { onError: (m) => toast('error', m) });
  return (
    <Dialog open={open} onClose={onClose} title="Branch this run" width={560} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => go.run()} busy={go.busy}>Start branch</Button></>}>
      <p className="mb-3 text-[12px] text-ink-2">A branch reuses this run's exact table snapshot, constitutions and policies. Change the task, or seat different models to compare outcomes.</p>
      <Field label="Task">
        <Textarea value={t} onChange={(e) => setT(e.target.value)} rows={3} />
      </Field>
      <div className="mt-3 flex flex-col gap-2">
        {seats.map((s) => (
          <div key={s.seatId} className="grid grid-cols-[140px_1fr] items-center gap-2">
            <span className="truncate text-[12.5px]">{s.name}</span>
            <ModelSelect value={models[s.seatId] ?? { providerId: s.providerId, modelId: s.model }} onChange={(m) => setModels({ ...models, [s.seatId]: m })} />
          </div>
        ))}
      </div>
    </Dialog>
  );
}

interface CompareRow {
  seatId: string;
  model: { providerId: string; modelId: string };
  error: string | null;
  summary: string | null;
  selfConfidence: number | null;
  evidenceItems: number;
  tokens: number;
  latencyMs: number;
  costUsd: number | null;
  toolCalls: number;
  attempts: number;
  review: { verdict: string; confidence: number; challenges: { severity: string; claim: string }[]; summary: string } | null;
}

export function CompareReport({ content, label }: { content: string; label: (r: { providerId: string; modelId: string }) => string }) {
  const rows = JSON.parse(content) as CompareRow[];
  const min = (f: (r: CompareRow) => number | null) => Math.min(...rows.map(f).filter((x): x is number => x !== null));
  return (
    <Card className="overflow-hidden" data-testid="compare-report">
      <div className="border-b border-line px-4 py-2.5">
        <SectionTitle className="mb-0">Model observatory</SectionTitle>
        <p className="text-[11.5px] text-ink-3">Each dimension is shown separately. PIXEL never collapses quality into a single score.</p>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left font-mono text-[10px] tracking-wider text-ink-3 uppercase">
            {['Model', 'Review verdict', 'Reviewer conf.', 'Challenges', 'Self conf.', 'Evidence', 'Latency', 'Tokens', 'Cost', 'Tools', 'Attempts'].map((h) => (
              <th key={h} className="border-b border-line px-3 py-1.5 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => (
            <tr key={r.seatId} className="border-b border-line-2 align-top">
              <td className="px-3 py-2 font-sans">
                <div className="font-medium">{label(r.model)}</div>
                <div className="max-w-[260px] truncate text-[11px] text-ink-3">{r.error ?? r.summary}</div>
              </td>
              <td className="px-3 py-2">{r.review ? <Badge tone={r.review.verdict === 'approve' ? 'sage' : r.review.verdict === 'reject' ? 'verm' : 'amber'}>{r.review.verdict}</Badge> : '—'}</td>
              <td className="px-3 py-2">{r.review ? r.review.confidence.toFixed(2) : '—'}</td>
              <td className="px-3 py-2">{r.review ? r.review.challenges.map((c) => c.severity[0]!.toUpperCase()).join(' ') || '0' : '—'}</td>
              <td className="px-3 py-2">{r.selfConfidence?.toFixed(2) ?? '—'}</td>
              <td className="px-3 py-2">{r.evidenceItems}</td>
              <td className={cn('px-3 py-2', r.latencyMs === min((x) => x.latencyMs) && 'text-sage-ink')}>{fmtMs(r.latencyMs)}</td>
              <td className={cn('px-3 py-2', r.tokens === min((x) => x.tokens) && 'text-sage-ink')}>{fmtTokens(r.tokens)}</td>
              <td className={cn('px-3 py-2', r.costUsd !== null && r.costUsd === min((x) => x.costUsd) && 'text-sage-ink')}>{fmtCost(r.costUsd)}</td>
              <td className="px-3 py-2">{r.toolCalls}</td>
              <td className="px-3 py-2">{r.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function WorkflowReport({ content }: { content: string }) {
  const r = JSON.parse(content) as { status: string; states: Record<string, string>; errors: Record<string, string> };
  return (
    <Card className="p-4">
      <SectionTitle>Workflow · {r.status}</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {Object.entries(r.states).map(([node, state]) => (
          <div key={node} className="flex items-center gap-2 rounded-[5px] border border-line bg-card-2 px-2 py-1.5">
            <StatusDot status={state === 'completed' ? 'done' : state === 'failed' ? 'error' : 'idle'} />
            <span className="truncate font-mono text-[11.5px]">{node}</span>
            <span className="ml-auto font-mono text-[10px] text-ink-3">{state}</span>
          </div>
        ))}
      </div>
      {Object.entries(r.errors).map(([n, e]) => (
        <div key={n} className="mt-2 text-[12px] text-verm">
          {n}: {e}
        </div>
      ))}
    </Card>
  );
}
