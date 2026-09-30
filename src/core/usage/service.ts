import type { RunsRepo } from '../storage/repos/runs';
import { addUsage, emptyTotals, type UsageTotals } from './cost';
import type { UsageRecord } from './types';

export type UsageDimension = 'provider' | 'model' | 'agent' | 'table' | 'run' | 'day' | 'phase';

export interface UsageBreakdownRow extends UsageTotals {
  key: string;
  label: string;
}

export interface UsageSummary {
  totals: UsageTotals;
  breakdowns: Record<UsageDimension, UsageBreakdownRow[]>;
}

const keyOf: Record<UsageDimension, (r: UsageRecord) => [string, string]> = {
  provider: (r) => [r.providerId, r.providerId],
  model: (r) => [`${r.providerId}/${r.modelId}`, r.modelId],
  agent: (r) => [r.agentName, r.agentName],
  table: (r) => [r.tableId ?? '—', r.tableId ?? 'No table'],
  run: (r) => [r.runId, r.runId],
  day: (r) => {
    const d = new Date(r.createdAt).toISOString().slice(0, 10);
    return [d, d];
  },
  phase: (r) => [r.phase, r.phase],
};

/** Pure aggregation — also used by the renderer-independent tests. */
export function summarizeUsage(records: UsageRecord[]): UsageSummary {
  let totals = emptyTotals();
  const maps = Object.fromEntries((Object.keys(keyOf) as UsageDimension[]).map((d) => [d, new Map<string, UsageBreakdownRow>()])) as Record<UsageDimension, Map<string, UsageBreakdownRow>>;
  for (const r of records) {
    totals = addUsage(totals, r);
    for (const dim of Object.keys(keyOf) as UsageDimension[]) {
      const [key, label] = keyOf[dim](r);
      const row = maps[dim].get(key) ?? { key, label, ...emptyTotals() };
      maps[dim].set(key, { ...addUsage(row, r), key, label });
    }
  }
  const breakdowns = Object.fromEntries(
    (Object.keys(maps) as UsageDimension[]).map((d) => [d, [...maps[d].values()].sort((a, b) => (d === 'day' ? a.key.localeCompare(b.key) : b.costUsd - a.costUsd || b.outputTokens - a.outputTokens))]),
  ) as Record<UsageDimension, UsageBreakdownRow[]>;
  return { totals, breakdowns };
}

export class UsageService {
  constructor(private readonly runs: RunsRepo) {}

  async summary(filter: { runId?: string; since?: number } = {}): Promise<UsageSummary> {
    return summarizeUsage(await this.runs.usage(filter));
  }
}
