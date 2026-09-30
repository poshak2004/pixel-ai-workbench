import { cn } from '../../lib/cn';
import { describeEvent } from '../../lib/useRun';
import type { RunEvent } from '../../lib/types';
import type { Tone } from '../ui/display';

const toneText: Record<Tone, string> = {
  neutral: 'text-ink-2',
  sage: 'text-sage-ink',
  blue: 'text-blue-ink',
  lav: 'text-lav-ink',
  peach: 'text-peach-ink',
  verm: 'text-verm',
  amber: 'text-amber-ink',
};

export const QUIET_EVENTS = new Set(['agent.context', 'model.call', 'phase.completed', 'artifact.created', 'tool.result']);

export function Timeline({ events, selected, onSelect, compact, seatName }: { events: RunEvent[]; selected?: string | null; onSelect?: (e: RunEvent) => void; compact?: boolean; seatName?: (id: string) => string }) {
  return (
    <ol className="font-mono text-[11.5px]" data-testid="timeline">
      {events.map((e) => {
        const d = describeEvent(e);
        const actor = e.seatId && seatName ? seatName(e.seatId) : d.actor;
        return (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onSelect?.(e)}
              className={cn('grid w-full grid-cols-[40px_128px_178px_1fr] items-baseline gap-2 border-b border-line-2 px-2 py-[5px] text-left hover:bg-card-2', selected === e.id && 'bg-lav-soft/60', compact && 'grid-cols-[112px_170px_1fr] py-[3px]')}
            >
              {!compact ? <span className="text-right text-[10px] text-ink-3 tabular-nums">{e.seq}</span> : null}
              <span className="truncate font-semibold tracking-wide text-ink uppercase">{actor}</span>
              <span className={cn('truncate', toneText[d.tone])}>→ {d.verb}</span>
              <span className="truncate font-sans text-[12px] text-ink-2">{d.detail}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
