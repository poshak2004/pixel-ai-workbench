import { Gavel, Shield } from 'lucide-react';
import { cn } from '../../lib/cn';
import { fmtMs, fmtTokens } from '../../lib/format';
import type { SeatLive } from '../../lib/useRun';
import type { Role, Seat } from '../../lib/types';
import { StatusDot } from '../ui/display';

export function seatTone(role: Role | undefined) {
  const a = role?.constitution.authority;
  if (!a) return 'bg-line';
  if (a.canJudge) return 'bg-lav';
  if (a.blockAt !== 'none') return 'bg-verm';
  if (a.canPropose) return 'bg-blue';
  return 'bg-peach';
}

export function SeatCard({ seat, role, live, modelLabel, onClick, selected, weight }: { seat: Seat; role?: Role; live?: SeatLive; modelLabel: string; onClick?: () => void; selected?: boolean; weight?: number }) {
  const a = role?.constitution.authority;
  const status = live?.status ?? 'idle';
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`seat-${seat.id}`}
      className={cn('group relative w-[208px] overflow-hidden rounded-[6px] border bg-card text-left shadow-paper transition-all hover:-translate-y-[1px] hover:border-ink-3/60', selected ? 'border-ink' : 'border-line')}
    >
      <div className={cn('h-[4px]', seatTone(role))} />
      <div className="px-3 pt-2 pb-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <StatusDot status={status} />
            <span className="truncate font-mono text-[10.5px] font-semibold tracking-[0.12em] text-ink-2 uppercase">{role?.name ?? seat.spec.roleId}</span>
          </span>
          <span className="flex items-center gap-1 text-ink-3">
            {a?.blockAt && a.blockAt !== 'none' ? <Shield size={11} className="text-verm" aria-label={`Veto at ${a.blockAt}`} /> : null}
            {a?.canJudge ? <Gavel size={11} className="text-lav-ink" aria-label="Judge" /> : null}
            <span className="font-mono text-[10px]">w{weight ?? a?.weight ?? 1}</span>
          </span>
        </div>
        <div className="mt-1 truncate text-[13.5px] font-medium text-ink">{seat.spec.name}</div>
        <div className="truncate font-mono text-[10.5px] text-ink-3" title={modelLabel}>
          {modelLabel}
        </div>
        <div className="rule-dotted my-2" />
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-[2px] font-mono text-[10.5px]">
          <dt className="text-ink-3">STATUS</dt>
          <dd className="truncate text-right text-ink-2">
            {status}
            {live?.phase && status !== 'idle' && status !== 'done' ? ` · ${live.phase.toLowerCase()}` : ''}
          </dd>
          <dt className="text-ink-3">AUTHORITY</dt>
          <dd className="truncate text-right text-ink-2">{a ? [a.canPropose && 'propose', a.canCritique && 'review', a.canJudge && 'judge', a.blockAt !== 'none' && `veto≥${a.blockAt}`].filter(Boolean).join(' ') : '—'}</dd>
          <dt className="text-ink-3">LAST</dt>
          <dd className="truncate text-right text-ink">{live?.lastDecision ?? '—'}</dd>
          <dt className="text-ink-3">CONF</dt>
          <dd className="text-right text-ink">{live?.confidence !== null && live?.confidence !== undefined ? live.confidence.toFixed(2) : '—'}</dd>
          <dt className="text-ink-3">TOKENS</dt>
          <dd className="text-right text-ink-2">{live?.tokens ? fmtTokens(live.tokens) : '—'}</dd>
          <dt className="text-ink-3">LATENCY</dt>
          <dd className="text-right text-ink-2">{live?.latencyMs ? fmtMs(live.latencyMs) : '—'}</dd>
        </dl>
      </div>
    </button>
  );
}
