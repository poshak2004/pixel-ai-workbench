import { buildContext, constitutionHash } from '../agents/context';
import { AgentRunner, GovernanceHaltError, RunLedger, type ModelResolver } from '../agents/runner';
import type { Adjudication, Proposal, ReviewOutput, Severity } from '../evaluation/contracts';
import type { ApprovalGate } from '../governance/approvals';
import { GovernanceEngine } from '../governance/engine';
import type { DecisionSummary, GovernanceVerdict, Policy } from '../governance/types';
import type { Role } from '../roles/types';
import type { RunJournal } from '../runs/journal';
import { intersectGrants, DEFAULT_GRANT } from '../security/permissions';
import { ToolExecutor, type SeatRuntime } from '../tools/executor';
import type { ToolRegistry } from '../tools/types';
import { AbortError } from '../util/runtime';
import { tablePolicy } from './policy';
import type { Seat, Table } from './types';
import { effectiveAuthority, validateTable } from './validate';

export type TableOutcome = 'approved' | 'blocked' | 'rejected' | 'revise' | 'failed' | 'cancelled';

export interface ChallengeState {
  id: string;
  bySeatId: string;
  targetSeatId: string;
  claim: string;
  severity: Severity;
  evidence: string[];
  supported: boolean;
  rebuttal: { stance: 'concede' | 'dispute' | 'mitigate'; response: string; evidence: string[] } | null;
  status: 'open' | 'resolved' | 'unresolved' | 'escalated';
  resolutionReason: string | null;
}

export interface ReviewState {
  reviewerSeatId: string;
  targetSeatId: string;
  verdict: 'approve' | 'reject' | 'abstain' | 'request_evidence';
  confidence: number;
  summary: string;
  weight: number;
}

export interface TableRunResult {
  outcome: TableOutcome;
  proposals: Record<string, Proposal>;
  reviews: ReviewState[];
  challenges: ChallengeState[];
  adjudication: Adjudication | null;
  summary: DecisionSummary | null;
  verdict: GovernanceVerdict | null;
  finalArtifactId: string | null;
  error: string | null;
}

export interface TableRunInput {
  table: Table;
  roles: Map<string, Role>;
  task: string;
  /** Safety/system/project/role/agent/task policies. The table layer is derived from the table. */
  policies: Policy[];
  workspaceRoot: string | null;
  /** Upper bound on any seat's permissions for this run (project/workspace ceiling). */
  permissionCeiling?: typeof DEFAULT_GRANT;
  signal?: AbortSignal;
  workflowId?: string | null;
}

export interface TableRunDeps {
  resolver: ModelResolver;
  tools: ToolRegistry;
  approvals: ApprovalGate;
  journal: RunJournal;
}

interface SeatCtx extends SeatRuntime {
  seat: Seat;
  authority: ReturnType<typeof effectiveAuthority>;
  hash: string;
}

/**
 * Executes the Table of Agents deliberation protocol:
 *   PROPOSE (independent, parallel) → REVIEW (blind, cross) → REBUTTAL → RESOLUTION → ADJUDICATION → GOVERNANCE
 * Model output is advisory; the deterministic governance engine makes the final call.
 */
export class TableExecutor {
  constructor(private readonly deps: TableRunDeps) {}

