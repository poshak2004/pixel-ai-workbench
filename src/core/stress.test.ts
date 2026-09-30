import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PixelApp } from './app/pixel';
import { MemoryCredentialStore } from './security/credentials';
import { StaticApprovalGate } from './governance/approvals';
import { ToolRegistry } from './tools/types';
import { TableExecutor } from './teams/executor';
import { BASE_POLICIES, councilTable, demoAdapters, mockConfig, rolesMap, seat, spec, StaticResolver, testJournal } from './testing/fixtures';
import type { CompletionRequest, ProviderAdapter } from './providers/types';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
const apps: PixelApp[] = [];
afterEach(() => {
  while (apps.length) apps.pop()!.close();
});

async function openApp(latencyScale = 0) {
  const dataDir = await mkdtemp(join(tmpdir(), 'pixel-stress-'));
  const app = await PixelApp.open({ dataDir, migrationsFolder: MIGRATIONS, credentials: new MemoryCredentialStore(), latencyScale });
  apps.push(app);
  return app;
}

async function settle(app: PixelApp, id: string, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await app.repos.runs.get(id);
    if (r && ['completed', 'failed', 'cancelled'].includes(r.status)) return r;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error(`run ${id} did not settle`);
}

describe('stress: concurrency and volume', () => {
  it('30 concurrent table runs complete with gap-free, ordered event streams', async () => {
    const app = await openApp();
    const { projectId, tableId } = await app.createDemo();
    const runs = await Promise.all(Array.from({ length: 30 }, (_, i) => app.runs.startTableRun({ tableId, task: `Task ${i}: add auth to endpoint ${i}`, projectId })));
    const done = await Promise.all(runs.map((r) => settle(app, r.id, 120_000)));
    expect(done.map((d) => d.status)).toEqual(Array(30).fill('completed'));
    for (const r of runs) {
      const events = await app.repos.runs.events(r.id);
      expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
      expect(events.at(-1)!.type).toBe('run.completed');
    }
    const usage = await app.usage.summary();
    expect(new Set(usage.breakdowns.run.map((r) => r.key)).size).toBe(30);
  }, 180_000);

  it('a 12-seat table runs (all reviewers review all proposers)', async () => {
    const adapters = demoAdapters();
    const { journal, store } = testJournal();
    const table = councilTable();
    const extra = ['role_planner', 'role_researcher', 'role_product_manager', 'role_ux_reviewer', 'role_contrarian', 'role_fact_checker', 'role_tester', 'role_critic'];
    extra.forEach((roleId, i) => table.seats.splice(3, 0, seat(`s${i}`, 0, spec(`Seat ${i}`, roleId, { providerId: ['p_atlas', 'p_borealis', 'p_cirrus'][i % 3]!, modelId: ['atlas-large', 'borealis-pro', 'cirrus-7b-local'][i % 3]! }))));
    table.seats.forEach((s, i) => (s.order = i));
    const r = await new TableExecutor({ resolver: adapters.resolver, tools: new ToolRegistry(), approvals: new StaticApprovalGate(), journal }).run({ table, roles: rolesMap(), task: 'Plan a data migration', policies: BASE_POLICIES, workspaceRoot: null });
    await journal.flush();
    expect(r.error).toBeNull();
    expect(Object.keys(r.proposals).length).toBeGreaterThanOrEqual(5);
    expect(store.events.length).toBeGreaterThan(100);
  });

  it('handles a 20k-character task and unicode/emoji everywhere', async () => {
    const app = await openApp();
    const { projectId, tableId } = await app.createDemo();
    const task = `Überprüfe 認証 🔐 "quotes" \\ back\\slash \u0000 null ${'x'.repeat(19_800)}`;
    const run = await app.runs.startTableRun({ tableId, task, projectId });
    const done = await settle(app, run.id);
    expect(done.status).toBe('completed');
    const stored = (await app.repos.runs.get(run.id))!.task;
    expect(stored).toBe(task.replace('\u0000', '').trim());
    expect(stored.length).toBeGreaterThan(19_800);
  });

  it('cancelling many runs mid-flight leaves no run stuck', async () => {
    const app = await openApp(1);
    const { projectId, tableId } = await app.createDemo();
    const runs = await Promise.all(Array.from({ length: 10 }, (_, i) => app.runs.startTableRun({ tableId, task: `t${i}`, projectId })));
    await new Promise((r) => setTimeout(r, 150));
    await Promise.all(runs.map((r) => app.runs.cancel(r.id)));
    const done = await Promise.all(runs.map((r) => settle(app, r.id)));
    expect(done.every((d) => d.status === 'cancelled')).toBe(true);
    expect(await app.approvals.pending()).toEqual([]);
  });

  it('many concurrent human-approval runs are each resolved independently', async () => {
    const app = await openApp();
    const { projectId, tableId } = await app.createDemo();
    const t = (await app.tables.get(tableId))!;
    await app.tables.update(tableId, { ...t, protocol: { ...t.protocol, evaluation: 'human_approval' } });
    const runs = await Promise.all(Array.from({ length: 8 }, (_, i) => app.runs.startTableRun({ tableId, task: `approve me ${i}`, projectId })));
    let pending: Awaited<ReturnType<typeof app.approvals.pending>> = [];
    for (let i = 0; i < 400 && pending.length < 8; i++) {
      pending = await app.approvals.pending();
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(pending).toHaveLength(8);
    await Promise.all(pending.map((a, i) => app.approvals.resolve(a.id, i % 2 ? 'approved' : 'denied')));
    const done = await Promise.all(runs.map((r) => settle(app, r.id)));
    expect(done.filter((d) => d.outcome === 'approved')).toHaveLength(4);
    expect(done.filter((d) => d.outcome === 'rejected')).toHaveLength(4);
    // Resolving twice is rejected, not silently accepted.
    await expect(app.approvals.resolve(pending[0]!.id, 'approved')).rejects.toThrow();
  });
});

describe('stress: hostile or broken model output', () => {
  const garbage: string[] = [
    '',
    'null',
    '[]',
    '{"summary": 5}',
    '{"summary":"s","approach":"a","confidence":"NaN"}',
    '{"summary":"s","approach":"a","confidence":1e308}',
    '{"__proto__":{"polluted":true},"summary":"s","approach":"a","confidence":0.5}',
    '```json\n{"summary":"s","approach":"a","confidence":0.5',
    '{'.repeat(50_000),
    '{"reviews":[{"targetSeatId":"judge","verdict":"approve","confidence":1}]}',
    '{"decision":"approve","selectedSeatId":"__proto__","rationale":"r","confidence":0.9,"finalAnswer":"x","evidence":[{"source":"s","detail":"d"}]}',
  ];

  for (const [i, text] of garbage.entries()) {
    it(`survives garbage output #${i}`, async () => {
      const adapters = demoAdapters();
      const bad: ProviderAdapter = {
        config: mockConfig('p_cirrus', 'cirrus'),
        testConnection: () => adapters.cirrus.testConnection(),
        listModels: () => adapters.cirrus.listModels(),
        async complete(req: CompletionRequest) {
          return { text, toolCalls: [], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 }, model: req.model };
        },
      };
      adapters.map.set('p_cirrus', bad);
      adapters.map.set('p_borealis', bad);
      const { journal } = testJournal();
      const r = await new TableExecutor({ resolver: new StaticResolver(adapters.map), tools: new ToolRegistry(), approvals: new StaticApprovalGate(), journal }).run({ table: councilTable(), roles: rolesMap(), task: 'x', policies: BASE_POLICIES, workspaceRoot: null });
      expect(['approved', 'blocked', 'rejected', 'revise', 'failed']).toContain(r.outcome);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      // Garbage from the judge must never produce an approval.
      if (r.adjudication === null) expect(r.outcome).not.toBe('approved');
    });
  }

  it('a model that loops on tool calls is bounded', async () => {
    const adapters = demoAdapters();
    let calls = 0;
    const loopy: ProviderAdapter = {
      config: mockConfig('p_atlas', 'atlas'),
      testConnection: () => adapters.atlas.testConnection(),
      listModels: () => adapters.atlas.listModels(),
      async complete(req: CompletionRequest) {
        calls++;
        if (req.tools?.length) return { text: '', toolCalls: [{ id: `c${calls}`, name: 'fs_list_dir', arguments: { path: '.' } }], stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 }, model: req.model };
        return adapters.atlas.complete(req);
      },
    };
    adapters.map.set('p_atlas', loopy);
    const table = councilTable();
    table.seats[0]!.spec.allowedTools = ['fs_list_dir'];
    const { journal } = testJournal();
    const { listDirTool } = await import('./tools/fs');
    await new TableExecutor({ resolver: new StaticResolver(adapters.map), tools: new ToolRegistry().register(listDirTool), approvals: new StaticApprovalGate(), journal }).run({ table, roles: rolesMap(), task: 'x', policies: BASE_POLICIES, workspaceRoot: tmpdir() });
    expect(calls).toBeLessThan(40);
  });

  it('provider throwing non-Error values does not crash the run', async () => {
    const adapters = demoAdapters();
    adapters.map.set('p_cirrus', { ...adapters.cirrus, config: adapters.cirrus.config, testConnection: () => adapters.cirrus.testConnection(), listModels: () => adapters.cirrus.listModels(), complete: () => Promise.reject('a string, not an Error') });
    const { journal } = testJournal();
    const r = await new TableExecutor({ resolver: new StaticResolver(adapters.map), tools: new ToolRegistry(), approvals: new StaticApprovalGate(), journal }).run({ table: councilTable(), roles: rolesMap(), task: 'x', policies: BASE_POLICIES, workspaceRoot: null });
    expect(r.outcome).toBeDefined();
  });
});
