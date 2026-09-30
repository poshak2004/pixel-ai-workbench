import { Copy, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConstitutionView } from '../components/agents/ConstitutionView';
import { defaultSpec, SpecEditor } from '../components/agents/SpecEditor';
import { Page } from '../components/layout/Page';
import { Badge, Card, Empty, PageHeader, SectionTitle } from '../components/ui/display';
import { Dialog, Drawer, Tabs } from '../components/ui/overlay';
import { Button, Checkbox, Field, Input, Select, Textarea } from '../components/ui/primitives';
import { call } from '../lib/ipc';
import { useModelOptions } from '../lib/models';
import { useAction, useQuery } from '../lib/store';
import { useToast } from '../lib/toast';
import type { AgentSpec, Role } from '../lib/types';

const ACTIONS = ['fs.read', 'fs.write', 'shell.exec', 'git.read', 'git.write', 'browser.use', 'network.request', 'mac.control', 'mcp.call'] as const;

export function AgentsPage() {
  const [tab, setTab] = useState<'agents' | 'roles'>('agents');
  return (
    <Page wide>
      <PageHeader kicker="Role + model + rules + tools + permissions" title="Agents">
        Agents are model-independent. The same role runs on Claude, GPT, Gemini or a local model without changing its constitution.
      </PageHeader>
      <Tabs tabs={[{ id: 'agents', label: 'Saved agents' }, { id: 'roles', label: 'Roles & constitutions' }]} value={tab} onChange={setTab} className="mb-5" />
      {tab === 'agents' ? <AgentList /> : <RoleList />}
    </Page>
  );
}