  async run(input: TableRunInput): Promise<TableRunResult> {
    const { table, task, signal } = input;
    const journal = this.deps.journal;
    const result: TableRunResult = { outcome: 'failed', proposals: {}, reviews: [], challenges: [], adjudication: null, summary: null, verdict: null, finalArtifactId: null, error: null };

    // Freeze role snapshots: constitutions are immutable for the lifetime of the run.
    const roles = new Map([...input.roles].map(([id, r]) => [id, deepFreeze(structuredClone(r))]));
    const validation = validateTable(table, roles);
    if (!validation.ok) {
      result.error = validation.errors.join('; ');
      journal.event('run.failed', { reason: 'invalid_table', errors: validation.errors });
      return result;
    }

    const governance = new GovernanceEngine([...input.policies, tablePolicy(table)]);
    const ledger = new RunLedger();
    const tools = new ToolExecutor(this.deps.tools, governance, this.deps.approvals, journal, input.workspaceRoot);
    const runner = new AgentRunner(this.deps.resolver, governance, tools, journal, ledger);
    const ceiling = input.permissionCeiling;

    const seats: SeatCtx[] = [...table.seats]
      .sort((a, b) => a.order - b.order)
      .map((seat) => {
        const role = roles.get(seat.spec.roleId)!;
        return {
          seat,
          seatId: seat.id,
          role,
          spec: seat.spec,
          grant: ceiling ? intersectGrants(seat.spec.permissions, ceiling) : seat.spec.permissions,
          authority: effectiveAuthority(role, seat),
          hash: constitutionHash(role),
        };
      });
    const bySeat = new Map(seats.map((s) => [s.seatId, s]));
    let integrityOk = true;
    const governanceSummary = governance.summarize();

    journal.event('run.started', {
      tableId: table.id,
      tableName: table.name,
      task,
      policyHash: governance.policyHash,
      warnings: validation.warnings,
      seats: seats.map((s) => ({ seatId: s.seatId, name: s.spec.name, role: s.role.name, roleId: s.role.id, providerId: s.spec.model.providerId, model: s.spec.model.modelId, authority: s.authority, constitutionHash: s.hash })),
    });

    const verifyIntegrity = (s: SeatCtx) => {
      if (constitutionHash(s.role) !== s.hash) {
        integrityOk = false;
        journal.event('constitution.violation', { kind: 'integrity', message: 'Constitution changed during run' }, s.seatId);
      }
    };

    const invoke = async <N extends 'proposal' | 'review' | 'rebuttal' | 'resolution' | 'adjudication'>(
      s: SeatCtx,
      contract: N,
      phase: { name: string; instructions: string },
      peerWork: { title: string; source: string; content: string }[] = [],
    ) => {
      verifyIntegrity(s);
      const manifest = buildContext({
        role: s.role,
        spec: s.spec,
        seatId: s.seatId,
        task,
        phase: { name: phase.name, instructions: `You are seat ${s.seatId} (${s.role.name}).\n${phase.instructions}` },
        contract,
        governanceSummary,
        permissions: s.grant,
        peerWork,
      });
      return runner.invoke<N>({ seat: s, manifest, contract, phase: phase.name, tableId: table.id, workflowId: input.workflowId ?? null, signal });
    };

    try {
      // ── Phase 1: independent proposals ──────────────────────────────────────────────
      const proposers = seats.filter((s) => s.authority.canPropose);
      journal.event('phase.started', { phase: 'propose', seats: proposers.map((s) => s.seatId) });
      const proposalRuns = await mapLimit(proposers, table.protocol.maxConcurrency, async (s) => {
        try {
          const r = await invoke(s, 'proposal', { name: 'PROPOSE', instructions: 'Work independently. You cannot see other seats. Produce your best proposal for the task, citing evidence.' });
          return { s, r };
        } catch (err) {
          if (isAbort(err, signal)) throw err;
          journal.event('agent.error', { phase: 'propose', message: (err as Error).message, fatal: false }, s.seatId);
          return { s, r: null };
        }
      });
      for (const { s, r } of proposalRuns) {
        if (!r) continue;
        const p = r.output as Proposal;
        result.proposals[s.seatId] = p;
        const min = s.role.constitution.evidenceStandard.minProposalEvidence;
        if (p.evidence.length < min) {
          journal.event('constitution.violation', { kind: 'evidence_standard', message: `Proposal cites ${p.evidence.length} evidence item(s); constitution requires ${min}` }, s.seatId);
        }
        journal.artifact({ seatId: s.seatId, kind: 'proposal', title: `${s.spec.name}: ${p.summary.slice(0, 80)}`, mimeType: 'application/json', content: JSON.stringify(p, null, 2) });
      }
      journal.event('phase.completed', { phase: 'propose', produced: Object.keys(result.proposals).length });
      if (Object.keys(result.proposals).length === 0) throw new Error('No seat produced a valid proposal');

      const proposalDoc = (seatId: string) => {
        const s = bySeat.get(seatId)!;
        return { title: `${seatId} (${s.role.name})`, source: `run:proposal:${seatId}`, content: '```json\n' + JSON.stringify({ seatId, role: s.role.name, ...result.proposals[seatId] }) + '\n```' };
      };

      // ── Phase 2: blind cross-review ─────────────────────────────────────────────────
      if (table.protocol.critique) {
        const reviewers = seats.filter((s) => s.authority.canCritique);
        journal.event('phase.started', { phase: 'review', seats: reviewers.map((s) => s.seatId) });
        const reviewRuns = await mapLimit(reviewers, table.protocol.maxConcurrency, async (s) => {
          const targets = Object.keys(result.proposals).filter((id) => id !== s.seatId);
          if (targets.length === 0) return { s, targets, r: null };
          try {
            const r = await invoke(
              s,
              'review',
              {
                name: 'REVIEW',
                instructions: `Review each proposal independently against your constitution. Review exactly these targetSeatIds: ${targets.join(', ')}. You cannot see other reviewers' verdicts. Raise challenges with evidence; do not defer to the author's confidence.`,
              },
              targets.map(proposalDoc),
            );
            return { s, targets, r };
          } catch (err) {
            if (isAbort(err, signal)) throw err;
            journal.event('agent.error', { phase: 'review', message: (err as Error).message, fatal: false }, s.seatId);
            return { s, targets, r: null };
          }
        });

        let challengeSeq = 0;
        for (const { s, targets, r } of reviewRuns) {
          if (!r) continue;
          const output = r.output as ReviewOutput;
          const std = s.role.constitution.evidenceStandard;
          for (const review of output.reviews) {
            if (!targets.includes(review.targetSeatId)) {
              journal.event('constitution.violation', { kind: 'review_target', message: `Review of ${review.targetSeatId} ignored: not an eligible target (self-review or unknown seat)` }, s.seatId);
              continue;
            }
            let verdict = review.verdict;
            if (verdict === 'approve' && std.approvalsRequireEvidence && review.evidence.length === 0) {
              verdict = 'abstain';
              journal.event('constitution.violation', { kind: 'evidence_standard', message: `Approval of ${review.targetSeatId} without evidence downgraded to abstain` }, s.seatId);
            }
            result.reviews.push({ reviewerSeatId: s.seatId, targetSeatId: review.targetSeatId, verdict, confidence: review.confidence, summary: review.summary, weight: s.authority.weight });
            journal.judgment({
              kind: 'review',
              judgeSeatId: s.seatId,
              targetSeatId: review.targetSeatId,
              challengeId: null,
              claim: review.summary || `Review of ${review.targetSeatId}`,
              evidence: review.evidence.map((e) => `${e.source}: ${e.detail}`),
              reasoningSummary: review.summary,
              confidence: review.confidence,
              decision: verdict,
              severity: null,
              providerId: r.providerId,
              model: r.model,
              tokens: r.tokens,
              toolCalls: r.toolCalls,
            });
            for (const c of review.challenges) {
              const supported = !(std.challengesRequireEvidence && (c.severity === 'major' || c.severity === 'critical') && c.evidence.length === 0);
              const ch: ChallengeState = {
                id: `ch-${++challengeSeq}`,
                bySeatId: s.seatId,
                targetSeatId: review.targetSeatId,
                claim: c.claim,
                severity: c.severity,
                evidence: c.evidence,
                supported,
                rebuttal: null,
                status: 'open',
                resolutionReason: null,
              };
              result.challenges.push(ch);
              if (!supported) {
                journal.event('constitution.violation', { kind: 'evidence_standard', challengeId: ch.id, message: `${c.severity} challenge without evidence recorded as unsupported; it cannot block` }, s.seatId);
              }
              journal.judgment({
                kind: 'challenge',
                judgeSeatId: s.seatId,
                targetSeatId: review.targetSeatId,
                challengeId: ch.id,
                claim: c.claim,
                evidence: c.evidence,
                reasoningSummary: c.question ?? '',
                confidence: review.confidence,
                decision: supported ? 'challenge' : 'challenge_unsupported',
                severity: c.severity,
                providerId: r.providerId,
                model: r.model,
                tokens: 0,
                toolCalls: 0,
              });
            }
          }
        }
        journal.event('phase.completed', { phase: 'review', reviews: result.reviews.length, challenges: result.challenges.length });
      }

      // ── Phase 3: rebuttal by authors ────────────────────────────────────────────────
      const actionable = result.challenges.filter((c) => c.severity !== 'info');
      if (table.protocol.rebuttal && actionable.length) {
        const authors = [...new Set(actionable.map((c) => c.targetSeatId))].map((id) => bySeat.get(id)!).filter(Boolean);
        journal.event('phase.started', { phase: 'rebuttal', seats: authors.map((s) => s.seatId) });
        await mapLimit(authors, table.protocol.maxConcurrency, async (s) => {
          const mine = actionable.filter((c) => c.targetSeatId === s.seatId);
          try {
            const r = await invoke(
              s,
              'rebuttal',
              { name: 'REBUTTAL', instructions: 'Respond to each challenge against your proposal: concede, dispute with evidence, or describe a concrete mitigation. Use the exact challengeId values.' },
              [
                proposalDoc(s.seatId),
                { title: 'CHALLENGES AGAINST YOUR PROPOSAL', source: 'run:challenges', content: '```json\n' + JSON.stringify(mine.map(({ id, claim, severity, evidence, bySeatId }) => ({ challengeId: id, fromSeat: bySeatId, severity, claim, evidence }))) + '\n```' },
              ],
            );
            for (const resp of r.output.responses) {
              const ch = mine.find((c) => c.id === resp.challengeId);
              if (!ch) continue;
              ch.rebuttal = { stance: resp.stance, response: resp.response, evidence: resp.evidence };
              journal.judgment({
                kind: 'rebuttal',
                judgeSeatId: s.seatId,
                targetSeatId: ch.bySeatId,
                challengeId: ch.id,
                claim: resp.response,
                evidence: resp.evidence,
                reasoningSummary: resp.response,
                confidence: null,
                decision: resp.stance,
                severity: ch.severity,
                providerId: r.providerId,
                model: r.model,
                tokens: r.tokens,
                toolCalls: r.toolCalls,
              });
            }
          } catch (err) {
            if (isAbort(err, signal)) throw err;
            journal.event('agent.error', { phase: 'rebuttal', message: (err as Error).message, fatal: false }, s.seatId);
          }
        });
        journal.event('phase.completed', { phase: 'rebuttal' });

        // ── Phase 4: challengers rule on the rebuttals ────────────────────────────────
        const contested = actionable.filter((c) => c.rebuttal && c.rebuttal.stance !== 'concede');
        const challengers = [...new Set(contested.map((c) => c.bySeatId))].map((id) => bySeat.get(id)!);
        if (challengers.length) {
          journal.event('phase.started', { phase: 'resolution', seats: challengers.map((s) => s.seatId) });
          await mapLimit(challengers, table.protocol.maxConcurrency, async (s) => {
            const mine = contested.filter((c) => c.bySeatId === s.seatId);
            try {
              const r = await invoke(
                s,
                'resolution',
                { name: 'RESOLUTION', instructions: 'For each of your challenges, decide whether the author’s response resolves it. Judge the evidence independently; do not accept a response merely because it is confident.' },
                [{ title: 'YOUR CHALLENGES AND THE AUTHORS’ RESPONSES', source: 'run:rebuttals', content: '```json\n' + JSON.stringify(mine.map((c) => ({ challengeId: c.id, targetSeat: c.targetSeatId, severity: c.severity, claim: c.claim, rebuttal: c.rebuttal }))) + '\n```' }],
              );
              for (const res of r.output.resolutions) {
                const ch = mine.find((c) => c.id === res.challengeId);
                if (!ch) continue;
                ch.status = res.outcome === 'resolved' ? 'resolved' : res.outcome === 'escalate' ? 'escalated' : 'unresolved';
                ch.resolutionReason = res.reason;
                journal.judgment({
                  kind: 'resolution',
                  judgeSeatId: s.seatId,
                  targetSeatId: ch.targetSeatId,
                  challengeId: ch.id,
                  claim: ch.claim,
                  evidence: [],
                  reasoningSummary: res.reason,
                  confidence: null,
                  decision: res.outcome,
                  severity: ch.severity,
                  providerId: r.providerId,
                  model: r.model,
                  tokens: r.tokens,
                  toolCalls: r.toolCalls,
                });
              }
            } catch (err) {
              if (isAbort(err, signal)) throw err;
              journal.event('agent.error', { phase: 'resolution', message: (err as Error).message, fatal: false }, s.seatId);
            }
          });
          journal.event('phase.completed', { phase: 'resolution' });
        }
      }
      for (const c of result.challenges) if (c.status === 'open') c.status = c.severity === 'info' ? 'resolved' : 'unresolved';

      // ── Phase 5: adjudication ───────────────────────────────────────────────────────
      const judge = seats.find((s) => s.authority.canJudge)!;
      journal.event('phase.started', { phase: 'adjudicate', seats: [judge.seatId] });
      const reviewDigest = result.reviews.map((r) => ({ reviewer: r.reviewerSeatId, target: r.targetSeatId, verdict: r.verdict, confidence: r.confidence, weight: r.weight, summary: r.summary }));
      const challengeDigest = result.challenges.map((c) => ({ challengeId: c.id, from: c.bySeatId, target: c.targetSeatId, severity: c.severity, supported: c.supported, claim: c.claim, evidence: c.evidence, rebuttal: c.rebuttal, status: c.status, resolution: c.resolutionReason }));
      const j = await invoke(
        judge,
        'adjudication',
        {
          name: 'ADJUDICATE',
          instructions: `Decide on the evidence. selectedSeatId must be one of: ${Object.keys(result.proposals).join(', ')} (or null to reject all). Weigh challenges by evidence, not by count. finalAnswer is the deliverable the user receives.`,
        },
        [
          ...Object.keys(result.proposals).map(proposalDoc),
          { title: 'REVIEWS', source: 'run:reviews', content: '```json\n' + JSON.stringify(reviewDigest) + '\n```' },
          { title: 'CHALLENGES', source: 'run:challenges', content: '```json\n' + JSON.stringify(challengeDigest) + '\n```' },
        ],
      );
      let adj = j.output;
      if (adj.selectedSeatId && !(adj.selectedSeatId in result.proposals)) {
        journal.event('constitution.violation', { kind: 'adjudication', message: `Judge selected ${adj.selectedSeatId}, which has no proposal; treated as escalation` }, judge.seatId);
        adj = { ...adj, selectedSeatId: null, decision: 'escalate' };
      }
      result.adjudication = adj;
      journal.judgment({
        kind: 'adjudication',
        judgeSeatId: judge.seatId,
        targetSeatId: adj.selectedSeatId,
        challengeId: null,
        claim: adj.rationale,
        evidence: adj.evidence.map((e) => `${e.source}: ${e.detail}`),
        reasoningSummary: adj.rationale,
        confidence: adj.confidence,
        decision: adj.decision,
        severity: null,
        providerId: j.providerId,
        model: j.model,
        tokens: j.tokens,
        toolCalls: j.toolCalls,
      });
      journal.event('phase.completed', { phase: 'adjudicate', decision: adj.decision });

      // ── Phase 6: deterministic governance ───────────────────────────────────────────
      const selected = adj.selectedSeatId;
      const relevantReviews = result.reviews.filter((r) => r.targetSeatId === selected && r.verdict !== 'abstain');
      const totalWeight = relevantReviews.reduce((n, r) => n + r.weight, 0);
      const approveWeight = relevantReviews.filter((r) => r.verdict === 'approve').reduce((n, r) => n + r.weight, 0);
      const summary: DecisionSummary = {
        judgeSeatId: judge.seatId,
        judgeDecision: adj.decision,
        judgeConfidence: adj.confidence,
        judgeEvidenceCount: adj.evidence.length,
        selectedSeatId: selected,
        unresolved: result.challenges
          .filter((c) => (selected ? c.targetSeatId === selected : true) && (c.status === 'unresolved' || c.status === 'escalated'))
          .map((c) => ({ challengeId: c.id, bySeatId: c.bySeatId, severity: c.severity, supported: c.supported, blockAt: bySeat.get(c.bySeatId)!.authority.blockAt, claim: c.claim })),
        approvalWeight: totalWeight > 0 ? approveWeight / totalWeight : 0,
        authorProviderId: selected ? bySeat.get(selected)!.spec.model.providerId : null,
        reviewerProviderIds: [...new Set(relevantReviews.map((r) => bySeat.get(r.reviewerSeatId)!.spec.model.providerId))],
        integrityOk,
        costUsd: ledger.costUsd,
        tokens: ledger.tokens,
      };
      seats.forEach(verifyIntegrity);
      summary.integrityOk = integrityOk;
      result.summary = summary;

      const verdict = governance.evaluate({ kind: 'final_decision', summary });
      result.verdict = verdict;
      journal.event('governance.decision', { subject: 'final_decision', verdict, summary });

      const final = journal.artifact({
        seatId: judge.seatId,
        kind: 'final_result',
        title: `Final result — ${verdict.decision}`,
        mimeType: 'text/markdown',
        content: renderFinal(task, adj, verdict, selected ? bySeat.get(selected)!.spec.name : null),
      });
      result.finalArtifactId = final.id;

      result.outcome = await this.applyVerdict(verdict, journal, signal);
      return result;
    } catch (err) {
      if (isAbort(err, signal)) {
        result.outcome = 'cancelled';
        result.error = 'Cancelled';
        return result;
      }
      result.outcome = err instanceof GovernanceHaltError && err.decision === 'BLOCK' ? 'blocked' : 'failed';
      result.error = (err as Error).message;
      return result;
    }
  }

