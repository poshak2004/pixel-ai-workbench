import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type Tone = 'neutral' | 'sage' | 'blue' | 'lav' | 'peach' | 'verm' | 'amber';

const toneClass: Record<Tone, string> = {
  neutral: 'border-line bg-card-2 text-ink-2',
  sage: 'border-sage/40 bg-sage-soft text-sage-ink',
  blue: 'border-blue/40 bg-blue-soft text-blue-ink',
  lav: 'border-lav/40 bg-lav-soft text-lav-ink',
  peach: 'border-peach/50 bg-peach-soft text-peach-ink',
  verm: 'border-verm/40 bg-verm-soft text-verm',
  amber: 'border-amber/50 bg-amber-soft text-amber-ink',
};

export function Badge({ tone = 'neutral', children, className, mono = true }: { tone?: Tone; children: ReactNode; className?: string; mono?: boolean }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-[1px] text-[10.5px] leading-[16px] whitespace-nowrap', mono && 'font-mono tracking-wide uppercase', toneClass[tone], className)}>{children}</span>;
}

/** Governance decision → hanko-style stamp. */
export const DECISION_TONE: Record<string, Tone> = {
  ALLOW: 'sage',
  BLOCK: 'verm',
  ESCALATE: 'amber',
  WAIT: 'blue',
  RETRY: 'lav',
  REROUTE: 'lav',
  approved: 'sage',
  blocked: 'verm',
  rejected: 'verm',
  revise: 'lav',
  failed: 'verm',
  cancelled: 'neutral',
  completed: 'sage',
};

const stampColor: Record<Tone, string> = {
  neutral: 'text-ink-3',
  sage: 'text-sage-ink',
  blue: 'text-blue-ink',
  lav: 'text-lav-ink',
  peach: 'text-peach-ink',
  verm: 'text-verm',
  amber: 'text-amber-ink',
};

export function Stamp({ value, size = 'md', className }: { value: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const tone = DECISION_TONE[value] ?? 'neutral';
  return (
    <span
      className={cn(
        'stamp inline-flex items-center justify-center font-bold uppercase',
        stampColor[tone],
        size === 'sm' && 'px-1.5 py-[1px] text-[10px]',
        size === 'md' && 'px-2.5 py-[3px] text-[12px]',
        size === 'lg' && 'px-4 py-1.5 text-[18px]',
        className,
      )}
    >
      {value}
    </span>
  );
}

export type SeatStatus = 'idle' | 'thinking' | 'tool' | 'done' | 'error' | 'waiting';

export function StatusDot({ status, className }: { status: SeatStatus | string; className?: string }) {
  const color =
    status === 'thinking' || status === 'running' ? 'bg-blue' : status === 'tool' ? 'bg-lav' : status === 'done' || status === 'completed' ? 'bg-sage' : status === 'error' || status === 'failed' ? 'bg-verm' : status === 'waiting' || status === 'awaiting_approval' ? 'bg-amber' : 'bg-line';
  const blink = status === 'thinking' || status === 'tool' || status === 'running' || status === 'awaiting_approval' || status === 'waiting';
  return <span className={cn('inline-block h-[7px] w-[7px] shrink-0', color, blink && 'pixel-blink', className)} aria-label={String(status)} />;
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-[6px] border border-line bg-card shadow-paper', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2 flex items-center justify-between gap-2', className)}>
      <h3 className="font-mono text-[10.5px] font-semibold tracking-[0.14em] text-ink-3 uppercase">{children}</h3>
      {right}
    </div>
  );
}

export function PageHeader({ title, kicker, actions, children }: { title: ReactNode; kicker?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-5 flex items-end justify-between gap-6 border-b border-line pb-4">
      <div className="min-w-0">
        {kicker ? <div className="mb-1 font-mono text-[10.5px] tracking-[0.16em] text-ink-3 uppercase">{kicker}</div> : null}
        <h1 className="truncate text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {children ? <div className="mt-1 text-[12.5px] text-ink-2">{children}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function KV({ k, v, mono = true }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="font-mono text-[10.5px] tracking-wider text-ink-3 uppercase">{k}</span>
      <span className={cn('min-w-0 truncate text-right text-[12px] text-ink', mono && 'font-mono')}>{v}</span>
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">{label}</div>
      <div className={cn('font-mono text-[18px] leading-tight font-semibold tabular-nums', tone ? stampColor[tone] : 'text-ink')}>{value}</div>
      {sub ? <div className="font-mono text-[10.5px] text-ink-3">{sub}</div> : null}
    </div>
  );
}

export function Empty({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[6px] border border-dashed border-line px-6 py-10 text-center">
      {icon ?? <PixelGlyph />}
      <div className="text-[13.5px] font-medium text-ink">{title}</div>
      {children ? <div className="max-w-md text-[12px] text-ink-2">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="rounded-[5px] border border-verm/40 bg-verm-soft px-3 py-2 text-[12px] text-verm" role="alert">{children}</div>;
}

/** 5×5 pixel glyph used as the app mark and for empty states. */
export function PixelGlyph({ size = 20, className }: { size?: number; className?: string }) {
  const on = ['01110', '10001', '10101', '10001', '01110'];
  const colors = ['var(--sage)', 'var(--blue)', 'var(--lav)', 'var(--peach)'];
  return (
    <svg width={size} height={size} viewBox="0 0 5 5" className={className} shapeRendering="crispEdges" aria-hidden>
      {on.flatMap((row, y) => [...row].map((c, x) => (c === '1' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={colors[(x + y) % 4]} /> : null)))}
    </svg>
  );
}

export function PixelLogo() {
  const letters: Record<string, string[]> = {
    P: ['111', '101', '111', '100', '100'],
    I: ['111', '010', '010', '010', '111'],
    X: ['101', '101', '010', '101', '101'],
    E: ['111', '100', '110', '100', '111'],
    L: ['100', '100', '100', '100', '111'],
  };
  const word = 'PIXEL';
  const colors = ['var(--sage-ink)', 'var(--blue-ink)', 'var(--lav-ink)', 'var(--peach-ink)', 'var(--ink)'];
  return (
    <svg width={word.length * 16 - 4} height={20} viewBox={`0 0 ${word.length * 4 - 1} 5`} shapeRendering="crispEdges" aria-label="PIXEL">
      {[...word].flatMap((ch, i) => letters[ch]!.flatMap((row, y) => [...row].map((c, x) => (c === '1' ? <rect key={`${i}-${x}-${y}`} x={i * 4 + x} y={y} width={1} height={1} fill={colors[i]} /> : null))))}
    </svg>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[11.5px]', className)}>{children}</span>;
}

export function ProgressBar({ value, max, tone = 'blue' }: { value: number; max: number; tone?: Tone }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const bg: Record<Tone, string> = { neutral: 'bg-ink-3', sage: 'bg-sage', blue: 'bg-blue', lav: 'bg-lav', peach: 'bg-peach', verm: 'bg-verm', amber: 'bg-amber' };
  return (
    <div className="h-[6px] w-full overflow-hidden rounded-[2px] bg-paper-2">
      <div className={cn('h-full', bg[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
