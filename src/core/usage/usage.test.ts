import { describe, expect, it } from 'vitest';
import { estimateCost } from './cost';
import { summarizeUsage } from './service';
import type { UsageRecord } from './types';
import { validateContract } from '../agents/runner';
import { buildContext, readSection, renderSystem, renderUser } from '../agents/context';
import { builtInRole } from '../roles/library';
import { DEFAULT_GRANT } from '../security/permissions';
import { extractJsonObject } from '../util/runtime';

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  id: 'u',
  runId: 'r1',
  seatId: 's',
  agentName: 'A',
  tableId: 't',
  workflowId: null,
  providerId: 'p1',
  providerKind: 'openai',
  modelId: 'm1',
  phase: 'PROPOSE',
  inputTokens: 100,
  outputTokens: 50,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  toolCalls: 0,
  latencyMs: 100,
  costUsd: 0.01,
  providerCostUsd: null,
  pricingSource: 'catalog',
  createdAt: Date.UTC(2026, 8, 30),
  ...over,
});

describe('usage accounting', () => {
  it('estimates cost with cached and cache-write tokens priced separately', () => {
    const c = estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 500_000, cacheWriteTokens: 100_000 }, { inputPerMTok: 4, outputPerMTok: 20, cachedInputPerMTok: 0.2, cacheWritePerMTok: 5, source: 'catalog' });
    // 400k fresh*4 + 500k*0.2 + 100k*5 + 1M*20  (per MTok)
    expect(c.costUsd).toBeCloseTo(1.6 + 0.1 + 0.5 + 20, 10);
  });

  it('prefers provider-reported cost; unknown pricing stays unknown (never $0)', () => {
    expect(estimateCost({ inputTokens: 1, outputTokens: 1, providerCostUsd: 0.5 }, null)).toEqual({ costUsd: 0.5, source: 'provider' });
    expect(estimateCost({ inputTokens: 1, outputTokens: 1 }, null)).toEqual({ costUsd: null, source: null });
  });

  it('aggregates by provider/model/agent/day and counts unpriced calls separately', () => {
    const s = summarizeUsage([rec({}), rec({ providerId: 'p2', modelId: 'm2', costUsd: null, agentName: 'B' }), rec({ costUsd: 0.02, createdAt: Date.UTC(2026, 9, 1) })]);
    expect(s.totals).toMatchObject({ calls: 3, inputTokens: 300, outputTokens: 150, unpricedCalls: 1 });
    expect(s.totals.costUsd).toBeCloseTo(0.03);
    expect(s.breakdowns.provider.map((r) => r.key)).toEqual(['p1', 'p2']);
    expect(s.breakdowns.day.map((r) => r.key)).toEqual(['2026-09-30', '2026-10-01']);
    expect(s.breakdowns.agent.find((r) => r.key === 'B')!.unpricedCalls).toBe(1);
  });
});

describe('output contracts', () => {
  it('extracts JSON from fenced or prose-wrapped output', () => {
    expect(extractJsonObject('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('prefix {"a":{"b":"}"}} suffix')).toEqual({ a: { b: '}' } });
    expect(() => extractJsonObject('nothing')).toThrow();
  });

  it('validates contracts and reports precise errors', () => {
    expect(validateContract('proposal', '{"summary":"s","approach":"a","confidence":0.5}').ok).toBe(true);
    const bad = validateContract('proposal', '{"summary":"s","confidence":2}');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/approach|confidence/);
    expect(validateContract('adjudication', '{"decision":"maybe","rationale":"r","confidence":0.5,"finalAnswer":"x"}').ok).toBe(false);
  });
});

describe('context inspector provenance', () => {
  it('every section has a source and token estimate; system holds rules, user holds task', () => {
    const role = builtInRole('role_architect');
    const m = buildContext({
      role,
      spec: { name: 'A', roleId: role.id, objective: 'Be brief', model: { providerId: 'p', modelId: 'm' }, systemRules: ['Prefer SQL'], allowedTools: [], permissions: DEFAULT_GRANT, memoryPolicy: 'run', maxOutputTokens: 1000 },
      seatId: 'architect',
      task: 'Design X',
      phase: { name: 'PROPOSE', instructions: 'go' },
      contract: 'proposal',
      governanceSummary: ['[safety] rule'],
      permissions: DEFAULT_GRANT,
      peerWork: [{ title: 'other', source: 'run:proposal:other', content: '{}' }],
    });
    expect(m.sections.every((s) => s.source && s.tokens > 0)).toBe(true);
    expect(m.sections.map((s) => s.kind)).toEqual(['platform_rules', 'governance', 'constitution', 'agent_rules', 'permissions', 'output_contract', 'phase', 'task', 'peer_work']);
    expect(m.totalTokens).toBe(m.sections.reduce((n, s) => n + s.tokens, 0));
    expect(m.constitutionHash).toHaveLength(64);
    expect(renderSystem(m)).not.toContain('Design X');
    expect(readSection(renderUser(m), 'TASK')).toBe('Design X');
  });
});
