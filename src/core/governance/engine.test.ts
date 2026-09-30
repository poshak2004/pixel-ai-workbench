import { describe, expect, it } from 'vitest';
import { GovernanceEngine, globToRegExp } from './engine';
import { SAFETY_POLICY, SYSTEM_POLICY, projectPolicy } from './defaults';
import type { DecisionSummary, GovernedAction, Policy } from './types';
import { DECISIONS, LAYERS } from './types';
import { checkPermission, DEFAULT_GRANT } from '../security/permissions';

const summary = (over: Partial<DecisionSummary> = {}): DecisionSummary => ({
  judgeSeatId: 'judge',
  judgeDecision: 'approve',
  judgeConfidence: 0.8,
  judgeEvidenceCount: 2,
  selectedSeatId: 'architect',
  unresolved: [],
  approvalWeight: 1,
  authorProviderId: 'p_a',
  reviewerProviderIds: ['p_b'],
  integrityOk: true,
  costUsd: 0.01,
  tokens: 1000,
  ...over,
});

const final = (over: Partial<DecisionSummary> = {}): GovernedAction => ({ kind: 'final_decision', summary: summary(over) });

const toolCall = (over: Partial<Extract<GovernedAction, { kind: 'tool_call' }>> = {}): GovernedAction => ({
  kind: 'tool_call',
  tool: 'fs_read_file',
  actionKind: 'fs.read',
  seatId: 's1',
  roleId: 'role_architect',
  paths: ['src/index.ts'],
  permission: { outcome: 'allowed', reason: 'ok' },
  constitution: { allowed: ['fs.read', 'git.read'], forbidden: ['fs.write'] },
  ...over,
});

const engine = (...extra: Policy[]) => new GovernanceEngine([SAFETY_POLICY, SYSTEM_POLICY, ...extra]);

describe('GovernanceEngine — final decisions', () => {
  it('allows a clean, evidenced, confident judge approval', () => {
    const v = engine().evaluate(final());
    expect(v.decision).toBe('ALLOW');
    expect(v.violations).toEqual([]);
  });

  it('blocks when the judge rejects', () => {
    const v = engine().evaluate(final({ judgeDecision: 'reject' }));
    expect(v.decision).toBe('BLOCK');
    expect(v.decidingRuleId).toBe('system.judge-decides');
  });

  it('maps revise → RETRY and escalate → ESCALATE', () => {
    expect(engine().evaluate(final({ judgeDecision: 'revise' })).decision).toBe('RETRY');
    expect(engine().evaluate(final({ judgeDecision: 'escalate' })).decision).toBe('ESCALATE');
  });

  it('escalates low-confidence judgments', () => {
    const v = engine().evaluate(final({ judgeConfidence: 0.3 }));
    expect(v.decision).toBe('ESCALATE');
    expect(v.decidingRuleId).toBe('system.judge-confidence');
  });

  it('escalates judge decisions without evidence', () => {
    expect(engine().evaluate(final({ judgeEvidenceCount: 0 })).decision).toBe('ESCALATE');
  });

  it('blocks self-judgment', () => {
    const v = engine().evaluate(final({ selectedSeatId: 'judge' }));
    expect(v.decision).toBe('BLOCK');
    expect(v.decidingRuleId).toBe('system.no-self-judgment');
  });

  it('a veto-holding seat blocks with an unresolved, supported critical challenge', () => {
    const v = engine().evaluate(
      final({ unresolved: [{ challengeId: 'ch-1', bySeatId: 'security', severity: 'critical', supported: true, blockAt: 'critical', claim: 'x' }] }),
    );
    expect(v.decision).toBe('BLOCK');
    expect(v.decidingRuleId).toBe('system.veto');
  });

  it('unsupported challenges cannot veto', () => {
    const v = engine().evaluate(
      final({ unresolved: [{ challengeId: 'ch-1', bySeatId: 'security', severity: 'critical', supported: false, blockAt: 'critical', claim: 'x' }] }),
    );
    expect(v.decision).toBe('ALLOW');
  });

  it('seats without veto authority cannot block, however severe', () => {
    const v = engine().evaluate(
      final({ unresolved: [{ challengeId: 'ch-1', bySeatId: 'critic', severity: 'critical', supported: true, blockAt: 'none', claim: 'x' }] }),
    );
    expect(v.decision).toBe('ALLOW');
  });

  it('veto threshold respects severity (major blockAt blocks major, critical blockAt does not)', () => {
    const c = (blockAt: 'critical' | 'major') => ({ challengeId: 'c', bySeatId: 's', severity: 'major' as const, supported: true, blockAt, claim: 'x' });
    expect(engine().evaluate(final({ unresolved: [c('major')] })).decision).toBe('BLOCK');
    expect(engine().evaluate(final({ unresolved: [c('critical')] })).decision).toBe('ALLOW');
  });

  it('constitution integrity failure blocks at the safety layer', () => {
    const v = engine().evaluate(final({ integrityOk: false }));
    expect(v.decision).toBe('BLOCK');
    expect(v.decidingLayer).toBe('safety');
  });

  it('project budget blocks over-spend', () => {
    const v = engine(projectPolicy('p1', { maxCostUsd: 0.005 })).evaluate(final({ costUsd: 0.01 }));
    expect(v.decision).toBe('BLOCK');
    expect(v.decidingLayer).toBe('project');
  });

  it('cross-provider review requirement escalates correlated reviews', () => {
    const table: Policy = { id: 't', name: 't', layer: 'table', locked: false, rules: [{ id: 't.x', type: 'require_cross_provider_review', description: '' }] };
    expect(engine(table).evaluate(final({ reviewerProviderIds: ['p_a'] })).decision).toBe('ESCALATE');
    expect(engine(table).evaluate(final({ reviewerProviderIds: ['p_a', 'p_b'] })).decision).toBe('ALLOW');
  });

  it('weighted authority threshold is explicit and inspectable', () => {
    const table: Policy = { id: 't', name: 't', layer: 'table', locked: false, rules: [{ id: 't.w', type: 'min_approval_weight', threshold: 0.6, description: '' }] };
    const v = engine(table).evaluate(final({ approvalWeight: 0.5 }));
    expect(v.decision).toBe('ESCALATE');
    expect(v.reason).toContain('50%');
    expect(v.trace.find((t) => t.ruleId === 't.w')?.outcome).toBe('ESCALATE');
  });
});

