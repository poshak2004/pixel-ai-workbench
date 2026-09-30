import { hashValue } from '../util/runtime';
import type { Severity } from '../evaluation/contracts';
import {
  decisionRank,
  layerRank,
  type Decision,
  type GovernanceVerdict,
  type GovernedAction,
  type Layer,
  type Policy,
  type Rule,
  type TraceEntry,
} from './types';

/**
 * Deterministic governance, outside the LLM. Agents recommend; this decides.
 *
 * Semantics:
 *  1. Every applicable rule in every layer yields a decision.
 *  2. The effective decision is the most restrictive one. Lower layers can therefore only
 *     tighten — a lower-layer rule can never produce a *less* restrictive outcome than a higher one.
 *  3. Ties between equally restrictive rules are attributed to the highest-precedence layer.
 *  4. The only way to relax a rule is a `waive` rule in a strictly higher-precedence layer.
 *     Safety rules cannot be waived. Invalid waivers are recorded as violations and ignored.
 *  5. No rules applicable ⇒ ALLOW.
 */
export class GovernanceEngine {
  private readonly policies: Policy[];
  readonly policyHash: string;

  constructor(policies: Policy[]) {
    // Stable order: by layer precedence, then declaration order.
    this.policies = [...policies].sort((a, b) => layerRank(a.layer) - layerRank(b.layer));
    this.policyHash = hashValue(this.policies);
  }

  evaluate(action: GovernedAction): GovernanceVerdict {
    const trace: TraceEntry[] = [];
    const { waived, violations } = this.resolveWaivers();

    let best: { decision: Decision; layer: Layer; ruleId: string; message: string } | null = null;

    for (const policy of this.policies) {
      for (const rule of policy.rules) {
        if (rule.type === 'waive') continue;
        if (!inScope(rule, action)) continue;
        const result = evaluateRule(rule, action);
        if (!result) {
          trace.push({ layer: policy.layer, policyId: policy.id, ruleId: rule.id, ruleType: rule.type, outcome: 'not_applicable', message: '' });
          continue;
        }
        if (waived.has(rule.id)) {
          trace.push({ layer: policy.layer, policyId: policy.id, ruleId: rule.id, ruleType: rule.type, outcome: 'waived', message: `${result.message} (waived by ${waived.get(rule.id)})` });
          continue;
        }
        trace.push({ layer: policy.layer, policyId: policy.id, ruleId: rule.id, ruleType: rule.type, outcome: result.decision, message: result.message });
        // Strictly greater only: equal-rank later entries come from equal/lower precedence layers.
        if (!best || decisionRank(result.decision) > decisionRank(best.decision)) {
          best = { decision: result.decision, layer: policy.layer, ruleId: rule.id, message: result.message };
        }
      }
    }

    if (!best) {
      return { decision: 'ALLOW', decidingLayer: null, decidingRuleId: null, reason: 'No governing rule applies', trace, violations, policyHash: this.policyHash };
    }
    return { decision: best.decision, decidingLayer: best.layer, decidingRuleId: best.ruleId, reason: best.message, trace, violations, policyHash: this.policyHash };
  }

  /** Human-readable summary of rules in force, for agent context. */
  summarize(): string[] {
    const lines: string[] = [];
    for (const p of this.policies) {
      for (const r of p.rules) {
        if (r.description) lines.push(`[${p.layer}] ${r.description}`);
      }
    }
    return lines;
  }

  private resolveWaivers() {
    const ruleLayer = new Map<string, Layer>();
    for (const p of this.policies) for (const r of p.rules) ruleLayer.set(r.id, p.layer);

    const waived = new Map<string, string>();
    const violations: string[] = [];
    for (const p of this.policies) {
      for (const r of p.rules) {
        if (r.type !== 'waive') continue;
        for (const target of r.ruleIds) {
          const targetLayer = ruleLayer.get(target);
          if (!targetLayer) {
            violations.push(`${p.layer}:${r.id} waives unknown rule ${target}`);
          } else if (targetLayer === 'safety') {
            violations.push(`${p.layer}:${r.id} attempted to waive safety rule ${target}`);
          } else if (layerRank(p.layer) >= layerRank(targetLayer)) {
            violations.push(`${p.layer}:${r.id} attempted to waive ${targetLayer} rule ${target}; only higher-precedence layers may waive`);
          } else {
            waived.set(target, `${p.layer}:${r.id}`);
          }
        }
      }
    }
    return { waived, violations };
  }
}

