import { cn } from '../../lib/cn';
import type { Judgment, RunEvent } from '../../lib/types';
import { Badge, Card, SectionTitle, Stamp } from '../ui/display';

interface Proposal {
  summary: string;
  approach: string;
  steps: string[];
  risks: { risk: string; mitigation: string }[];
  evidence: { source: string; detail: string }[];
  confidence: number;
}

/** The deliberation as a readable thread: proposals → challenges → rebuttals → resolutions → judgment. */
export function Debate({ events, judgments, seatName }: { events: RunEvent[]; judgments: Judgment[]; seatName: (id: string) => string }) {
  const proposals = events.filter((e) => e.type === 'agent.output' && e.payload.contract === 'proposal').map((e) => ({ seatId: e.seatId!, p: e.payload.output as Proposal }));
  const reviews = judgments.filter((j) => j.kind === 'review');
  const challenges = judgments.filter((j) => j.kind === 'challenge');
  const adj = judgments.find((j) => j.kind === 'adjudication');
  const byChallenge = (id: string | null, kind: string) => judgments.find((j) => j.challengeId === id && j.kind === kind);

  if (!proposals.length) return <div className="px-2 py-10 text-center text-[12.5px] text-ink-3">The debate appears here as agents produce work.</div>;
  return (
    <div className="flex flex-col gap-5 p-4" data-testid="debate">
      <div>
        <SectionTitle>Independent proposals</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          {proposals.map(({ seatId, p }) => (
            <Card key={seatId} className={cn('p-3', adj?.targetSeatId === seatId && 'border-lav')}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10.5px] font-semibold tracking-[0.12em] uppercase">{seatName(seatId)}</span>
                <span className="flex gap-1">
                  {adj?.targetSeatId === seatId ? <Badge tone="lav">selected</Badge> : null}
                  <Badge>conf {p.confidence.toFixed(2)}</Badge>
                </span>
              </div>
              <div className="mt-1 text-[13px] font-medium">{p.summary}</div>
              <p className="mt-1 text-[12px] text-ink-2">{p.approach}</p>
              {p.steps.length ? (
                <ol className="mt-1.5 list-decimal pl-4 text-[12px] text-ink-2">
                  {p.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              ) : null}
              <div className="mt-2 font-mono text-[10.5px] text-ink-3">
                {p.evidence.length} evidence · {p.risks.length} risks
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {reviews
                  .filter((r) => r.targetSeatId === seatId)
                  .map((r) => (
                    <Badge key={r.id} tone={r.decision === 'approve' ? 'sage' : r.decision === 'reject' ? 'verm' : 'amber'}>
                      {seatName(r.judgeSeatId)}: {r.decision}
                    </Badge>
                  ))}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {challenges.length ? (
        <div>
          <SectionTitle>Cross-examination</SectionTitle>
          <div className="flex flex-col gap-2">
            {challenges.map((c) => {
              const reb = byChallenge(c.challengeId, 'rebuttal');
              const res = byChallenge(c.challengeId, 'resolution');
              const unsupported = c.decision === 'challenge_unsupported';
              return (
                <div key={c.id} className="rounded-[6px] border border-line bg-card" data-testid="challenge">
                  <div className="flex items-start gap-3 px-3 py-2">
                    <Badge tone={c.severity === 'critical' ? 'verm' : c.severity === 'major' ? 'peach' : 'neutral'}>{c.severity}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10.5px] text-ink-3">
                        {c.challengeId} · {seatName(c.judgeSeatId)} → {c.targetSeatId ? seatName(c.targetSeatId) : ''}
                        {unsupported ? <span className="ml-2 text-peach-ink">unsupported (no evidence) — cannot block</span> : null}
                      </div>
                      <div className="text-[12.5px] text-ink">{c.claim}</div>
                      {c.evidence.length ? <div className="mt-0.5 text-[11.5px] text-ink-3">evidence: {c.evidence.join('; ')}</div> : null}
                    </div>
                  </div>
                  {reb ? (
                    <div className="border-t border-line-2 bg-card-2 px-3 py-2 pl-10">
                      <div className="font-mono text-[10.5px] text-ink-3">
                        {seatName(reb.judgeSeatId)} responds · <span className="uppercase">{reb.decision}</span>
                      </div>
                      <div className="text-[12.5px] text-ink-2">{reb.claim}</div>
                    </div>
                  ) : null}
                  {res ? (
                    <div className="flex items-center gap-2 border-t border-line-2 px-3 py-1.5 pl-10">
                      <Badge tone={res.decision === 'resolved' ? 'sage' : 'verm'}>{res.decision}</Badge>
                      <span className="text-[12px] text-ink-2">{res.reasoningSummary}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {adj ? (
        <div>
          <SectionTitle>Adjudication</SectionTitle>
          <Card className="p-3">
            <div className="flex items-center gap-3">
              <Stamp value={adj.decision.toUpperCase()} />
              <div className="min-w-0 text-[12.5px]">
                <div className="font-medium">
                  {seatName(adj.judgeSeatId)} selected {adj.targetSeatId ? seatName(adj.targetSeatId) : 'none'} · confidence {adj.confidence?.toFixed(2)}
                </div>
                <div className="text-ink-2">{adj.reasoningSummary}</div>
              </div>
            </div>
            {adj.evidence.length ? (
              <ul className="mt-2 list-disc pl-5 text-[12px] text-ink-2">
                {adj.evidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
