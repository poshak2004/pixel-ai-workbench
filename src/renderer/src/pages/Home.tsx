import { ArrowRight, KeyRound, Play, Plus, Sparkles } from 'lucide-react';
import { Page } from '../components/layout/Page';
import { Badge, Card, PageHeader, PixelGlyph, SectionTitle, Stamp, Stat, StatusDot } from '../components/ui/display';
import { Button } from '../components/ui/primitives';
import { fmtAgo, fmtCost, fmtTokens } from '../lib/format';
import { call } from '../lib/ipc';
import { navigate } from '../lib/router';
import { useAction, useQuery } from '../lib/store';
import { useToast } from '../lib/toast';

export function HomePage() {
  const toast = useToast();
  const runs = useQuery('runs.list', { limit: 12 });
  const tables = useQuery('tables.list');
  const providers = useQuery('providers.list');
  const approvals = useQuery('approvals.pending');
  const usage = useQuery('usage.summary', { since: Date.now() - 7 * 86400_000 });
  const demo = useAction(async () => {
    const d = await call('app.createDemo');
    navigate(`/tables/${d.tableId}`);
  }, { onError: (m) => toast('error', m) });

  const realProviders = (providers.data ?? []).filter((p) => p.config.kind !== 'mock');
  const empty = tables.data?.length === 0;

  return (
    <Page>
      <PageHeader kicker="Local-first agent execution environment" title="Home" />

      {empty ? (
        <Card className="mb-6 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto] gap-6 p-6">
            <div>
              <div className="mb-2 flex items-center gap-2 font-mono text-[10.5px] tracking-[0.16em] text-ink-3 uppercase">
                <Sparkles size={12} /> First run
              </div>
              <h2 className="text-[20px] font-semibold tracking-tight">Convene a council in one click</h2>
              <p className="mt-1 max-w-xl text-[13px] text-ink-2">
                The demo creates a sample project and a Table of Agents: an Architect, an Engineer and a Security Reviewer on three different (offline) providers, plus an independent Judge. They work independently, critique each other, rebut, and the Judge decides. The Governor, a deterministic policy engine, then allows or blocks the result. No API keys needed.
              </p>
              <div className="mt-4 flex gap-2">
                <Button variant="primary" size="lg" onClick={() => demo.run()} busy={demo.busy} data-testid="run-demo">
                  <Play size={13} /> Load the demo council
                </Button>
                <Button size="lg" onClick={() => navigate('/models?add=1')}>
                  <KeyRound size={13} /> Bring your own key
                </Button>
              </div>
            </div>
            <div className="hidden flex-col items-center justify-center gap-2 pr-4 md:flex">
              <PixelGlyph size={64} />
              <span className="font-mono text-[10px] tracking-[0.2em] text-ink-3">RUN → AGENT → ROLE → MODEL</span>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="mb-6 grid grid-cols-4 gap-4">
        <Card className="p-4">
          <Stat label="Runs · 7 days" value={new Set(usage.data?.breakdowns.run.map((r) => r.key)).size || 0} sub={`${usage.data?.totals.calls ?? 0} model calls`} />
        </Card>
        <Card className="p-4">
          <Stat label="Tokens · 7 days" value={fmtTokens((usage.data?.totals.inputTokens ?? 0) + (usage.data?.totals.outputTokens ?? 0))} sub={`${fmtTokens(usage.data?.totals.outputTokens ?? 0)} out`} />
        </Card>
        <Card className="p-4">
          <Stat label="Est. cost · 7 days" value={fmtCost(usage.data?.totals.costUsd ?? 0, usage.data?.totals.unpricedCalls)} sub={usage.data?.totals.unpricedCalls ? `${usage.data.totals.unpricedCalls} unpriced call(s)` : 'estimated from pricing metadata'} />
        </Card>
        <Card className="cursor-pointer p-4 hover:border-ink-3/50" onClick={() => navigate('/runs')}>
          <Stat label="Awaiting you" value={approvals.data?.length ?? 0} tone={approvals.data?.length ? 'amber' : undefined} sub="pending approvals" />
        </Card>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-6">
        <div>
          <SectionTitle right={<Button variant="ghost" size="sm" onClick={() => navigate('/runs')}>All runs <ArrowRight size={12} /></Button>}>Recent runs</SectionTitle>
          <Card className="divide-y divide-line-2">
            {(runs.data ?? []).length === 0 ? <div className="px-4 py-8 text-center text-[12.5px] text-ink-3">No runs yet.</div> : null}
            {(runs.data ?? []).map((r) => (
              <button key={r.id} onClick={() => navigate(`/runs/${r.id}`)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-card-2">
                <StatusDot status={r.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium">{r.title}</div>
                  <div className="font-mono text-[10.5px] text-ink-3">
                    {r.kind} · {fmtAgo(r.createdAt)}
                  </div>
                </div>
                {r.outcome ? <Stamp value={r.outcome.split(':')[0]!} size="sm" /> : <Badge tone="blue">{r.status}</Badge>}
              </button>
            ))}
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <div>
            <SectionTitle right={<Button variant="ghost" size="sm" onClick={() => navigate('/tables?new=1')}><Plus size={12} /> New</Button>}>Tables</SectionTitle>
            <Card className="divide-y divide-line-2">
              {(tables.data ?? []).slice(0, 6).map((t) => (
                <button key={t.id} onClick={() => navigate(`/tables/${t.id}`)} className="flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px] hover:bg-card-2">
                  <span className="truncate">{t.name}</span>
                  <span className="font-mono text-[10.5px] text-ink-3">{t.seats.length} seats</span>
                </button>
              ))}
              {tables.data?.length === 0 ? <div className="px-3 py-4 text-[12px] text-ink-3">None yet</div> : null}
            </Card>
          </div>
          <div>
            <SectionTitle right={<Button variant="ghost" size="sm" onClick={() => navigate('/models')}>Manage</Button>}>Providers</SectionTitle>
            <Card className="divide-y divide-line-2">
              {(providers.data ?? []).map((p) => (
                <div key={p.config.id} className="flex items-center justify-between px-3 py-2 text-[12.5px]">
                  <span className="flex items-center gap-2">
                    <StatusDot status={p.ready ? 'done' : 'idle'} />
                    {p.config.name}
                  </span>
                  <span className="font-mono text-[10.5px] text-ink-3">{p.config.kind === 'mock' ? 'offline demo' : `${p.modelCount} models`}</span>
                </div>
              ))}
              {!realProviders.length ? (
                <button onClick={() => navigate('/models?add=1')} className="w-full px-3 py-2 text-left text-[12px] text-blue-ink hover:bg-card-2">
                  + Add Anthropic, OpenAI, Gemini, OpenRouter or a local server
                </button>
              ) : null}
            </Card>
          </div>
        </div>
      </div>
    </Page>
  );
}
