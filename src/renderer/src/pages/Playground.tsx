import { Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Page } from '../components/layout/Page';
import { defaultSpec, SpecEditor } from '../components/agents/SpecEditor';
import { Timeline, QUIET_EVENTS } from '../components/run/Timeline';
import { Badge, Card, ErrorNote, PageHeader, SectionTitle, Stamp, Stat } from '../components/ui/display';
import { Markdown } from '../components/ui/markdown';
import { Button, Field, Select, Textarea } from '../components/ui/primitives';
import { fmtCost, fmtMs, fmtTokens } from '../lib/format';
import { call } from '../lib/ipc';
import { useModelOptions } from '../lib/models';
import { navigate } from '../lib/router';
import { useAction, useQuery } from '../lib/store';
import type { AgentSpec } from '../lib/types';
import { useRun } from '../lib/useRun';

export function PlaygroundPage() {
  const agents = useQuery('agents.list');
  const projects = useQuery('projects.list');
  const { options } = useModelOptions();
  const [spec, setSpec] = useState<AgentSpec | null>(null);
  const [task, setTask] = useState('Propose a caching strategy for the sync API');
  const [projectId, setProjectId] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const { detail, events } = useRun(runId);

  useEffect(() => {
    if (!spec && options[0]) setSpec(defaultSpec({ providerId: options[0].providerId, modelId: options[0].modelId }, 'role_engineer', 'Engineer'));
  }, [spec, options]);

  const start = useAction(async () => {
    const r = await call('runs.startAgent', { spec: spec!, task, projectId: projectId || null });
    setRunId(r.id);
  });
  const save = useAction(() => call('agents.save', { id: null, spec: spec! }));
  const result = detail?.artifacts.find((a) => a.kind === 'final_result');
  const usage = useMemo(() => events.filter((e) => e.type === 'model.call').map((e) => e.payload.usage as { inputTokens: number; outputTokens: number; latencyMs: number; costUsd: number | null }), [events]);

  return (
    <Page wide>
      <PageHeader kicker="One agent, fully governed" title="Playground" actions={<Button onClick={() => navigate('/models?tab=observatory')}>Compare models →</Button>}>
        Try any role on any model. Tool calls still pass through permissions and governance, and every step is recorded.
      </PageHeader>
      <div className="grid grid-cols-[440px_1fr] gap-6">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle className="mb-0">Agent</SectionTitle>
            <Select className="w-52" value="" onChange={(e) => { const a = agents.data?.find((x) => x.id === e.target.value); if (a) setSpec(a.spec); }} aria-label="Load saved agent">
              <option value="">Load saved agent…</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.spec.name}</option>
              ))}
            </Select>
          </div>
          {spec ? <SpecEditor value={spec} onChange={setSpec} /> : <p className="text-[12px] text-ink-3">No models available. Add a provider.</p>}
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={() => save.run()} busy={save.busy} disabled={!spec}>Save as agent</Button>
          </div>
        </Card>
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-4">
            <Field label="Task">
              <Textarea value={task} onChange={(e) => setTask(e.target.value)} rows={4} />
            </Field>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Select className="w-64" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
                <option value="">No project (no file access)</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
              <Button variant="primary" size="lg" onClick={() => start.run()} busy={start.busy} disabled={!spec?.model.modelId || !task.trim()}>
                <Play size={13} /> Run agent
              </Button>
            </div>
            <ErrorNote>{start.error}</ErrorNote>
          </Card>
          {runId && detail ? (
            <>
              <div className="grid grid-cols-4 gap-4">
                <Card className="p-3"><Stat label="Status" value={detail.run.outcome ? <Stamp value={detail.run.outcome} size="sm" /> : detail.run.status} /></Card>
                <Card className="p-3"><Stat label="Tokens" value={fmtTokens(usage.reduce((n, u) => n + u.inputTokens + u.outputTokens, 0))} /></Card>
                <Card className="p-3"><Stat label="Latency" value={fmtMs(usage.reduce((n, u) => n + u.latencyMs, 0))} /></Card>
                <Card className="p-3"><Stat label="Cost" value={fmtCost(usage.reduce((n, u) => n + (u.costUsd ?? 0), 0))} /></Card>
              </div>
              {result ? (
                <Card className="p-4">
                  <Markdown text={result.content} />
                </Card>
              ) : null}
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <SectionTitle className="mb-0">Trace</SectionTitle>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/runs/${runId}`)}>Open in run view →</Button>
                </div>
                <Timeline events={events.filter((e) => !QUIET_EVENTS.has(e.type))} compact />
              </Card>
              {detail.run.error ? <Badge tone="verm">{detail.run.error}</Badge> : null}
            </>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
