import { ArrowLeft, Play, Save, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SpecEditor, defaultSpec } from '../components/agents/SpecEditor';
import { Badge, ErrorNote, SectionTitle } from '../components/ui/display';
import { Button, Field, Input, Select, Textarea } from '../components/ui/primitives';
import { cn } from '../lib/cn';
import { call } from '../lib/ipc';
import { useModelOptions } from '../lib/models';
import { navigate } from '../lib/router';
import { useAction, useQuery } from '../lib/store';
import { useToast } from '../lib/toast';
import type { AgentSpec, Workflow, WorkflowNode } from '../lib/types';

const NODE_TYPES: { type: WorkflowNode['type']; label: string; color: string }[] = [
  { type: 'start', label: 'Start', color: 'bg-ink' },
  { type: 'agent', label: 'Agent', color: 'bg-blue' },
  { type: 'table', label: 'Table', color: 'bg-lav' },
  { type: 'review', label: 'Review', color: 'bg-peach' },
  { type: 'judge', label: 'Judge', color: 'bg-lav' },
  { type: 'condition', label: 'Condition', color: 'bg-amber' },
  { type: 'approval', label: 'Approval', color: 'bg-amber' },
  { type: 'parallel', label: 'Parallel', color: 'bg-line' },
  { type: 'sequential', label: 'Sequential', color: 'bg-line' },
  { type: 'tool', label: 'Tool', color: 'bg-sage' },
  { type: 'git', label: 'Git', color: 'bg-sage' },
  { type: 'browser', label: 'Browser', color: 'bg-sage' },
  { type: 'mac', label: 'Mac', color: 'bg-verm' },
  { type: 'loop', label: 'Loop', color: 'bg-amber' },
  { type: 'wait', label: 'Wait', color: 'bg-line' },
  { type: 'end', label: 'End', color: 'bg-ink' },
];
const colorOf = (t: string) => NODE_TYPES.find((n) => n.type === t)?.color ?? 'bg-line';
const W = 168;
const H = 56;

