import { ArrowLeft, ArrowRight, Play, Save, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { defaultSpec, SpecEditor } from '../components/agents/SpecEditor';
import { Timeline, QUIET_EVENTS } from '../components/run/Timeline';
import { Council } from '../components/table/Council';
import { Badge, Card, ErrorNote, SectionTitle, Stamp } from '../components/ui/display';
import { Dialog, Drawer } from '../components/ui/overlay';
import { Button, Field, Input, Select, Textarea, Toggle } from '../components/ui/primitives';
import { call } from '../lib/ipc';
import { useModelOptions } from '../lib/models';
import { navigate } from '../lib/router';
import { useAction, useQuery } from '../lib/store';
import { useToast } from '../lib/toast';
import type { Seat, Table } from '../lib/types';
import { seatStates, useRun } from '../lib/useRun';
import { fmtAgo } from '../lib/format';

const SAMPLE_TASKS = [
  'Add token-based authentication to the sync API',
  'Design rate limiting for the public endpoints',
  'Delete inactive customer records from the production database',
];

export function TableDetail({ id }: { id: string }) {
  const toast = useToast();
  const remote = useQuery('tables.get', { id });
  const rolesQ = useQuery('roles.list');
  const projects = useQuery('projects.list');
  const runs = useQuery('runs.list', { limit: 200 });
  const { label, options } = useModelOptions();
  const [table, setTable] = useState<Table | null>(null);
  const [dirty, setDirty] = useState(false);
  const [seatId, setSeatId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [task, setTask] = useState(SAMPLE_TASKS[0]!);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (remote.data && !dirty) setTable(remote.data);
  }, [remote.data, dirty]);

  const roles = useMemo(() => new Map((rolesQ.data ?? []).map((r) => [r.id, r])), [rolesQ.data]);
  const tableRuns = (runs.data ?? []).filter((r) => r.tableId === id);
  const latest = tableRuns[0];
  const { events } = useRun(latest?.id);
  const live = useMemo(() => seatStates(events), [events]);
  const finalVerdict = events.filter((e) => e.type === 'governance.decision' && e.payload.subject === 'final_decision').map((e) => (e.payload.verdict as { decision: string }).decision)[0] ?? null;
  const validation = useQuery('tables.validate', { id });

  const save = useAction(async (t: Table) => {
    const updated = await call('tables.update', { id: t.id, table: { name: t.name, description: t.description, projectId: t.projectId, seats: t.seats, protocol: t.protocol, rules: t.rules } });
    setDirty(false);
    return updated;
  }, { onError: (m) => toast('error', m) });

  const start = useAction(async () => {
    if (!table) return;
    if (dirty) await save.run(table);
    const run = await call('runs.startTable', { tableId: table.id, task, projectId: table.projectId });
    toast('info', 'Council convened');
    return run;
  }, { onError: (m) => toast('error', m) });

  const remove = useAction(async () => {
    await call('tables.delete', { id });
    navigate('/tables');
  });

  if (!table) return <div className="p-8 text-ink-3">{remote.error ?? 'Loading…'}</div>;

  const update = (patch: Partial<Table>) => {
    setTable({ ...table, ...patch });
    setDirty(true);
  };
  const updateSeat = (s: Seat) => update({ seats: table.seats.map((x) => (x.id === s.id ? s : x)) });
  const selected = table.seats.find((s) => s.id === seatId) ?? null;
  const moveSeat = (s: Seat, dir: -1 | 1) => {
    const i = table.seats.findIndex((x) => x.id === s.id);
    const j = i + dir;
    if (j < 0 || j >= table.seats.length) return;
    const seats = [...table.seats];
    [seats[i], seats[j]] = [seats[j]!, seats[i]!];
    update({ seats: seats.map((x, n) => ({ ...x, order: n })) });
  };
  const running = latest && (latest.status === 'running' || latest.status === 'queued' || latest.status === 'awaiting_approval');
  const recent = events.filter((e) => !QUIET_EVENTS.has(e.type)).slice(-14);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="scroll-thin min-w-0 flex-1 overflow-y-auto px-8 pt-3 pb-12">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => navigate('/tables')} className="text-ink-3 hover:text-ink" aria-label="Back to tables">
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <div className="font-mono text-[10.5px] tracking-[0.16em] text-ink-3 uppercase">Table of agents</div>
              <input
                aria-label="Table name"
                value={table.name}
                onChange={(e) => update({ name: e.target.value })}
                className="w-[420px] max-w-full rounded-[4px] border border-transparent bg-transparent px-1 -ml-1 text-[22px] font-semibold tracking-tight hover:border-line focus:border-blue focus:outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dirty ? <Badge tone="amber">unsaved</Badge> : null}
            <Button onClick={() => save.run(table)} busy={save.busy} disabled={!dirty}>
              <Save size={13} /> Save
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} aria-label="Delete table">
              <Trash2 size={14} />
            </Button>
          </div>
        </div>

        <Council
          seats={[...table.seats].sort((a, b) => a.order - b.order)}
          roles={roles}
          live={live}
          modelLabel={(s) => label(s.spec.model)}
          onSeat={(s) => setSeatId(s.id)}
          selectedSeat={seatId}
          onAdd={() => setAdding(true)}
          verdict={finalVerdict}
        />

        <Card className="mt-5 p-4">
          <SectionTitle right={<span className="font-mono text-[10.5px] text-ink-3">every seat works independently, then the council deliberates</span>}>Task</SectionTitle>
          <Textarea aria-label="Task" value={task} onChange={(e) => setTask(e.target.value)} rows={3} placeholder="What should the council decide?" />
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_TASKS.map((t) => (
                <button key={t} onClick={() => setTask(t)} className="rounded-[4px] border border-line bg-card-2 px-2 py-[2px] text-[11px] text-ink-2 hover:border-ink-3/50 hover:text-ink">
                  {t.length > 44 ? `${t.slice(0, 42)}…` : t}
                </button>
              ))}
            </div>
            <Button variant="primary" size="lg" onClick={() => start.run()} busy={start.busy} disabled={!task.trim() || !!running || validation.data?.ok === false} data-testid="run-table">
              <Play size={13} /> Convene council
            </Button>
          </div>
          <ErrorNote>{start.error}</ErrorNote>
        </Card>

        {latest ? (
          <Card className="mt-5 overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <SectionTitle className="mb-0">{running ? 'Live' : 'Latest run'}</SectionTitle>
                <span className="truncate text-[12px] text-ink-2">{latest.task}</span>
              </div>
              <div className="flex items-center gap-2">
                {latest.outcome ? <Stamp value={latest.outcome} size="sm" /> : <Badge tone="blue">{latest.status}</Badge>}
                <Button size="sm" onClick={() => navigate(`/runs/${latest.id}`)} data-testid="open-run">
                  Open run <ArrowRight size={12} />
                </Button>
              </div>
            </div>
            <Timeline events={recent} compact seatName={(sid) => table.seats.find((s) => s.id === sid)?.spec.name ?? sid} onSelect={() => navigate(`/runs/${latest.id}`)} />
          </Card>
        ) : null}

        {tableRuns.length > 1 ? (
          <div className="mt-5">
            <SectionTitle>History</SectionTitle>
            <div className="divide-y divide-line-2 rounded-[6px] border border-line bg-card">
              {tableRuns.slice(1, 8).map((r) => (
                <button key={r.id} onClick={() => navigate(`/runs/${r.id}`)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-card-2">
                  <span className="truncate text-[12.5px]">{r.task}</span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-[10.5px] text-ink-3">{fmtAgo(r.createdAt)}</span>
                    {r.outcome ? <Stamp value={r.outcome} size="sm" /> : <Badge>{r.status}</Badge>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <aside className="scroll-thin w-[320px] shrink-0 overflow-y-auto border-l border-line bg-card-2/60 px-5 pt-3 pb-10">
        <SectionTitle>Workspace</SectionTitle>
        <Field label="Project">
          <Select value={table.projectId ?? ''} onChange={(e) => update({ projectId: e.target.value || null })}>
            <option value="">No project (no file access)</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="rule-dotted my-4" />
        <SectionTitle>Deliberation protocol</SectionTitle>
        <div className="flex flex-col gap-2.5">
          <Field label="Evaluation strategy">
            <Select value={table.protocol.evaluation} onChange={(e) => update({ protocol: { ...table.protocol, evaluation: e.target.value as Table['protocol']['evaluation'] } })}>
              <option value="judge_arbitration">Judge arbitration</option>
              <option value="weighted_authority">Weighted authority + judge</option>
              <option value="consensus">Consensus + judge</option>
              <option value="human_approval">Human approval</option>
            </Select>
          </Field>
          {table.protocol.evaluation === 'weighted_authority' ? (
            <Field label={`Approval threshold · ${Math.round(table.protocol.approvalThreshold * 100)}%`}>
              <input type="range" min={0} max={1} step={0.05} value={table.protocol.approvalThreshold} onChange={(e) => update({ protocol: { ...table.protocol, approvalThreshold: Number(e.target.value) } })} />
            </Field>
          ) : null}
          <Toggle checked={table.protocol.critique} onChange={(v) => update({ protocol: { ...table.protocol, critique: v } })} label="Cross-review (critique)" />
          <Toggle checked={table.protocol.rebuttal} onChange={(v) => update({ protocol: { ...table.protocol, rebuttal: v } })} label="Rebuttal & resolution" />
          <Toggle checked={table.protocol.blindReviews} onChange={() => undefined} disabled label="Blind reviews (always on)" />
          <Toggle checked={table.protocol.requireCrossProviderReview} onChange={(v) => update({ protocol: { ...table.protocol, requireCrossProviderReview: v } })} label="Require cross-provider review" />
          <Field label="Parallelism">
            <Select value={table.protocol.maxConcurrency} onChange={(e) => update({ protocol: { ...table.protocol, maxConcurrency: Number(e.target.value) } })}>
              {[1, 2, 4, 8].map((n) => (
                <option key={n} value={n}>
                  {n} at a time
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="rule-dotted my-4" />
        <SectionTitle>Validation</SectionTitle>
        {dirty ? <p className="text-[11.5px] text-ink-3">Save to re-validate.</p> : null}
        {validation.data?.errors.map((e) => (
          <p key={e} className="mb-1 flex gap-1.5 text-[12px] text-verm">
            <TriangleAlert size={13} className="mt-[2px] shrink-0" />
            {e}
          </p>
        ))}
        {validation.data?.warnings.map((w) => (
          <p key={w} className="mb-1 flex gap-1.5 text-[12px] text-amber-ink">
            <TriangleAlert size={13} className="mt-[2px] shrink-0" />
            {w}
          </p>
        ))}
        {validation.data?.ok && !validation.data.warnings.length ? <p className="text-[12px] text-sage-ink">Ready: proposers, reviewers and an independent judge.</p> : null}

        <div className="rule-dotted my-4" />
        <SectionTitle>Governance precedence</SectionTitle>
        <ol className="space-y-1 font-mono text-[11px] text-ink-2">
          {['Safety policy', 'System policy', 'Project policy', 'Table constitution', 'Role constitution', 'Agent instruction', 'User task'].map((l, i) => (
            <li key={l} className="flex items-center gap-2">
              <span className="w-4 text-right text-ink-3">{i + 1}</span>
              {l}
              {i < 2 ? <Badge className="ml-auto">locked</Badge> : null}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] text-ink-3">Lower levels can only tighten. The most restrictive decision wins.</p>
      </aside>

      <Drawer
        open={!!selected}
        onClose={() => setSeatId(null)}
        title={selected ? `Seat · ${selected.spec.name}` : ''}
        width={460}
        footer={
          selected ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => moveSeat(selected, -1)}>
                <ArrowLeft size={12} /> Move
              </Button>
              <Button variant="ghost" size="sm" onClick={() => moveSeat(selected, 1)}>
                Move <ArrowRight size={12} />
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  update({ seats: table.seats.filter((s) => s.id !== selected.id) });
                  setSeatId(null);
                }}
              >
                Remove seat
              </Button>
              <Button variant="primary" size="sm" onClick={() => setSeatId(null)}>
                Done
              </Button>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="flex flex-col gap-4">
            <SpecEditor value={selected.spec} onChange={(spec) => updateSeat({ ...selected, spec })} />
            <Field label="Seat weight override" hint="Used by weighted-authority evaluation. Seats cannot grant themselves judge or veto powers.">
              <Input type="number" min={0} max={10} step={0.5} value={selected.authority?.weight ?? ''} placeholder={String(roles.get(selected.spec.roleId)?.constitution.authority.weight ?? 1)} onChange={(e) => updateSeat({ ...selected, authority: e.target.value === '' ? undefined : { ...selected.authority, weight: Number(e.target.value) } })} />
            </Field>
          </div>
        ) : null}
      </Drawer>

      <AddSeatDialog
        open={adding}
        onClose={() => setAdding(false)}
        defaultModel={options[0] ? { providerId: options[0].providerId, modelId: options[0].modelId } : null}
        onAdd={(spec, sourceAgentId) => {
          const base = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'seat';
          let sid = base;
          for (let i = 2; table.seats.some((s) => s.id === sid); i++) sid = `${base}_${i}`;
          const judgeIdx = table.seats.findIndex((s) => roles.get(s.spec.roleId)?.constitution.authority.canJudge);
          const seats = [...table.seats];
          seats.splice(judgeIdx === -1 ? seats.length : judgeIdx, 0, { id: sid, order: 0, spec, sourceAgentId });
          update({ seats: seats.map((s, i) => ({ ...s, order: i })) });
          setAdding(false);
          setSeatId(sid);
        }}
      />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete table?"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => remove.run()} busy={remove.busy}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-ink-2">The table's seats are deleted. Past runs keep their snapshots and remain inspectable.</p>
      </Dialog>
    </div>
  );
}

function AddSeatDialog({ open, onClose, onAdd, defaultModel }: { open: boolean; onClose: () => void; onAdd: (spec: Seat['spec'], sourceAgentId: string | null) => void; defaultModel: { providerId: string; modelId: string } | null }) {
  const agents = useQuery('agents.list', undefined, { enabled: open });
  const roles = useQuery('roles.list', undefined, { enabled: open });
  const [roleId, setRoleId] = useState('role_critic');
  return (
    <Dialog open={open} onClose={onClose} title="Add a seat" width={560}>
      <SectionTitle>From a role</SectionTitle>
      <div className="grid grid-cols-3 gap-1.5">
        {(roles.data ?? []).filter((r) => r.id !== 'role_operator').map((r) => (
          <button
            key={r.id}
            onClick={() => setRoleId(r.id)}
            className={`rounded-[5px] border px-2 py-1.5 text-left text-[12px] ${roleId === r.id ? 'border-ink bg-card' : 'border-line bg-card-2 hover:border-ink-3/50'}`}
            title={r.description}
          >
            <div className="font-medium">{r.name}</div>
            <div className="truncate text-[10.5px] text-ink-3">{r.description}</div>
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          onClick={() => {
            const role = roles.data?.find((r) => r.id === roleId);
            onAdd(defaultSpec(defaultModel, roleId, role?.name ?? 'Agent'), null);
          }}
          data-testid="add-seat-confirm"
        >
          Add {roles.data?.find((r) => r.id === roleId)?.name ?? 'seat'}
        </Button>
      </div>
      {agents.data?.length ? (
        <>
          <div className="rule-dotted my-4" />
          <SectionTitle>From a saved agent</SectionTitle>
          <div className="flex flex-col gap-1">
            {agents.data.map((a) => (
              <button key={a.id} onClick={() => onAdd(a.spec, a.id)} className="flex items-center justify-between rounded-[5px] border border-line bg-card-2 px-3 py-2 text-left text-[12.5px] hover:border-ink-3/50">
                <span>{a.spec.name}</span>
                <span className="font-mono text-[10.5px] text-ink-3">{a.spec.model.modelId}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
