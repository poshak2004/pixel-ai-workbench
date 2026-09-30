import type { Role } from '../../lib/types';
import { Badge } from '../ui/display';

export function ConstitutionView({ role, compact }: { role: Role; compact?: boolean }) {
  const c = role.constitution;
  const block = (title: string, items: string[]) =>
    items.length ? (
      <div className="mt-2">
        <div className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">{title}</div>
        <ul className="mt-0.5 space-y-0.5">
          {items.map((i, n) => (
            <li key={n} className="flex gap-1.5 text-[12px] text-ink-2">
              <span className="mt-[6px] h-[3px] w-[3px] shrink-0 bg-ink-3" />
              {i}
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="rounded-[5px] border border-line bg-card-2 p-3" data-selectable>
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[11px] font-semibold tracking-[0.12em] uppercase">Role: {role.name}</div>
        <div className="flex gap-1">
          {role.builtIn ? <Badge>built-in</Badge> : <Badge tone="lav">custom v{role.version}</Badge>}
          {c.authority.blockAt !== 'none' ? <Badge tone="verm">veto ≥ {c.authority.blockAt}</Badge> : null}
          {c.authority.canJudge ? <Badge tone="lav">judge</Badge> : null}
          <Badge tone="blue">w {c.authority.weight}</Badge>
        </div>
      </div>
      <div className="mt-2 text-[12.5px] text-ink">
        <span className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">Mission </span>
        {c.mission}
      </div>
      {block('Responsibilities', c.responsibilities)}
      {!compact && block('Challenge rules', c.challengeRules)}
      {!compact && block('Decision rules', c.decisionRules)}
      {!compact && block('Escalation rules', c.escalationRules)}
      <div className="mt-2 flex flex-wrap gap-1">
        {c.allowedActions.map((a) => (
          <Badge key={a} tone="sage">{a}</Badge>
        ))}
        {c.forbiddenActions.map((a) => (
          <Badge key={a} tone="verm">¬ {a}</Badge>
        ))}
      </div>
      <div className="mt-2 font-mono text-[10.5px] text-ink-3">
        evidence: challenges {c.evidenceStandard.challengesRequireEvidence ? 'required' : 'optional'} · approvals {c.evidenceStandard.approvalsRequireEvidence ? 'required' : 'optional'} · min/proposal {c.evidenceStandard.minProposalEvidence} · output {c.outputSchema}
      </div>
    </div>
  );
}