describe('GovernanceEngine — precedence', () => {
  it('the most restrictive decision wins regardless of layer', () => {
    const task: Policy = { id: 'task', name: 'task', layer: 'task', locked: false, rules: [{ id: 'task.human', type: 'human_approval', description: '' }] };
    const v = engine(task).evaluate(final());
    expect(v.decision).toBe('ESCALATE');
    expect(v.decidingLayer).toBe('task');
  });

  it('a lower layer cannot loosen a higher threshold', () => {
    const task: Policy = { id: 'task', name: 'task', layer: 'task', locked: false, rules: [{ id: 'task.conf', type: 'min_judge_confidence', threshold: 0.1, below: 'ESCALATE', description: '' }] };
    // System requires 0.5; task tries 0.1. 0.3 must still escalate via the system rule.
    const v = engine(task).evaluate(final({ judgeConfidence: 0.3 }));
    expect(v.decision).toBe('ESCALATE');
    expect(v.decidingLayer).toBe('system');
  });

  it('ties are attributed to the highest-precedence layer', () => {
    const table: Policy = { id: 't', name: 't', layer: 'table', locked: false, rules: [{ id: 't.reject', type: 'judge_must_approve', description: '' }] };
    const v = engine(table).evaluate(final({ judgeDecision: 'reject' }));
    expect(v.decision).toBe('BLOCK');
    expect(v.decidingLayer).toBe('system');
  });

  it('lower layers cannot waive higher-layer rules', () => {
    const agent: Policy = { id: 'a', name: 'a', layer: 'agent', locked: false, rules: [{ id: 'a.waive', type: 'waive', ruleIds: ['system.judge-decides'], justification: 'agent says so', description: '' }] };
    const v = engine(agent).evaluate(final({ judgeDecision: 'reject' }));
    expect(v.decision).toBe('BLOCK');
    expect(v.violations[0]).toMatch(/only higher-precedence layers may waive/);
  });

  it('safety rules can never be waived, even by the system layer', () => {
    const sys: Policy = { ...SYSTEM_POLICY, rules: [...SYSTEM_POLICY.rules, { id: 'system.waive', type: 'waive', ruleIds: ['safety.constitution'], justification: 'x', description: '' }] };
    const v = new GovernanceEngine([SAFETY_POLICY, sys]).evaluate(final({ integrityOk: false }));
    expect(v.decision).toBe('BLOCK');
    expect(v.violations[0]).toMatch(/safety rule/);
  });

  it('a higher layer may explicitly waive a lower-layer rule', () => {
    const table: Policy = { id: 't', name: 't', layer: 'table', locked: false, rules: [{ id: 't.human', type: 'human_approval', description: '' }] };
    const project: Policy = { id: 'p', name: 'p', layer: 'project', locked: false, rules: [{ id: 'p.waive', type: 'waive', ruleIds: ['t.human'], justification: 'CI project', description: '' }] };
    const v = engine(table, project).evaluate(final());
    expect(v.decision).toBe('ALLOW');
    expect(v.trace.find((t) => t.ruleId === 't.human')?.outcome).toBe('waived');
  });

  it('is deterministic: policy order in input does not change the verdict or hash', () => {
    const table: Policy = { id: 't', name: 't', layer: 'table', locked: false, rules: [{ id: 't.human', type: 'human_approval', description: '' }] };
    const a = new GovernanceEngine([SAFETY_POLICY, SYSTEM_POLICY, table]);
    const b = new GovernanceEngine([table, SYSTEM_POLICY, SAFETY_POLICY]);
    expect(a.policyHash).toBe(b.policyHash);
    expect(a.evaluate(final())).toEqual(b.evaluate(final()));
  });

  it('decision and layer orderings are the documented ones', () => {
    expect(DECISIONS).toEqual(['ALLOW', 'RETRY', 'REROUTE', 'WAIT', 'ESCALATE', 'BLOCK']);
    expect(LAYERS).toEqual(['safety', 'system', 'project', 'table', 'role', 'agent', 'task']);
  });

  it('with no rules, allows', () => {
    const v = new GovernanceEngine([]).evaluate(final());
    expect(v.decision).toBe('ALLOW');
    expect(v.decidingLayer).toBeNull();
  });
});

