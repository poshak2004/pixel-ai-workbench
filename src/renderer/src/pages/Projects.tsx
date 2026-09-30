import { FolderOpen, GitBranch, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PermissionsEditor } from '../components/agents/PermissionsEditor';
import { Page } from '../components/layout/Page';
import { Badge, Card, Empty, ErrorNote, KV, PageHeader, SectionTitle, Stamp } from '../components/ui/display';
import { Dialog } from '../components/ui/overlay';
import { Button, Field, Input, Textarea } from '../components/ui/primitives';
import { fmtAgo } from '../lib/format';
import { call } from '../lib/ipc';
import { navigate } from '../lib/router';
import { useAction, useQuery } from '../lib/store';
import { useToast } from '../lib/toast';
import type { PermissionGrant } from '../lib/types';

export function ProjectsPage({ selected }: { selected?: string }) {
  const projects = useQuery('projects.list');
  const [open, setOpen] = useState(false);
  const current = projects.data?.find((p) => p.id === selected) ?? projects.data?.[0];
  return (
    <Page wide>
      <PageHeader kicker="Workspaces" title="Projects" actions={<Button variant="primary" onClick={() => setOpen(true)} data-testid="new-project"><Plus size={13} /> New project</Button>}>
        A project binds a local folder, a budget and a permission ceiling. Agents on git projects work in isolated worktrees on their own branch — never on your checkout.
      </PageHeader>
      {projects.data?.length === 0 ? (
        <Empty title="No projects" action={<Button variant="primary" onClick={() => setOpen(true)}>Create a project</Button>}>Projects give agents a workspace. Without one, agents have no file access at all.</Empty>
      ) : (
        <div className="grid grid-cols-[260px_1fr] gap-6">
          <Card className="divide-y divide-line-2 self-start">
            {(projects.data ?? []).map((p) => (
              <button key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className={`flex w-full flex-col px-3 py-2 text-left ${current?.id === p.id ? 'bg-card-2' : 'hover:bg-card-2'}`}>
                <span className="text-[12.5px] font-medium">{p.name}</span>
                <span className="truncate font-mono text-[10.5px] text-ink-3">{p.path ?? 'no folder'}</span>
              </button>
            ))}
          </Card>
          {current ? <ProjectDetail key={current.id} id={current.id} /> : null}
        </div>
      )}
      <NewProject open={open} onClose={() => setOpen(false)} />
    </Page>
  );
}

function ProjectDetail({ id }: { id: string }) {
  const toast = useToast();
  const projects = useQuery('projects.list');
  const p = projects.data?.find((x) => x.id === id)!;
  const git = useQuery('projects.gitStatus', { id });
  const ceiling = useQuery('projects.getCeiling', { id });
  const runs = useQuery('runs.list', { projectId: id, limit: 10 });
  const [grant, setGrant] = useState<PermissionGrant | null>(null);
  const [budget, setBudget] = useState(String(p.budgetUsd));
  useEffect(() => setGrant(ceiling.data ?? null), [ceiling.data]);
  const saveCeiling = useAction(() => call('projects.setCeiling', { id, grant: grant! }), { onError: (m) => toast('error', m) });
  const saveBudget = useAction(() => call('projects.update', { id, budgetUsd: Number(budget) }));
  const remove = useAction(async () => {
    await call('projects.delete', { id });
    navigate('/projects');
  });
  return (
    <div className="flex flex-col gap-5">
      <Card className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[16px] font-semibold">{p.name}</div>
            <div className="text-[12.5px] text-ink-2">{p.description || '—'}</div>
          </div>
          <div className="flex gap-2">
            {p.isGit ? <Badge tone="sage"><GitBranch size={10} /> git</Badge> : <Badge>folder</Badge>}
            <Button size="sm" variant="danger" onClick={() => remove.run()}>Delete</Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-6">
          <div>
            <KV k="Path" v={p.path ?? '—'} />
            <KV k="Created" v={fmtAgo(p.createdAt)} />
            {git.data ? <KV k="Branch" v={git.data.branch} /> : null}
            {git.data ? <KV k="Uncommitted" v={`${git.data.changes.length} file(s)`} /> : null}
          </div>
          <div>
            <Field label="Run budget (USD)" hint="Project-layer governance: model calls are blocked once a run exceeds this.">
              <div className="flex gap-2">
                <Input type="number" min={0} step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)} />
                <Button onClick={() => saveBudget.run()} busy={saveBudget.busy}>Save</Button>
              </div>
            </Field>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-5">
        <Card className="p-4">
          <SectionTitle right={<Button size="sm" onClick={() => saveCeiling.run()} busy={saveCeiling.busy} disabled={!grant}>Save</Button>}>Permission ceiling</SectionTitle>
          <p className="mb-2 text-[11.5px] text-ink-3">No agent in this project can exceed these, whatever its own permissions say.</p>
          {grant ? <PermissionsEditor value={grant} onChange={setGrant} /> : null}
        </Card>
        <Card className="p-4">
          <SectionTitle>Agent worktrees</SectionTitle>
          {git.data ? (
            <div className="flex flex-col gap-1">
              {git.data.worktrees.map((w) => (
                <div key={w.path} className="flex items-center justify-between rounded-[4px] border border-line-2 px-2 py-1 font-mono text-[11px]">
                  <span className="truncate">{w.branch ?? '(detached)'}</span>
                  <span className="truncate text-ink-3">{w.path.split('/').slice(-2).join('/')}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-ink-3">Not a git repository — agents get read-only access here unless you explicitly allow project writes.</p>
          )}
        </Card>
      </div>
      <Card className="p-4">
        <SectionTitle>Recent runs</SectionTitle>
        {(runs.data ?? []).map((r) => (
          <button key={r.id} onClick={() => navigate(`/runs/${r.id}`)} className="flex w-full items-center justify-between border-b border-line-2 py-1.5 text-left text-[12.5px] last:border-0 hover:bg-card-2">
            <span className="truncate">{r.title}</span>
            {r.outcome ? <Stamp value={r.outcome.split(':')[0]!} size="sm" /> : <Badge>{r.status}</Badge>}
          </button>
        ))}
        {runs.data?.length === 0 ? <p className="text-[12px] text-ink-3">No runs yet.</p> : null}
      </Card>
    </div>
  );
}

function NewProject({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [path, setPath] = useState<string | null>(null);
  const [budget, setBudget] = useState('5');
  const create = useAction(async () => {
    const p = await call('projects.create', { name, description, path, budgetUsd: Number(budget) || 5 });
    onClose();
    setName('');
    navigate(`/projects/${p.id}`);
  });
  const pick = async () => setPath(await call('projects.pickFolder'));
  return (
    <Dialog open={open} onClose={onClose} title="New project" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => create.run()} busy={create.busy} disabled={!name.trim()} data-testid="create-project">Create</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid="project-name" /></Field>
        <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Folder" hint="Optional. Git repositories enable isolated agent worktrees.">
          <div className="flex gap-2">
            <Input readOnly value={path ?? ''} placeholder="No folder" />
            <Button onClick={pick}><FolderOpen size={13} /> Choose…</Button>
          </div>
        </Field>
        <Field label="Run budget (USD)"><Input type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} /></Field>
        <ErrorNote>{create.error}</ErrorNote>
      </div>
    </Dialog>
  );
}