export function WorkflowEditor({ id }: { id: string }) {
  const toast = useToast();
  const remote = useQuery('workflows.get', { id });
  const tables = useQuery('tables.list');
  const projects = useQuery('projects.list');
  const tools = useQuery('tools.list');
  const { options } = useModelOptions();
  const [wf, setWf] = useState<Workflow | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<{ id: string; branch: 'true' | 'false' | null } | null>(null);
  const [task, setTask] = useState('Add token-based authentication to the sync API');
  const [errors, setErrors] = useState<string[]>([]);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (remote.data && !dirty) setWf(remote.data);
  }, [remote.data, dirty]);

  const save = useAction(async () => {
    const r = await call('workflows.save', { id, workflow: { name: wf!.name, description: wf!.description, projectId: wf!.projectId, nodes: wf!.nodes, edges: wf!.edges } });
    setDirty(false);
    setErrors(r.validation.errors);
    return r;
  }, { onError: (m) => toast('error', m) });
  const run = useAction(async () => {
    const r = await save.run();
    if (!r?.validation.ok) throw new Error(r?.validation.errors.join('; ') ?? 'Invalid workflow');
    const runRec = await call('workflows.start', { id, task, projectId: wf!.projectId });
    navigate(`/runs/${runRec.id}`);
  }, { onError: (m) => toast('error', m) });
  const del = useAction(async () => {
    await call('workflows.delete', { id });
    navigate('/workflows');
  });

  if (!wf) return <div className="p-8 text-ink-3">Loading…</div>;
  const update = (patch: Partial<Workflow>) => {
    setWf({ ...wf, ...patch });
    setDirty(true);
  };
  const node = wf.nodes.find((n) => n.id === sel) ?? null;
  const setNode = (n: WorkflowNode) => update({ nodes: wf.nodes.map((x) => (x.id === n.id ? n : x)) });
  const addNode = (type: WorkflowNode['type']) => {
    let i = 1;
    while (wf.nodes.some((n) => n.id === `${type}_${i}`)) i++;
    const model = options[0] ? { providerId: options[0].providerId, modelId: options[0].modelId } : null;
    const config: Record<string, unknown> =
      type === 'agent' ? { spec: defaultSpec(model, 'role_engineer', 'Engineer') } : type === 'review' ? { spec: defaultSpec(model, 'role_critic', 'Critic') } : type === 'judge' ? { spec: defaultSpec(model, 'role_judge', 'Judge') } : type === 'table' ? { tableId: tables.data?.[0]?.id ?? null } : type === 'condition' ? { path: '', op: 'eq', value: '' } : type === 'wait' ? { ms: 1000 } : type === 'loop' ? { bodyNodeId: '', path: '', op: 'eq', value: 'approved', maxIterations: 2 } : {};
    const n: WorkflowNode = { id: `${type}_${i}`, type, label: NODE_TYPES.find((x) => x.type === type)!.label, config, x: 60 + (wf.nodes.length % 5) * 40, y: 320 + (wf.nodes.length % 4) * 30 };
    update({ nodes: [...wf.nodes, n] });
    setSel(n.id);
  };
  const connect = (target: string) => {
    if (!connectFrom || connectFrom.id === target) return setConnectFrom(null);
    const eid = `e_${connectFrom.id}_${target}${connectFrom.branch ? `_${connectFrom.branch}` : ''}`;
    if (!wf.edges.some((e) => e.id === eid)) update({ edges: [...wf.edges, { id: eid, source: connectFrom.id, target, branch: connectFrom.branch }] });
    setConnectFrom(null);
  };
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current || !canvas.current) return;
    const r = canvas.current.getBoundingClientRect();
    const x = Math.max(0, e.clientX - r.left + canvas.current.scrollLeft - drag.current.dx);
    const y = Math.max(0, e.clientY - r.top + canvas.current.scrollTop - drag.current.dy);
    setWf((w) => (w ? { ...w, nodes: w.nodes.map((n) => (n.id === drag.current!.id ? { ...n, x: Math.round(x / 8) * 8, y: Math.round(y / 8) * 8 } : n)) } : w));
    setDirty(true);
  };
  const pos = (id: string) => wf.nodes.find((n) => n.id === id)!;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-6 pt-1 pb-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/workflows')} className="text-ink-3 hover:text-ink" aria-label="Back"><ArrowLeft size={16} /></button>
          <input aria-label="Workflow name" value={wf.name} onChange={(e) => update({ name: e.target.value })} className="w-80 rounded-[4px] border border-transparent bg-transparent px-1 text-[18px] font-semibold hover:border-line focus:border-blue focus:outline-none" />
          {dirty ? <Badge tone="amber">unsaved</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          <Select className="w-52" value={wf.projectId ?? ''} onChange={(e) => update({ projectId: e.target.value || null })} aria-label="Project">
            <option value="">No project</option>
            {(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Input className="w-96" value={task} onChange={(e) => setTask(e.target.value)} aria-label="Task" />
          <Button onClick={() => save.run()} busy={save.busy} disabled={!dirty}><Save size={13} /> Save</Button>
          <Button variant="primary" onClick={() => run.run()} busy={run.busy}><Play size={13} /> Run</Button>
          <Button variant="ghost" size="icon" onClick={() => del.run()} aria-label="Delete workflow"><Trash2 size={14} /></Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="scroll-thin w-[150px] shrink-0 overflow-y-auto border-r border-line bg-card-2/60 p-3">
          <SectionTitle>Nodes</SectionTitle>
          {NODE_TYPES.map((t) => (
            <button key={t.type} onClick={() => addNode(t.type)} className="mb-1 flex w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-[12px] text-ink-2 hover:bg-card hover:text-ink">
              <span className={cn('h-[8px] w-[8px]', t.color)} /> {t.label}
            </button>
          ))}
          <p className="mt-3 text-[10.5px] leading-snug text-ink-3">Drag to move. Click a node's ● port, then another node, to connect. Conditions have true/false ports.</p>
        </aside>
        <div ref={canvas} className="grid-paper scroll-thin relative min-w-0 flex-1 overflow-auto" onMouseMove={onMove} onMouseUp={() => (drag.current = null)} onMouseLeave={() => (drag.current = null)} onClick={() => { setSel(null); setConnectFrom(null); }}>
          <svg className="pointer-events-none absolute top-0 left-0" width={2400} height={1400}>
            {wf.edges.map((e) => {
              const a = pos(e.source);
              const b = pos(e.target);
              if (!a || !b) return null;
              const x1 = a.x + W, y1 = a.y + H / 2 + (e.branch === 'true' ? -12 : e.branch === 'false' ? 12 : 0), x2 = b.x, y2 = b.y + H / 2;
              const mx = (x1 + x2) / 2;
              return (
                <g key={e.id}>
                  <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={e.branch === 'false' ? 'var(--verm)' : e.branch === 'true' ? 'var(--sage-ink)' : 'var(--ink-3)'} strokeWidth={1.5} />
                  {e.branch ? <text x={mx} y={(y1 + y2) / 2 - 4} fontSize={10} fontFamily="monospace" fill="var(--ink-3)">{e.branch}</text> : null}
                </g>
              );
            })}
          </svg>
          {wf.nodes.map((n) => (
            <div
              key={n.id}
              className={cn('absolute flex cursor-grab items-center rounded-[6px] border bg-card shadow-paper', sel === n.id ? 'border-ink' : 'border-line', connectFrom && 'cursor-crosshair')}
              style={{ left: n.x, top: n.y, width: W, height: H }}
              onMouseDown={(e) => { e.stopPropagation(); if (connectFrom) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); drag.current = { id: n.id, dx: e.clientX - r.left, dy: e.clientY - r.top }; }}
              onClick={(e) => { e.stopPropagation(); if (connectFrom) connect(n.id); else setSel(n.id); }}
            >
              <span className={cn('h-full w-[5px] shrink-0 rounded-l-[5px]', colorOf(n.type))} />
              <div className="min-w-0 flex-1 px-2.5">
                <div className="font-mono text-[9.5px] tracking-[0.14em] text-ink-3 uppercase">{n.type}</div>
                <div className="truncate text-[12.5px] font-medium">{n.label || n.id}</div>
              </div>
              {n.type !== 'end' ? (
                n.type === 'condition' ? (
                  <div className="absolute -right-[6px] flex h-full flex-col justify-center gap-3">
                    {(['true', 'false'] as const).map((b) => (
                      <button key={b} title={`${b} branch`} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setConnectFrom({ id: n.id, branch: b }); }} className={cn('h-[11px] w-[11px] rounded-full border-2 border-card', b === 'true' ? 'bg-sage-ink' : 'bg-verm')} />
                    ))}
                  </div>
                ) : (
                  <button title="Connect" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setConnectFrom({ id: n.id, branch: null }); }} className={cn('absolute -right-[6px] h-[11px] w-[11px] rounded-full border-2 border-card', connectFrom?.id === n.id ? 'bg-blue' : 'bg-ink-3')} />
                )
              ) : null}
            </div>
          ))}
        </div>
        <aside className="scroll-thin w-[400px] shrink-0 overflow-y-auto border-l border-line bg-card-2/60 p-4">
          {errors.length ? <div className="mb-3"><ErrorNote>{errors.map((e) => <div key={e}>{e}</div>)}</ErrorNote></div> : null}
          {node ? (
            <NodeInspector
              node={node}
              workflow={wf}
              onChange={setNode}
              onDelete={() => { update({ nodes: wf.nodes.filter((x) => x.id !== node.id), edges: wf.edges.filter((e) => e.source !== node.id && e.target !== node.id) }); setSel(null); }}
              onDeleteEdge={(eid) => update({ edges: wf.edges.filter((e) => e.id !== eid) })}
              tables={tables.data ?? []}
              toolNames={(tools.data ?? []).map((t) => t.name)}
            />
          ) : (
            <p className="text-[12px] text-ink-3">Select a node to configure it.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function NodeInspector({ node, workflow, onChange, onDelete, onDeleteEdge, tables, toolNames }: { node: WorkflowNode; workflow: Workflow; onChange: (n: WorkflowNode) => void; onDelete: () => void; onDeleteEdge: (id: string) => void; tables: { id: string; name: string }[]; toolNames: string[] }) {
  const c = node.config as Record<string, any>;
  const set = (patch: Record<string, unknown>) => onChange({ ...node, config: { ...c, ...patch } });
  const out = workflow.edges.filter((e) => e.source === node.id);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SectionTitle className="mb-0">{node.type} · {node.id}</SectionTitle>
        <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>
      </div>
      <Field label="Label"><Input value={node.label} onChange={(e) => onChange({ ...node, label: e.target.value })} /></Field>
      {node.type === 'table' ? (
        <Field label="Table">
          <Select value={c.tableId ?? ''} onChange={(e) => set({ tableId: e.target.value })}>
            <option value="">Select…</option>
            {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
      ) : null}
      {['agent', 'review', 'judge'].includes(node.type) && c.spec ? <SpecEditor value={c.spec as AgentSpec} onChange={(spec) => set({ spec })} /> : null}
      {node.type === 'condition' || node.type === 'loop' ? (
        <>
          {node.type === 'loop' ? (
            <>
              <Field label="Body node (re-run until condition holds)"><Select value={c.bodyNodeId ?? ''} onChange={(e) => set({ bodyNodeId: e.target.value })}><option value="">(first upstream)</option>{workflow.nodes.map((n) => <option key={n.id} value={n.id}>{n.id}</option>)}</Select></Field>
              <Field label="Max iterations"><Input type="number" min={1} max={5} value={c.maxIterations ?? 2} onChange={(e) => set({ maxIterations: Number(e.target.value) })} /></Field>
            </>
          ) : null}
          <Field label="Path" hint="nodeId.field, e.g. council.outcome"><Input value={c.path ?? ''} onChange={(e) => set({ path: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Operator"><Select value={c.op ?? 'eq'} onChange={(e) => set({ op: e.target.value })}>{['eq', 'neq', 'gt', 'lt', 'contains', 'truthy'].map((o) => <option key={o}>{o}</option>)}</Select></Field>
            <Field label="Value"><Input value={String(c.value ?? '')} onChange={(e) => set({ value: e.target.value })} /></Field>
          </div>
        </>
      ) : null}
      {node.type === 'approval' ? <Field label="Question for the human"><Input value={c.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></Field> : null}
      {node.type === 'wait' ? <Field label="Milliseconds"><Input type="number" min={0} value={c.ms ?? 1000} onChange={(e) => set({ ms: Number(e.target.value) })} /></Field> : null}
      {node.type === 'git' ? <Field label="Operation"><Select value={c.operation ?? 'status'} onChange={(e) => set({ operation: e.target.value })}><option value="status">status</option><option value="diff">diff</option></Select></Field> : null}
      {['tool', 'browser', 'mac'].includes(node.type) ? (
        <>
          <Field label="Tool">
            <Select value={c.tool ?? ''} onChange={(e) => set({ tool: e.target.value })}>
              <option value="">Select…</option>
              {toolNames.filter((t) => (node.type === 'browser' ? t.startsWith('browser_') : node.type === 'mac' ? t.startsWith('mac_') : true)).map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Arguments (JSON)">
            <Textarea rows={3} defaultValue={JSON.stringify(c.args ?? {}, null, 2)} onBlur={(e) => { try { set({ args: JSON.parse(e.target.value || '{}') }); } catch { /* keep previous */ } }} className="font-mono" />
          </Field>
          <p className="text-[11px] text-ink-3">Runs under the Operator role with default permissions; governance and approvals still apply.</p>
        </>
      ) : null}
      {!['start', 'end', 'parallel', 'sequential'].includes(node.type) ? (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Retries"><Input type="number" min={0} max={5} value={c.retries ?? 0} onChange={(e) => set({ retries: Number(e.target.value) })} /></Field>
          <Field label="Timeout ms"><Input type="number" min={0} value={c.timeoutMs ?? ''} onChange={(e) => set({ timeoutMs: e.target.value ? Number(e.target.value) : undefined })} /></Field>
          <Field label="On failure"><Select value={c.onFailure ?? 'fail'} onChange={(e) => set({ onFailure: e.target.value })}><option value="fail">fail</option><option value="continue">continue</option></Select></Field>
        </div>
      ) : null}
      {out.length ? (
        <div>
          <SectionTitle>Outgoing edges</SectionTitle>
          {out.map((e) => (
            <div key={e.id} className="flex items-center justify-between py-0.5 font-mono text-[11px]">
              <span>→ {e.target}{e.branch ? ` (${e.branch})` : ''}</span>
              <button className="text-ink-3 hover:text-verm" onClick={() => onDeleteEdge(e.id)}>remove</button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
