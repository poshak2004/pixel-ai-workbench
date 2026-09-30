import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Page } from '../components/layout/Page';
import { seatTone } from '../components/table/SeatCard';
import { Badge, Card, Empty, PageHeader } from '../components/ui/display';
import { Dialog } from '../components/ui/overlay';
import { Button, Field, Input, Select } from '../components/ui/primitives';
import { call } from '../lib/ipc';
import { useModelOptions } from '../lib/models';
import { navigate, useRoute } from '../lib/router';
import { useAction, useQuery } from '../lib/store';

export function TablesPage() {
  const tables = useQuery('tables.list');
  const roles = useQuery('roles.list');
  const runs = useQuery('runs.list', { limit: 200 });
  const { label } = useModelOptions();
  const { path } = useRoute();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (path.includes('new=1')) setOpen(true);
  }, [path]);
  const roleMap = useMemo(() => new Map((roles.data ?? []).map((r) => [r.id, r])), [roles.data]);

  return (
    <Page>
      <PageHeader
        kicker="Councils"
        title="Tables"
        actions={
          <Button variant="primary" onClick={() => setOpen(true)} data-testid="new-table">
            <Plus size={13} /> New table
          </Button>
        }
      >
        A table is a council of agents with explicit roles. Any model can sit in any seat; the role defines behaviour, the model supplies intelligence.
      </PageHeader>
      {tables.data?.length === 0 ? (
        <Empty title="No tables yet" action={<Button variant="primary" onClick={() => setOpen(true)}>Create your first table</Button>}>
          Start from a template such as the Design Council — an Architect, an Engineer and a Security Reviewer on three different providers, with an independent Judge.
        </Empty>
      ) : (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {(tables.data ?? []).map((t) => {
            const last = runs.data?.find((r) => r.tableId === t.id);
            const providers = new Set(t.seats.map((s) => s.spec.model.providerId));
            return (
              <Card key={t.id} className="cursor-pointer p-4 transition-colors hover:border-ink-3/60" onClick={() => navigate(`/tables/${t.id}`)} data-testid={`table-card-${t.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[14.5px] font-semibold">{t.name}</div>
                    <div className="line-clamp-2 text-[12px] text-ink-2">{t.description || '—'}</div>
                  </div>
                  <Badge tone={providers.size > 1 ? 'sage' : 'amber'}>{providers.size} provider{providers.size === 1 ? '' : 's'}</Badge>
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  {[...t.seats].sort((a, b) => a.order - b.order).map((s) => (
                    <div key={s.id} className="flex items-center gap-2 text-[12px]">
                      <span className={`h-[8px] w-[8px] ${seatTone(roleMap.get(s.spec.roleId))}`} />
                      <span className="w-[120px] truncate font-mono text-[10.5px] tracking-wide text-ink-2 uppercase">{roleMap.get(s.spec.roleId)?.name ?? s.spec.roleId}</span>
                      <span className="truncate text-ink-3">{label(s.spec.model)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-line-2 pt-2 font-mono text-[10.5px] text-ink-3">
                  <span>{t.protocol.evaluation.replace('_', ' ')}</span>
                  <span>{last ? `last: ${last.outcome ?? last.status}` : 'never run'}</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <NewTableDialog open={open} onClose={() => setOpen(false)} />
    </Page>
  );
}

function NewTableDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const templates = useQuery('tables.templates', undefined, { enabled: open });
  const projects = useQuery('projects.list', undefined, { enabled: open });
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('design-council');
  const [projectId, setProjectId] = useState('');
  const create = useAction(async () => {
    const t = await call('tables.create', { name: name || templates.data?.find((x) => x.id === templateId)?.name || 'Table', templateId, projectId: projectId || null });
    onClose();
    navigate(`/tables/${t.id}`);
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New table"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => create.run()} busy={create.busy} data-testid="create-table">
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. API Design Council" data-testid="table-name" />
        </Field>
        <Field label="Project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">No project</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start from">
          <div className="flex flex-col gap-1.5">
            {(templates.data ?? []).map((t) => (
              <button key={t.id} onClick={() => setTemplateId(t.id)} className={`rounded-[5px] border px-3 py-2 text-left ${templateId === t.id ? 'border-ink bg-card' : 'border-line bg-card-2 hover:border-ink-3/50'}`}>
                <div className="text-[12.5px] font-medium">{t.name}</div>
                <div className="text-[11.5px] text-ink-3">{t.description}</div>
              </button>
            ))}
          </div>
        </Field>
        {create.error ? <p className="text-[12px] text-verm">{create.error}</p> : null}
      </div>
    </Dialog>
  );
}