  private async applyVerdict(verdict: GovernanceVerdict, journal: RunJournal, signal?: AbortSignal): Promise<TableOutcome> {
    switch (verdict.decision) {
      case 'ALLOW':
        return 'approved';
      case 'BLOCK':
        return 'blocked';
      case 'RETRY':
      case 'REROUTE':
      case 'WAIT':
        return 'revise';
      case 'ESCALATE': {
        const request = { runId: journal.runId, seatId: null, kind: 'final_decision' as const, title: 'Final decision needs a human', reason: verdict.reason, detail: { decidingLayer: verdict.decidingLayer, rule: verdict.decidingRuleId } };
        journal.event('approval.requested', { request });
        const res = await this.deps.approvals.request(request, signal);
        journal.event('approval.resolved', { kind: 'final_decision', resolution: res });
        return res.decision === 'approved' ? 'approved' : 'rejected';
      }
    }
  }
}

function renderFinal(task: string, adj: Adjudication, verdict: GovernanceVerdict, author: string | null): string {
  return [
    `# Result`,
    ``,
    `**Task:** ${task}`,
    `**Governance:** ${verdict.decision}${verdict.decidingLayer ? ` (${verdict.decidingLayer}: ${verdict.reason})` : ''}`,
    `**Judge decision:** ${adj.decision} · confidence ${adj.confidence.toFixed(2)}${author ? ` · selected: ${author}` : ''}`,
    ``,
    `## Answer`,
    adj.finalAnswer,
    ``,
    `## Rationale`,
    adj.rationale,
    ...(adj.findings.length ? ['', '## Findings', ...adj.findings.map((f) => `- **${f.assessment}** — ${f.claim}${f.note ? ` (${f.note})` : ''}`)] : []),
    ...(adj.evidence.length ? ['', '## Evidence', ...adj.evidence.map((e) => `- ${e.source}: ${e.detail}`)] : []),
  ].join('\n');
}

function isAbort(err: unknown, signal?: AbortSignal) {
  return err instanceof AbortError || (err as Error)?.name === 'AbortError' || !!signal?.aborted;
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
  }
  return obj;
}
