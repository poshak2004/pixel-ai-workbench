import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Page } from '../components/layout/Page';
import { Badge, Card, Empty, PageHeader } from '../components/ui/display';
import { Dialog } from '../components/ui/overlay';
import { Button, Field, Input } from '../components/ui/primitives';
import { call } from '../lib/ipc';
import { navigate } from '../lib/router';
import { useAction, useQuery } from '../lib/store';
import { fmtAgo } from '../lib/format';

export function WorkflowsPage() {
  const workflows = useQuery('workflows.list');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const create = useAction(async () => {
    const w = await call('workflows.create', { name });
    setOpen(false);
    navigate(`/workflows/${w.id}`);
  });
  return (
    <Page>
      <PageHeader kicker="Pipelines" title="Workflows" actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus size={13} /> New workflow</Button>}>
        Connect tables, agents, reviews, judges, conditions, approvals and tools into a governed pipeline. Branches run in parallel; every node has retries, timeouts and failure handling.
      </PageHeader>
      {workflows.data?.length === 0 ? <Empty title="No workflows" action={<Button variant="primary" onClick={() => setOpen(true)}>Create one</Button>}>New workflows start from a template: Table → Condition → Human approval.</Empty> : null}
      <div className="grid grid-cols-3 gap-4">
        {(workflows.data ?? []).map((w) => (
          <Card key={w.id} className="cursor-pointer p-4 hover:border-ink-3/60" onClick={() => navigate(`/workflows/${w.id}`)}>
            <div className="text-[14px] font-semibold">{w.name}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {[...new Set(w.nodes.map((n) => n.type))].map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
            <div className="mt-2 font-mono text-[10.5px] text-ink-3">{w.nodes.length} nodes · edited {fmtAgo(w.updatedAt)}</div>
          </Card>
        ))}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="New workflow" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => create.run()} busy={create.busy}>Create</Button></>}>
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </Dialog>
    </Page>
  );
}
