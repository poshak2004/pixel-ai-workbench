import { useState } from 'react';
import { Page } from '../components/layout/Page';
import { Card, PageHeader, ProgressBar, SectionTitle, Stat } from '../components/ui/display';
import { Tabs } from '../components/ui/overlay';
import { fmtCost, fmtMs, fmtTokens } from '../lib/format';
import { useModelOptions } from '../lib/models';
import { useQuery } from '../lib/store';

const RANGES = [
  { id: '1', label: '24 hours', ms: 86400_000 },
  { id: '7', label: '7 days', ms: 7 * 86400_000 },
  { id: '30', label: '30 days', ms: 30 * 86400_000 },
  { id: 'all', label: 'All time', ms: 0 },
] as const;

type Dim = 'provider' | 'model' | 'agent' | 'table' | 'phase';

export function UsagePage() {
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('7');
  const [dim, setDim] = useState<Dim>('model');
  const r = RANGES.find((x) => x.id === range)!;
  const [since] = useState(() => Date.now());
  const usage = useQuery('usage.summary', r.ms ? { since: since - r.ms } : {});
  const tables = useQuery('tables.list');
  const { providerName } = useModelOptions();
  const t = usage.data?.totals;
  const rows = usage.data?.breakdowns[dim] ?? [];
  const days = usage.data?.breakdowns.day ?? [];
  const maxCost = Math.max(0.000001, ...rows.map((x) => x.costUsd));
  const maxDayTokens = Math.max(1, ...days.map((d) => d.inputTokens + d.outputTokens));
  const name = (key: string, label: string) => (dim === 'provider' ? providerName(key) : dim === 'table' ? (tables.data?.find((x) => x.id === key)?.name ?? label) : label);

  return (
    <Page wide>
      <PageHeader kicker="Observability" title="Usage" actions={<Tabs tabs={RANGES.map((x) => ({ id: x.id, label: x.label }))} value={range} onChange={setRange} className="border-b-0" />}>
        Tokens, latency and cost by provider, model, agent, table and phase. Costs are estimates from pricing metadata unless the provider reports them; unknown pricing is shown as unknown, never as $0.
      </PageHeader>
      <div className="mb-6 grid grid-cols-6 gap-4">
        <Card className="p-4"><Stat label="Model calls" value={t?.calls ?? 0} /></Card>
        <Card className="p-4"><Stat label="Input tokens" value={fmtTokens(t?.inputTokens)} sub={`${fmtTokens(t?.cachedInputTokens)} cached`} /></Card>
        <Card className="p-4"><Stat label="Output tokens" value={fmtTokens(t?.outputTokens)} sub={`${fmtTokens(t?.reasoningTokens)} reasoning`} /></Card>
        <Card className="p-4"><Stat label="Tool calls" value={t?.toolCalls ?? 0} /></Card>
        <Card className="p-4"><Stat label="Model time" value={fmtMs(t?.latencyMs)} sub={t?.calls ? `${fmtMs((t.latencyMs ?? 0) / t.calls)} avg` : ''} /></Card>
        <Card className="p-4"><Stat label="Est. cost" value={fmtCost(t?.costUsd ?? 0, t?.unpricedCalls)} sub={t?.unpricedCalls ? `${t.unpricedCalls} unpriced` : ''} tone={t?.unpricedCalls ? 'amber' : undefined} /></Card>
      </div>
      <div className="grid grid-cols-[1fr_360px] gap-6">
        <Card className="overflow-hidden">
          <div className="px-4 pt-2">
            <Tabs tabs={(['model', 'provider', 'agent', 'table', 'phase'] as Dim[]).map((d) => ({ id: d, label: d[0]!.toUpperCase() + d.slice(1) }))} value={dim} onChange={setDim} />
          </div>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left font-mono text-[10px] tracking-wider text-ink-3 uppercase">
                {['Name', 'Calls', 'In', 'Out', 'Tools', 'Avg latency', 'Cost', ''].map((h, i) => (
                  <th key={i} className="border-b border-line px-3 py-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-line-2">
                  <td className="max-w-[260px] truncate px-3 py-1.5">{name(row.key, row.label)}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{row.calls}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{fmtTokens(row.inputTokens)}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{fmtTokens(row.outputTokens)}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{row.toolCalls}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{fmtMs(row.latencyMs / Math.max(1, row.calls))}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{fmtCost(row.costUsd, row.unpricedCalls)}</td>
                  <td className="w-32 px-3 py-1.5"><ProgressBar value={row.costUsd} max={maxCost} tone="peach" /></td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-ink-3">No usage in this range.</td></tr>
              ) : null}
            </tbody>
          </table>
        </Card>
        <Card className="p-4">
          <SectionTitle>Tokens per day</SectionTitle>
          <div className="flex flex-col gap-2">
            {days.map((d) => (
              <div key={d.key}>
                <div className="flex justify-between font-mono text-[10.5px] text-ink-3">
                  <span>{d.key}</span>
                  <span>{fmtTokens(d.inputTokens + d.outputTokens)} · {fmtCost(d.costUsd, d.unpricedCalls)}</span>
                </div>
                <ProgressBar value={d.inputTokens + d.outputTokens} max={maxDayTokens} tone="blue" />
              </div>
            ))}
            {days.length === 0 ? <div className="text-[12px] text-ink-3">—</div> : null}
          </div>
        </Card>
      </div>
    </Page>
  );
}
