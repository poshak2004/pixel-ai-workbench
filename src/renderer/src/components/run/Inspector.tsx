import { fmtCost, fmtMs } from '../../lib/format';
import { describeEvent } from '../../lib/useRun';
import type { ContextManifest, RunEvent, Verdict } from '../../lib/types';
import { Badge, KV, SectionTitle, Stamp } from '../ui/display';
import { ContextInspector } from './ContextInspector';
import { VerdictView } from './VerdictView';

function Json({ value }: { value: unknown }) {
  return <pre className="scroll-thin max-h-[420px] overflow-auto rounded-[5px] border border-line bg-card-2 p-2.5 font-mono text-[11px] whitespace-pre-wrap text-ink-2" data-selectable>{JSON.stringify(value, null, 2)}</pre>;
}

export function Inspector({ event, seatName }: { event: RunEvent | null; seatName: (id: string) => string }) {
  if (!event) return <div className="px-1 py-8 text-center text-[12px] text-ink-3">Select any event to inspect exactly what happened — context received, judgments, governance traces, tool calls.</div>;
  const d = describeEvent(event);
  const p = event.payload as Record<string, any>;
  return (
    <div className="flex flex-col gap-3" data-testid="inspector">
      <div>
        <div className="font-mono text-[10px] tracking-[0.14em] text-ink-3 uppercase">
          #{event.seq} · {event.type} · {new Date(event.ts).toLocaleTimeString()}
        </div>
        <div className="mt-0.5 text-[14px] font-semibold">
          {event.seatId ? seatName(event.seatId) : d.actor} → {d.verb}
        </div>
      </div>
      {event.type === 'agent.context' ? <ContextInspector manifest={p.manifest as ContextManifest} /> : null}
      {event.type === 'governance.decision' ? <VerdictView verdict={p.verdict as Verdict} /> : null}
      {event.type === 'judgment.recorded' ? (
        <div>
          <SectionTitle>Judgment</SectionTitle>
          <KV k="Kind" v={p.judgment.kind} />
          <KV k="Judge" v={seatName(p.judgment.judgeSeatId)} />
          <KV k="Target" v={p.judgment.targetSeatId ? seatName(p.judgment.targetSeatId) : '—'} />
          {p.judgment.challengeId ? <KV k="Challenge" v={p.judgment.challengeId} /> : null}
          {p.judgment.severity ? <KV k="Severity" v={<Badge tone={p.judgment.severity === 'critical' ? 'verm' : p.judgment.severity === 'major' ? 'peach' : 'neutral'}>{p.judgment.severity}</Badge>} /> : null}
          <KV k="Decision" v={p.judgment.decision} />
          <KV k="Confidence" v={p.judgment.confidence !== null ? Number(p.judgment.confidence).toFixed(2) : '—'} />
          <KV k="Model" v={`${p.judgment.model}`} />
          <KV k="Tokens" v={p.judgment.tokens} />
          <KV k="Tool calls" v={p.judgment.toolCalls} />
          <div className="mt-2 text-[12.5px] text-ink" data-selectable>
            <div className="font-mono text-[10px] tracking-wider text-ink-3 uppercase">Claim</div>
            {p.judgment.claim}
          </div>
          {p.judgment.reasoningSummary && p.judgment.reasoningSummary !== p.judgment.claim ? (
            <div className="mt-2 text-[12.5px] text-ink-2" data-selectable>
              <div className="font-mono text-[10px] tracking-wider text-ink-3 uppercase">Reasoning summary</div>
              {p.judgment.reasoningSummary}
            </div>
          ) : null}
          <div className="mt-2">
            <div className="font-mono text-[10px] tracking-wider text-ink-3 uppercase">Evidence</div>
            {p.judgment.evidence.length ? (
              <ul className="mt-0.5 list-disc pl-4 text-[12px] text-ink-2">
                {p.judgment.evidence.map((e: string, i: number) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : (
              <div className="text-[12px] text-peach-ink">None cited</div>
            )}
          </div>
          <p className="mt-2 text-[11px] text-ink-3">PIXEL stores structured conclusions and evidence, never hidden chain-of-thought.</p>
        </div>
      ) : null}
      {event.type === 'model.call' ? (
        <div>
          <KV k="Provider" v={p.usage.providerId} />
          <KV k="Model" v={p.usage.modelId} />
          <KV k="Phase" v={p.usage.phase} />
          <KV k="Input tokens" v={p.usage.inputTokens} />
          <KV k="Cached" v={p.usage.cachedInputTokens} />
          <KV k="Output tokens" v={p.usage.outputTokens} />
          <KV k="Reasoning tokens" v={p.usage.reasoningTokens || '—'} />
          <KV k="Latency" v={fmtMs(p.usage.latencyMs)} />
          <KV k="Est. cost" v={fmtCost(p.usage.costUsd)} />
          <KV k="Pricing source" v={p.usage.pricingSource ?? 'unknown'} />
        </div>
      ) : null}
      {event.type === 'tool.requested' || event.type === 'tool.result' ? <Json value={p} /> : null}
      {event.type === 'agent.output' ? (
        <div>
          <div className="mb-2 flex gap-2">
            <Badge tone="lav">{p.contract}</Badge>
            <Badge>{p.model}</Badge>
            <Badge>{p.tokens} tok</Badge>
            <Badge>{fmtMs(p.latencyMs)}</Badge>
            {p.attempts > 1 ? <Badge tone="amber">{p.attempts} attempts</Badge> : null}
          </div>
          <Json value={p.output} />
        </div>
      ) : null}
      {event.type === 'approval.requested' || event.type === 'approval.resolved' ? <Json value={p} /> : null}
      {event.type === 'run.completed' ? <Stamp value={String(p.outcome ?? 'completed').split(':')[0]!} /> : null}
      {!['agent.context', 'governance.decision', 'judgment.recorded', 'model.call', 'tool.requested', 'tool.result', 'agent.output', 'approval.requested', 'approval.resolved'].includes(event.type) ? <Json value={p} /> : null}
    </div>
  );
}