function inScope(rule: Rule, action: GovernedAction): boolean {
  if (!rule.scope) return true;
  if (action.kind === 'final_decision') return false;
  const { seatIds, roleIds } = rule.scope;
  if (seatIds && !seatIds.includes(action.seatId)) return false;
  if (roleIds && !roleIds.includes(action.roleId)) return false;
  return true;
}

const SEVERITY_ORDER: Severity[] = ['info', 'minor', 'major', 'critical'];
const atLeast = (s: Severity, threshold: Severity) => SEVERITY_ORDER.indexOf(s) >= SEVERITY_ORDER.indexOf(threshold);

type RuleResult = { decision: Decision; message: string } | null;

/** Pure function of (rule, action). Returns null when the rule does not apply to the action. */
export function evaluateRule(rule: Rule, action: GovernedAction): RuleResult {
  switch (rule.type) {
    case 'enforce_permissions': {
      if (action.kind !== 'tool_call') return null;
      const p = action.permission;
      if (p.outcome === 'denied') return { decision: 'BLOCK', message: `Permission denied for ${action.tool}: ${p.reason}` };
      if (p.outcome === 'approval') return { decision: 'ESCALATE', message: `${action.tool} requires human approval: ${p.reason}` };
      return { decision: 'ALLOW', message: `Permitted: ${p.reason}` };
    }
    case 'enforce_constitution': {
      if (action.kind === 'tool_call') {
        if (action.constitution.forbidden.includes(action.actionKind)) {
          return { decision: 'BLOCK', message: `Constitution forbids ${action.actionKind}` };
        }
        if (!action.constitution.allowed.includes(action.actionKind)) {
          return { decision: 'BLOCK', message: `${action.actionKind} is not among the role's allowed actions` };
        }
        return { decision: 'ALLOW', message: `Constitution allows ${action.actionKind}` };
      }
      if (action.kind === 'final_decision' && !action.summary.integrityOk) {
        return { decision: 'BLOCK', message: 'Constitution integrity check failed: a seat ran with an altered constitution' };
      }
      return null;
    }
    case 'deny_actions':
      if (action.kind !== 'tool_call' || !rule.actions.includes(action.actionKind)) return null;
      return { decision: rule.decision, message: rule.description || `${action.actionKind} is denied by policy` };
    case 'require_approval':
      if (action.kind !== 'tool_call' || !rule.actions.includes(action.actionKind)) return null;
      return { decision: 'ESCALATE', message: rule.description || `${action.actionKind} requires human approval` };
    case 'protect_paths': {
      if (action.kind !== 'tool_call' || !rule.actions.includes(action.actionKind)) return null;
      const matchers = rule.patterns.map(globToRegExp);
      const hit = action.paths.find((p) => matchers.some((m) => m.test(p)));
      return hit ? { decision: 'BLOCK', message: `Protected path: ${hit}` } : null;
    }
    case 'output_retry':
      if (action.kind !== 'agent_output' || action.valid) return null;
      return action.attempt < rule.maxAttempts
        ? { decision: 'RETRY', message: `Output violated contract (attempt ${action.attempt}/${rule.maxAttempts}): ${action.error ?? 'invalid'}` }
        : { decision: 'ESCALATE', message: `Output still invalid after ${action.attempt} attempts: ${action.error ?? 'invalid'}` };
    case 'budget': {
      const cost = action.kind === 'model_call' ? action.runCostUsd : action.kind === 'final_decision' ? action.summary.costUsd : null;
      const tokens = action.kind === 'model_call' ? action.runTokens : action.kind === 'final_decision' ? action.summary.tokens : null;
      if (cost === null || tokens === null) return null;
      if (rule.maxCostUsd !== undefined && cost > rule.maxCostUsd) {
        return { decision: 'BLOCK', message: `Budget exceeded: $${cost.toFixed(4)} > $${rule.maxCostUsd.toFixed(2)}` };
      }
      if (rule.maxTokens !== undefined && tokens > rule.maxTokens) {
        return { decision: 'BLOCK', message: `Token budget exceeded: ${tokens} > ${rule.maxTokens}` };
      }
      return { decision: 'ALLOW', message: 'Within budget' };
    }
    default:
      break;
  }

  if (action.kind !== 'final_decision') return null;
  const s = action.summary;
  switch (rule.type) {
    case 'min_judge_confidence':
      if (s.judgeDecision === null) return null;
      return s.judgeConfidence < rule.threshold
        ? { decision: rule.below, message: `Judge confidence ${s.judgeConfidence.toFixed(2)} below ${rule.threshold}` }
        : { decision: 'ALLOW', message: `Judge confidence ${s.judgeConfidence.toFixed(2)} ≥ ${rule.threshold}` };
    case 'block_on_unresolved': {
      const veto = s.unresolved.find((c) => c.supported && c.blockAt !== 'none' && atLeast(c.severity, c.blockAt));
      return veto
        ? { decision: 'BLOCK', message: `Unresolved ${veto.severity} challenge from ${veto.bySeatId} (veto authority): ${veto.claim}` }
        : { decision: 'ALLOW', message: 'No unresolved challenge from a seat with veto authority' };
    }
    case 'escalate_on_unresolved': {
      const hit = s.unresolved.find((c) => c.supported && atLeast(c.severity, rule.atOrAbove));
      return hit ? { decision: 'ESCALATE', message: `Unresolved ${hit.severity} challenge: ${hit.claim}` } : null;
    }
    case 'require_judge_evidence':
      if (s.judgeDecision === null) return { decision: 'ESCALATE', message: 'No judge adjudicated this decision' };
      return s.judgeEvidenceCount < rule.min
        ? { decision: 'ESCALATE', message: `Judge cited ${s.judgeEvidenceCount} evidence item(s); ${rule.min} required` }
        : { decision: 'ALLOW', message: 'Judge decision is evidenced' };
    case 'judge_must_approve':
      switch (s.judgeDecision) {
        case 'approve':
          return { decision: 'ALLOW', message: 'Judge approved' };
        case 'reject':
          return { decision: 'BLOCK', message: 'Judge rejected the proposals' };
        case 'revise':
          return { decision: 'RETRY', message: 'Judge requested revision' };
        case 'escalate':
          return { decision: 'ESCALATE', message: 'Judge escalated to a human' };
        default:
          return { decision: 'ESCALATE', message: 'No judge decision recorded' };
      }
    case 'no_self_judgment':
      if (!s.judgeSeatId || !s.selectedSeatId) return null;
      return s.judgeSeatId === s.selectedSeatId
        ? { decision: 'BLOCK', message: 'A seat may not judge its own work' }
        : { decision: 'ALLOW', message: 'Judge is independent of the selected author' };
    case 'min_approval_weight':
      return s.approvalWeight < rule.threshold
        ? { decision: 'ESCALATE', message: `Weighted approval ${(s.approvalWeight * 100).toFixed(0)}% below ${(rule.threshold * 100).toFixed(0)}%` }
        : { decision: 'ALLOW', message: `Weighted approval ${(s.approvalWeight * 100).toFixed(0)}%` };
    case 'require_cross_provider_review': {
      if (!s.authorProviderId) return null;
      const independent = s.reviewerProviderIds.some((p) => p !== s.authorProviderId);
      return independent
        ? { decision: 'ALLOW', message: 'Reviewed by at least one seat on a different provider' }
        : { decision: 'ESCALATE', message: 'No reviewer on a different provider than the author (correlated-failure risk)' };
    }
    case 'human_approval':
      return { decision: 'ESCALATE', message: rule.description || 'Human approval required by evaluation strategy' };
    default:
      return null;
  }
}

/**
 * Minimal glob: `**` any depth, `*` one segment, `?` one char. Matches the whole path,
 * case-insensitively — macOS volumes are case-insensitive by default, so `.ENV` is `.env`.
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          re += '(?:.*/)?';
          i++;
        } else re += '.*';
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}
