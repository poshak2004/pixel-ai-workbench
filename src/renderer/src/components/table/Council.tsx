import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SeatLive } from '../../lib/useRun';
import type { Role, Seat } from '../../lib/types';
import { Stamp } from '../ui/display';
import { SeatCard } from './SeatCard';

/**
 * The Table: council seats on top, feeding the Final Judge, feeding the deterministic Governor.
 * Drawn with hairline "bus" rules like a circuit on ruled paper.
 */
export function Council({
  seats,
  roles,
  live,
  modelLabel,
  onSeat,
  selectedSeat,
  onAdd,
  verdict,
  footer,
}: {
  seats: Seat[];
  roles: Map<string, Role>;
  live: Map<string, SeatLive>;
  modelLabel: (s: Seat) => string;
  onSeat?: (s: Seat) => void;
  selectedSeat?: string | null;
  onAdd?: () => void;
  verdict?: string | null;
  footer?: ReactNode;
}) {
  const judge = seats.find((s) => roles.get(s.spec.roleId)?.constitution.authority.canJudge);
  const council = seats.filter((s) => s !== judge);
  return (
    <div className="grid-paper relative rounded-[8px] border border-line px-6 pt-6 pb-5" data-testid="council">
      {onAdd ? (
        <button onClick={onAdd} className="absolute top-3 right-3 flex items-center gap-1 rounded-[5px] border border-dashed border-line bg-card/80 px-2 py-1 text-[11.5px] text-ink-2 hover:border-ink-3 hover:text-ink" aria-label="Add seat">
          <Plus size={12} /> Add seat
        </button>
      ) : null}
      <div className="flex flex-wrap items-start justify-center gap-x-4 gap-y-6">
        {council.map((s) => (
          <div key={s.id} className="relative flex flex-col items-center">
            <SeatCard seat={s} role={roles.get(s.spec.roleId)} live={live.get(s.id)} modelLabel={modelLabel(s)} onClick={() => onSeat?.(s)} selected={selectedSeat === s.id} weight={s.authority?.weight} />
            <div className="h-5 w-px bg-ink-3/50" />
          </div>
        ))}
      </div>
      {council.length ? <div className="mx-auto h-px bg-ink-3/50" style={{ width: `${Math.min(100, Math.max(20, council.length * 22))}%` }} /> : null}
      <div className="flex flex-col items-center">
        <div className="h-5 w-px bg-ink-3/50" />
        <div className="mb-1 font-mono text-[10px] tracking-[0.2em] text-ink-3">FINAL JUDGE</div>
        {judge ? (
          <SeatCard seat={judge} role={roles.get(judge.spec.roleId)} live={live.get(judge.id)} modelLabel={modelLabel(judge)} onClick={() => onSeat?.(judge)} selected={selectedSeat === judge.id} />
        ) : (
          <div className="rounded-[6px] border border-dashed border-verm/50 bg-verm-soft/40 px-4 py-6 text-center text-[12px] text-verm">No judge seat — add one. No agent may approve its own work.</div>
        )}
        <div className="h-5 w-px bg-ink-3/50" />
        <div className="flex items-center gap-3 rounded-[6px] border border-line bg-card px-4 py-2 shadow-paper" data-testid="governor">
          <span className="font-mono text-[10px] tracking-[0.2em] text-ink-3">GOVERNOR</span>
          <span className="text-[11.5px] text-ink-2">deterministic policy engine</span>
          {verdict ? <Stamp value={verdict} size="sm" /> : <span className="font-mono text-[10.5px] text-ink-3">awaiting</span>}
        </div>
      </div>
      {footer}
    </div>
  );
}
