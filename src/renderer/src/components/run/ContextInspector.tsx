import { useState } from 'react';
import { cn } from '../../lib/cn';
import type { ContextManifest } from '../../lib/types';
import { Badge } from '../ui/display';

const KIND_TONE: Record<string, 'sage' | 'blue' | 'lav' | 'peach' | 'verm' | 'amber' | 'neutral'> = {
  platform_rules: 'verm',
  governance: 'amber',
  constitution: 'lav',
  agent_rules: 'blue',
  permissions: 'sage',
  output_contract: 'neutral',
  phase: 'neutral',
  task: 'peach',
  peer_work: 'blue',
  memory: 'lav',
  files: 'sage',
};

const KIND_BG: Record<string, string> = {
  verm: 'bg-verm',
  amber: 'bg-amber',
  lav: 'bg-lav',
  blue: 'bg-blue',
  sage: 'bg-sage',
  peach: 'bg-peach',
  neutral: 'bg-line',
};

/** What the agent actually received, section by section, with provenance and token share. */
export function ContextInspector({ manifest }: { manifest: ContextManifest }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div data-testid="context-inspector">
      <div className="mb-2 flex items-center justify-between font-mono text-[10.5px] text-ink-3">
        <span>{manifest.sections.length} sections · ≈{manifest.totalTokens.toLocaleString()} tokens</span>
        <span title="Constitution hash">const {manifest.constitutionHash.slice(0, 10)}</span>
      </div>
      <div className="mb-3 flex h-[8px] overflow-hidden rounded-[2px]">
        {manifest.sections.map((s, i) => (
          <div key={i} title={`${s.title}: ${s.tokens} tokens`} className={cn('h-full border-r border-card', KIND_BG[KIND_TONE[s.kind] ?? 'neutral'])} style={{ width: `${(s.tokens / Math.max(1, manifest.totalTokens)) * 100}%` }} />
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {manifest.sections.map((s, i) => (
          <div key={i} className="rounded-[5px] border border-line bg-card">
            <button className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left" onClick={() => setOpen(open === i ? null : i)}>
              <Badge tone={KIND_TONE[s.kind] ?? 'neutral'}>{s.placement}</Badge>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{s.title}</span>
              <span className="font-mono text-[10px] text-ink-3">{s.tokens} tok</span>
            </button>
            <div className="border-t border-line-2 px-2.5 py-1 font-mono text-[10px] text-ink-3">source: {s.source}</div>
            {open === i ? <pre className="scroll-thin max-h-[320px] overflow-auto border-t border-line-2 bg-card-2 px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap text-ink-2" data-selectable>{s.content}</pre> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