describe('GovernanceEngine — tool calls', () => {
  it('allows a permitted, constitution-allowed read', () => {
    expect(engine().evaluate(toolCall()).decision).toBe('ALLOW');
  });

  it('blocks when permissions deny', () => {
    const v = engine().evaluate(toolCall({ actionKind: 'shell.exec', permission: checkPermission(DEFAULT_GRANT, 'shell.exec') }));
    expect(v.decision).toBe('BLOCK');
  });

  it('escalates when permissions require approval', () => {
    const v = engine().evaluate(
      toolCall({ actionKind: 'shell.exec', permission: { outcome: 'approval', reason: 'Terminal requires approval' }, constitution: { allowed: ['shell.exec'], forbidden: [] } }),
    );
    expect(v.decision).toBe('ESCALATE');
  });

  it('blocks actions the constitution forbids even when permissions allow them', () => {
    const v = engine().evaluate(toolCall({ actionKind: 'fs.write', permission: { outcome: 'allowed', reason: '' } }));
    expect(v.decision).toBe('BLOCK');
    expect(v.reason).toMatch(/Constitution forbids/);
  });

  it('blocks actions outside the constitution allow-list', () => {
    const v = engine().evaluate(toolCall({ actionKind: 'browser.use', permission: { outcome: 'allowed', reason: '' } }));
    expect(v.decision).toBe('BLOCK');
  });

  it('protects governance, VCS and secret paths from writes', () => {
    const write = (p: string) =>
      engine().evaluate(toolCall({ actionKind: 'fs.write', paths: [p], permission: { outcome: 'allowed', reason: '' }, constitution: { allowed: ['fs.write'], forbidden: [] } }));
    expect(write('.git/config').decision).toBe('BLOCK');
    expect(write('.pixel/policies/system.json').decision).toBe('BLOCK');
    expect(write('config/.env').decision).toBe('BLOCK');
    expect(write('src/app.ts').decision).toBe('ALLOW');
  });

  it('never reads secret files into model context', () => {
    expect(engine().evaluate(toolCall({ paths: ['.env'] })).decision).toBe('BLOCK');
    expect(engine().evaluate(toolCall({ paths: ['deploy/server.pem'] })).decision).toBe('BLOCK');
    expect(engine().evaluate(toolCall({ paths: ['README.md'] })).decision).toBe('ALLOW');
  });

  it('scoped rules only apply to their seats/roles', () => {
    const role: Policy = { id: 'r', name: 'r', layer: 'role', locked: false, rules: [{ id: 'r.deny', type: 'deny_actions', actions: ['fs.read'], decision: 'BLOCK', scope: { roleIds: ['role_critic'] }, description: '' }] };
    expect(engine(role).evaluate(toolCall()).decision).toBe('ALLOW');
    expect(engine(role).evaluate(toolCall({ roleId: 'role_critic' })).decision).toBe('BLOCK');
  });
});

describe('GovernanceEngine — output and spend', () => {
  it('retries malformed output once, then escalates', () => {
    const e = engine();
    expect(e.evaluate({ kind: 'agent_output', seatId: 's', roleId: 'r', valid: false, attempt: 1 }).decision).toBe('RETRY');
    expect(e.evaluate({ kind: 'agent_output', seatId: 's', roleId: 'r', valid: false, attempt: 2 }).decision).toBe('ESCALATE');
    expect(e.evaluate({ kind: 'agent_output', seatId: 's', roleId: 'r', valid: true, attempt: 1 }).decision).toBe('ALLOW');
  });

  it('blocks model calls once the budget is exhausted', () => {
    const e = engine(projectPolicy('p', { maxCostUsd: 1 }));
    expect(e.evaluate({ kind: 'model_call', seatId: 's', roleId: 'r', runCostUsd: 0.5, runTokens: 10 }).decision).toBe('ALLOW');
    expect(e.evaluate({ kind: 'model_call', seatId: 's', roleId: 'r', runCostUsd: 1.5, runTokens: 10 }).decision).toBe('BLOCK');
  });
});

describe('globToRegExp', () => {
  it.each([
    ['**/.git/**', '.git/HEAD', true],
    ['**/.git/**', 'a/b/.git/x', true],
    ['**/.git/**', 'foo.git/x', false],
    ['*.md', 'README.md', true],
    ['*.md', 'docs/README.md', false],
    ['**/*.md', 'docs/README.md', true],
    ['src/?.ts', 'src/a.ts', true],
  ])('%s matches %s → %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});