function AgentList() {
  const agents = useQuery('agents.list');
  const { label, options } = useModelOptions();
  const roles = useQuery('roles.list');
  const toast = useToast();
  const [editing, setEditing] = useState<{ id: string | null; spec: AgentSpec } | null>(null);
  const save = useAction(async () => {
    await call('agents.save', { id: editing!.id, spec: editing!.spec });
    setEditing(null);
    toast('success', 'Agent saved');
  }, { onError: (m) => toast('error', m) });
  const del = useAction((id: string) => call('agents.delete', { id }));
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={() => setEditing({ id: null, spec: defaultSpec(options[0] ? { providerId: options[0].providerId, modelId: options[0].modelId } : null) })}>
          <Plus size={13} /> New agent
        </Button>
      </div>
      {agents.data?.length === 0 ? <Empty title="No saved agents">Save reusable agents here, then seat them at any table.</Empty> : null}
      <div className="grid grid-cols-3 gap-4">
        {(agents.data ?? []).map((a) => (
          <Card key={a.id} className="cursor-pointer p-4 hover:border-ink-3/60" onClick={() => setEditing({ id: a.id, spec: a.spec })}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[14px] font-semibold">{a.spec.name}</div>
                <div className="font-mono text-[10.5px] tracking-wider text-ink-3 uppercase">{roles.data?.find((r) => r.id === a.spec.roleId)?.name ?? a.spec.roleId}</div>
              </div>
              <button className="text-ink-3 hover:text-verm" onClick={(e) => { e.stopPropagation(); void del.run(a.id); }} aria-label="Delete agent">
                <Trash2 size={13} />
              </button>
            </div>
            <div className="mt-2 truncate font-mono text-[11px] text-ink-2">{label(a.spec.model)}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {a.spec.allowedTools.slice(0, 4).map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit agent' : 'New agent'} width={480} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={() => save.run()} busy={save.busy}>Save</Button></>}>
        {editing ? <SpecEditor value={editing.spec} onChange={(spec) => setEditing({ ...editing, spec })} /> : null}
      </Drawer>
    </>
  );
}

function RoleList() {
  const roles = useQuery('roles.list');
  const toast = useToast();
  const [selected, setSelected] = useState<string>('role_security_reviewer');
  const [forkName, setForkName] = useState('');
  const [forking, setForking] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const role = roles.data?.find((r) => r.id === selected);
  const fork = useAction(async () => {
    const r = await call('roles.fork', { fromId: selected, name: forkName });
    setForking(false);
    setSelected(r.id);
    setEditing(r);
  }, { onError: (m) => toast('error', m) });
  const save = useAction(async () => {
    await call('roles.update', { id: editing!.id, name: editing!.name, description: editing!.description, constitution: editing!.constitution });
    setEditing(null);
    toast('success', 'Constitution saved — version bumped');
  }, { onError: (m) => toast('error', m) });
  const del = useAction(async (id: string) => {
    await call('roles.delete', { id });
    setSelected('role_security_reviewer');
  }, { onError: (m) => toast('error', m) });

  return (
    <div className="grid grid-cols-[260px_1fr] gap-6">
      <Card className="divide-y divide-line-2 self-start">
        {(roles.data ?? []).map((r) => (
          <button key={r.id} onClick={() => setSelected(r.id)} className={`flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px] ${selected === r.id ? 'bg-card-2 font-medium' : 'hover:bg-card-2'}`}>
            <span>{r.name}</span>
            {r.builtIn ? null : <Badge tone="lav">v{r.version}</Badge>}
          </button>
        ))}
      </Card>
      {role ? (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[16px] font-semibold">{role.name}</div>
              <div className="text-[12.5px] text-ink-2">{role.description}</div>
            </div>
            <div className="flex gap-2">
              {role.builtIn ? null : (
                <>
                  <Button size="sm" onClick={() => setEditing(role)}>Edit constitution</Button>
                  <Button size="sm" variant="danger" onClick={() => del.run(role.id)}>Delete</Button>
                </>
              )}
              <Button size="sm" onClick={() => { setForkName(`${role.name} (custom)`); setForking(true); }}>
                <Copy size={12} /> Fork
              </Button>
            </div>
          </div>
          <ConstitutionView role={role} />
          {role.builtIn ? <p className="mt-2 text-[11.5px] text-ink-3">Built-in constitutions are immutable. Fork to customise; edits bump the version and change the constitution hash recorded on every run.</p> : null}
        </div>
      ) : null}
      <Dialog open={forking} onClose={() => setForking(false)} title="Fork role" footer={<><Button onClick={() => setForking(false)}>Cancel</Button><Button variant="primary" onClick={() => fork.run()} busy={fork.busy}>Fork</Button></>}>
        <Field label="Name">
          <Input value={forkName} onChange={(e) => setForkName(e.target.value)} />
        </Field>
      </Dialog>
      <Drawer open={!!editing} onClose={() => setEditing(null)} title={`Constitution · ${editing?.name ?? ''}`} width={560} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={() => save.run()} busy={save.busy}>Save constitution</Button></>}>
        {editing ? <ConstitutionEditor role={editing} onChange={setEditing} /> : null}
      </Drawer>
    </div>
  );
}

function ConstitutionEditor({ role, onChange }: { role: Role; onChange: (r: Role) => void }) {
  const c = role.constitution;
  const set = (patch: Partial<Role['constitution']>) => onChange({ ...role, constitution: { ...c, ...patch } });
  const lines = (label: string, key: 'responsibilities' | 'challengeRules' | 'decisionRules' | 'escalationRules') => (
    <Field label={label} hint="One per line">
      <Textarea rows={3} value={c[key].join('\n')} onChange={(e) => set({ [key]: e.target.value.split('\n').filter((l) => l.trim()) } as Partial<Role['constitution']>)} />
    </Field>
  );
  return (
    <div className="flex flex-col gap-3">
      <Field label="Role name"><Input value={role.name} onChange={(e) => onChange({ ...role, name: e.target.value })} /></Field>
      <Field label="Mission"><Textarea rows={2} value={c.mission} onChange={(e) => set({ mission: e.target.value })} /></Field>
      {lines('Responsibilities', 'responsibilities')}
      {lines('Challenge rules', 'challengeRules')}
      {lines('Decision rules', 'decisionRules')}
      {lines('Escalation rules', 'escalationRules')}
      <div>
        <SectionTitle>Actions (enforced by PIXEL, not the model)</SectionTitle>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-[12px]">
          <span className="font-mono text-[10px] text-ink-3">ACTION</span>
          <span className="font-mono text-[10px] text-ink-3">ALLOW</span>
          <span className="font-mono text-[10px] text-ink-3">FORBID</span>
          {ACTIONS.map((a) => (
            <div key={a} className="contents">
              <span className="font-mono">{a}</span>
              <Checkbox label="" checked={c.allowedActions.includes(a)} onChange={(v) => set({ allowedActions: v ? [...c.allowedActions, a] : c.allowedActions.filter((x) => x !== a), forbiddenActions: c.forbiddenActions.filter((x) => x !== a) })} />
              <Checkbox label="" checked={c.forbiddenActions.includes(a)} onChange={(v) => set({ forbiddenActions: v ? [...c.forbiddenActions, a] : c.forbiddenActions.filter((x) => x !== a), allowedActions: c.allowedActions.filter((x) => x !== a) })} />
            </div>
          ))}
        </div>
      </div>
      <div>
        <SectionTitle>Evidence standard</SectionTitle>
        <div className="flex flex-col gap-1.5">
          <Checkbox label="Major/critical challenges require evidence" checked={c.evidenceStandard.challengesRequireEvidence} onChange={(v) => set({ evidenceStandard: { ...c.evidenceStandard, challengesRequireEvidence: v } })} />
          <Checkbox label="Approvals require evidence" checked={c.evidenceStandard.approvalsRequireEvidence} onChange={(v) => set({ evidenceStandard: { ...c.evidenceStandard, approvalsRequireEvidence: v } })} />
          <Field label="Minimum evidence per proposal">
            <Input type="number" min={0} max={10} value={c.evidenceStandard.minProposalEvidence} onChange={(e) => set({ evidenceStandard: { ...c.evidenceStandard, minProposalEvidence: Math.max(0, Number(e.target.value) || 0) } })} />
          </Field>
        </div>
      </div>
      <div>
        <SectionTitle>Authority</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Checkbox label="Can propose" checked={c.authority.canPropose} onChange={(v) => set({ authority: { ...c.authority, canPropose: v, canJudge: v ? false : c.authority.canJudge } })} />
          <Checkbox label="Can review" checked={c.authority.canCritique} onChange={(v) => set({ authority: { ...c.authority, canCritique: v } })} />
          <Checkbox label="Can judge" checked={c.authority.canJudge} onChange={(v) => set({ authority: { ...c.authority, canJudge: v, canPropose: v ? false : c.authority.canPropose }, outputSchema: v ? 'adjudication' : c.outputSchema })} />
          <Field label="Veto (block at)">
            <Select value={c.authority.blockAt} onChange={(e) => set({ authority: { ...c.authority, blockAt: e.target.value as 'none' | 'critical' | 'major' } })}>
              <option value="none">No veto</option>
              <option value="critical">Critical</option>
              <option value="major">Major and above</option>
            </Select>
          </Field>
          <Field label="Weight">
            <Input type="number" min={0} max={10} step={0.5} value={c.authority.weight} onChange={(e) => set({ authority: { ...c.authority, weight: Number(e.target.value) } })} />
          </Field>
        </div>
      </div>
    </div>
  );
}
