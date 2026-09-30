import { useMemo, useState } from 'react';
import { Page } from '../components/layout/Page';
import { Badge, Card, Empty, PageHeader, Stamp, StatusDot } from '../components/ui/display';
import { Select } from '../components/ui/primitives';
import { ApprovalBanner } from '../components/run/ApprovalBanner';
import { fmtCost, fmtMs, fmtTime, fmtTokens } from '../lib/format';
import { navigate } from '../lib/router';
import { useQuery } from '../lib/store';

export function RunsPage() {
  const runs = useQuery('runs.list', { limit: 500 });
  const usage = useQuery('usage.summary');
  const approvals = useQuery('approvals.pending');
  const projects = useQuery('projects.list');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [project, setProject] = useState('');
  const byRun = useMemo(() => new Map((usage.data?.breakdowns.run ?? []).map((r) => [r.key, r])), [usage.data]);
  const rows = (runs.data ?? []).filter((r) => (!kind || r.kind === kind) && (!status || r.status === status) && (!project || r.projectId === project));

  return (
    <Page wide>
      <PageHeader kicker="Every execution, inspectable and replayable" title="Runs" />
      {(approvals.data ?? []).length ? (
        <div className="mb-5 overflow-hidden rounded-[6px] border border-amber/50">
          {approvals.data!.map((a) => (
            <div key={a.id}>
              <ApprovalBanner approval={a} />
              <button className="w-full bg-amber-soft px-6 pb-2 text-left font-mono text-[10.5px] text-amber-ink underline" onClick={() => navigate(`/runs/${a.runId}`)}>
                open run {a.runId}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mb-3 flex gap-2">
        <Select className="w-40" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">All kinds</option>
          {['table', 'agent', 'compare', 'workflow'].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </Select>
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {['running', 'awaiting_approval', 'completed', 'failed', 'cancelled'].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </Select>
        <Select className="w-52" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      {rows.length === 0 ? (
        <Empty title="No runs match">Run a table, an agent in the Playground, a workflow, or a model comparison.</Empty>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left font-mono text-[10px] tracking-wider text-ink-3 uppercase">
                {['', 'Run', 'Kind', 'Started', 'Tokens', 'Cost', 'Model time', 'Outcome'].map((h, i) => (
                  <th key={i} className="border-b border-line px-3 py-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const u = byRun.get(r.id);
                return (
                  <tr key={r.id} className="cursor-pointer border-b border-line-2 hover:bg-card-2" onClick={() => navigate(`/runs/${r.id}`)}>
                    <td className="w-6 px-3 py-2">
                      <StatusDot status={r.status} />
                    </td>
                    <td className="max-w-[460px] truncate px-3 py-2">{r.title}</td>
                    <td className="px-3 py-2">
                      <Badge>{r.kind}</Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-ink-2">{fmtTime(r.createdAt)}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{u ? fmtTokens(u.inputTokens + u.outputTokens) : '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{u ? fmtCost(u.costUsd, u.unpricedCalls) : '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{u ? fmtMs(u.latencyMs) : '—'}</td>
                    <td className="px-3 py-2">{r.outcome ? <Stamp value={r.outcome.split(':')[0]!} size="sm" /> : <Badge tone="blue">{r.status.replace('_', ' ')}</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
