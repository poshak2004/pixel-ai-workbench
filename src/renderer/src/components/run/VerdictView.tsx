import { cn } from '../../lib/cn';
import type { Verdict } from '../../lib/types';
import { Badge, DECISION_TONE, Stamp } from '../ui/display';

export function VerdictView({ verdict, showAll }: { verdict: Verdict; showAll?: boolean }) {
  const rows = verdict.trace.filter((t) => showAll || t.outcome !== 'not_applicable');
  return (
    <div data-testid="verdict">
      <div className="flex items-center gap-3">
        <Stamp value={verdict.decision} size="lg" />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">{verdict.reason}</div>
          <div className="font-mono text-[10.5px] text-ink-3">
            deciding layer: {verdict.decidingLayer ?? '—'} · rule: {verdict.decidingRuleId ?? '—'} · policy {verdict.policyHash.slice(0, 10)}
          </div>
        </div>
      </div>
      {verdict.violations.length ? (
        <div className="mt-2 rounded-[5px] border border-peach/50 bg-peach-soft px-2.5 py-1.5 text-[11.5px] text-peach-ink">
          {verdict.violations.map((v) => (
            <div key={v}>Ignored relaxation attempt: {v}</div>
          ))}
        </div>
      ) : null}
      <table className="mt-3 w-full font-mono text-[11px]">
        <thead>
          <tr className="text-left text-[10px] tracking-wider text-ink-3 uppercase">
            <th className="py-1 pr-2 font-normal">Layer</th>
            <th className="py-1 pr-2 font-normal">Rule</th>
            <th className="py-1 pr-2 font-normal">Outcome</th>
            <th className="py-1 font-normal">Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={i} className={cn('border-t border-line-2 align-top', t.ruleId === verdict.decidingRuleId && 'bg-card-2')}>
              <td className="py-1 pr-2 text-ink-2">{t.layer}</td>
              <td className="max-w-[180px] truncate py-1 pr-2 text-ink" title={t.ruleId}>{t.ruleId}</td>
              <td className="py-1 pr-2">{t.outcome === 'not_applicable' ? <span className="text-ink-3">n/a</span> : t.outcome === 'waived' ? <Badge tone="lav">waived</Badge> : <Badge tone={DECISION_TONE[t.outcome] ?? 'neutral'}>{t.outcome}</Badge>}</td>
              <td className="py-1 font-sans text-[11.5px] text-ink-2">{t.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
