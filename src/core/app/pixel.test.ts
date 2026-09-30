import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryCredentialStore } from '../security/credentials';
import { PixelApp } from './pixel';

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url));
const apps: PixelApp[] = [];

async function openApp(fetchImpl?: typeof fetch) {
  const dataDir = await mkdtemp(join(tmpdir(), 'pixel-app-'));
  const app = await PixelApp.open({ dataDir, migrationsFolder: MIGRATIONS, credentials: new MemoryCredentialStore(), latencyScale: 0, fetch: fetchImpl });
  apps.push(app);
  return { app, dataDir };
}

afterEach(() => {
  while (apps.length) apps.pop()!.close();
});

async function waitForSettle(app: PixelApp, runId: string) {
  for (let i = 0; i < 200; i++) {
    const r = await app.repos.runs.get(runId);
    if (r && ['completed', 'failed', 'cancelled'].includes(r.status)) return r;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error('run did not settle');
}

describe('PixelApp — vertical slice end to end', () => {
  it('seeds roles, locked policies and three offline demo providers with discovered models', async () => {
    const { app } = await openApp();
    const roles = await app.roles.list();
    expect(roles.length).toBeGreaterThanOrEqual(15);
    const providers = await app.providers.list();
    expect(providers.map((p) => p.config.kind)).toEqual(['mock', 'mock', 'mock']);
    expect(providers.every((p) => p.ready)).toBe(true);
    const models = await app.providers.models();
    expect(models.map((m) => m.id).sort()).toEqual(['atlas-large', 'atlas-mini', 'borealis-pro', 'cirrus-7b-local']);
    const policies = await app.repos.policies.list();
    expect(policies.filter((p) => p.locked).map((p) => p.layer).sort()).toEqual(['safety', 'system']);
  });

  it('project → table → run → debate → judge → governance → result, fully persisted', async () => {
    const { app } = await openApp();
    const { projectId, tableId } = await app.createDemo();
    const project = (await app.projects.list()).find((p) => p.id === projectId)!;
    expect(project.isGit).toBe(true);
    const table = await app.tables.get(tableId);
    expect(new Set(table!.seats.map((s) => s.spec.model.providerId)).size).toBe(3);

    const run = await app.runs.startTableRun({ tableId, task: 'Add token-based authentication to the sync API', projectId });
    const done = await waitForSettle(app, run.id);
    expect(done.status).toBe('completed');
    expect(done.outcome).toBe('approved');

    const detail = (await app.runs.detail(run.id))!;
    const seqs = detail.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const types = new Set(detail.events.map((e) => e.type));
    for (const t of ['run.started', 'phase.started', 'agent.context', 'model.call', 'tool.requested', 'governance.decision', 'judgment.recorded', 'artifact.created', 'run.completed']) {
      expect(types, t).toContain(t);
    }
    expect(detail.seats.map((s) => s.seatId).sort()).toEqual(['architect', 'engineer', 'judge', 'security']);
    expect(detail.seats.every((s) => s.constitutionHash.length === 64)).toBe(true);
    expect(detail.judgments.some((j) => j.kind === 'adjudication')).toBe(true);
    expect(detail.toolCalls.length).toBeGreaterThan(0);
    expect(detail.toolCalls.every((t) => t.status === 'ok')).toBe(true);
    expect(detail.artifacts.find((a) => a.kind === 'final_result')!.content).toContain('**Governance:** ALLOW');
    const usage = await app.usage.summary({ runId: run.id });
    expect(usage.totals.calls).toBeGreaterThan(5);
    expect(usage.totals.costUsd).toBeGreaterThan(0);
    expect(usage.breakdowns.provider).toHaveLength(3);
  });

  it('replays a run exactly and branches it onto different models', async () => {
    const { app } = await openApp();
    const { projectId, tableId } = await app.createDemo();
    const first = await app.runs.startTableRun({ tableId, task: 'Design rate limiting for the sync API', projectId });
    await waitForSettle(app, first.id);
    const replay = await app.runs.rerun(first.id);
    const branch = await app.runs.rerun(first.id, { seatModels: { architect: { providerId: 'prov_demo_borealis', modelId: 'borealis-pro' } } });
    const [r1, r2] = [await waitForSettle(app, replay.id), await waitForSettle(app, branch.id)];
    expect(r1.parentRunId).toBe(first.id);
    expect(r1.outcome).toBe((await app.repos.runs.get(first.id))!.outcome);
    expect(r2.parentRunId).toBe(first.id);
    const seats = await app.repos.runs.seats(branch.id);
    expect(seats.find((s) => s.seatId === 'architect')!.providerId).toBe('prov_demo_borealis');
  });

  it('blocks a destructive task by veto and records the governance trace', async () => {
    const { app } = await openApp();
    const { projectId, tableId } = await app.createDemo();
    const run = await app.runs.startTableRun({ tableId, task: 'Delete inactive customer records from the production database', projectId });
    const done = await waitForSettle(app, run.id);
    expect(done.outcome).toBe('blocked');
    const detail = (await app.runs.detail(run.id))!;
    const final = detail.events.find((e) => e.type === 'governance.decision' && e.payload.subject === 'final_decision')!;
    const verdict = final.payload.verdict as { decision: string; trace: unknown[]; policyHash: string };
    expect(verdict.decision).toBe('BLOCK');
    expect(verdict.trace.length).toBeGreaterThan(5);
    expect(verdict.policyHash).toHaveLength(64);
  });

  it('human-approval tables wait for the user, then complete on approval', async () => {
    const { app } = await openApp();
    const { projectId, tableId } = await app.createDemo();
    const t = (await app.tables.get(tableId))!;
    await app.tables.update(tableId, { ...t, protocol: { ...t.protocol, evaluation: 'human_approval' } });
    const run = await app.runs.startTableRun({ tableId, task: 'Add a settings page', projectId });
    let pending: Awaited<ReturnType<typeof app.approvals.pending>> = [];
    for (let i = 0; i < 200 && pending.length === 0; i++) {
      pending = await app.approvals.pending();
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(pending[0]!.kind).toBe('final_decision');
    expect((await app.repos.runs.get(run.id))!.status).toBe('awaiting_approval');
    await app.approvals.resolve(pending[0]!.id, 'approved', 'LGTM');
    const done = await waitForSettle(app, run.id);
    expect(done.outcome).toBe('approved');
  });

  it('cancels a running run', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'pixel-app-'));
    const app = await PixelApp.open({ dataDir, migrationsFolder: MIGRATIONS, credentials: new MemoryCredentialStore(), latencyScale: 1 });
    apps.push(app);
    const { projectId, tableId } = await app.createDemo();
    const run = await app.runs.startTableRun({ tableId, task: 'Anything', projectId });
    await new Promise((r) => setTimeout(r, 100));
    await app.runs.cancel(run.id);
    const done = await waitForSettle(app, run.id);
    expect(done.status).toBe('cancelled');
  });

  it('refuses to start a run on a model that was never discovered', async () => {
    const { app } = await openApp();
    const table = await app.tables.create({ name: 'x', templateId: 'design-council' });
    table.seats[0]!.spec.model = { providerId: 'prov_demo_atlas', modelId: 'does-not-exist' };
    await app.tables.update(table.id, table);
    await expect(app.runs.startTableRun({ tableId: table.id, task: 'x' })).rejects.toThrow(/not available/);
  });
});

describe('PixelApp — credentials never touch the database', () => {
  it('stores the key in the credential store, only a fingerprint in SQLite, and redacts it from errors', async () => {
    const SECRET = 'sk-test-THIS-IS-A-VERY-SECRET-VALUE-0123456789';
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('authorization');
      if (auth !== `Bearer ${SECRET}`) return new Response('no', { status: 401 });
      if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'gpt-test' }] });
      return new Response(`upstream echoed ${SECRET}`, { status: 500 });
    }) as typeof fetch;
    const { app, dataDir } = await openApp(fakeFetch);
    const cfg = await app.providers.add({ kind: 'openai', name: 'OpenAI', secret: SECRET });
    const test = await app.providers.test(cfg.id);
    expect(test.ok).toBe(true);
    const models = await app.providers.discover(cfg.id);
    expect(models.map((m) => m.id)).toEqual(['gpt-test']);

    const status = (await app.providers.list()).find((p) => p.config.id === cfg.id)!;
    expect(status.credential.stored).toBe(true);
    expect(status.credential.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(status)).not.toContain(SECRET);

    // A failing completion whose error echoes the key must not leak it.
    const adapter = await app.providers.adapterFor(cfg.id);
    const err = await adapter.complete({ model: 'gpt-test', system: 's', messages: [{ role: 'user', content: 'hi' }] }).catch((e: Error) => e);
    expect(app.redactor.redactString((err as Error).message)).not.toContain(SECRET);

    app.close();
    apps.length = 0;
    for (const f of await readdir(dataDir)) {
      if (!f.startsWith('pixel.db')) continue;
      const bytes = await readFile(join(dataDir, f)).catch(() => Buffer.alloc(0));
      expect(bytes.includes(Buffer.from(SECRET)), f).toBe(false);
    }
  });

  it('rejects insecure remote base URLs', async () => {
    const { app } = await openApp();
    await expect(app.providers.add({ kind: 'openai_compatible', name: 'x', baseUrl: 'http://example.com/v1', secret: 'abcdefghijkl' })).rejects.toThrow(/https/);
    await expect(app.providers.add({ kind: 'local', name: 'ollama', baseUrl: 'http://localhost:11434/v1' })).resolves.toBeDefined();
  });
});

describe('PixelApp — agents cannot modify governance', () => {
  it('built-in constitutions are immutable and forks get new versions/hashes', async () => {
    const { app } = await openApp();
    await expect(app.roles.update('role_security_reviewer', { name: 'pwned' })).rejects.toThrow(/immutable/);
    const fork = await app.roles.fork('role_security_reviewer', 'Strict Security');
    const updated = await app.roles.update(fork.id, { constitution: { ...fork.constitution, mission: 'Stricter.' } });
    expect(updated.version).toBe(2);
  });

  it('stored policies cannot weaken safety/system: locked layers always come from code', async () => {
    const { app } = await openApp();
    // Simulate a tampered DB row trying to replace the system policy with nothing.
    await app.repos.policies.upsert({ id: 'policy_system', name: 'System', layer: 'system', rules: [], locked: true, scopeType: 'global', scopeId: null }, Date.now());
    const policies = await app.runs.policiesFor(null, null, []);
    expect(policies.find((p) => p.layer === 'system')!.rules.length).toBeGreaterThan(3);
  });
});

describe('PixelApp — workflows', () => {
  it('runs START → TABLE → CONDITION → APPROVAL → END with a human in the loop', async () => {
    const { app } = await openApp();
    const { projectId } = await app.createDemo();
    const wf = await app.workflows.create('Plan and sign off', projectId);
    expect(app.workflows.validate(wf).ok).toBe(true);
    const run = await app.workflows.start(wf.id, 'Add token-based authentication to the sync API', projectId);
    let pending: Awaited<ReturnType<typeof app.approvals.pending>> = [];
    for (let i = 0; i < 300 && pending.length === 0; i++) {
      pending = await app.approvals.pending();
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(pending).toHaveLength(1);
    await app.approvals.resolve(pending[0]!.id, 'approved');
    const done = await waitForSettle(app, run.id);
    expect(done.status).toBe('completed');
    expect(done.outcome).toBe('completed:Done');
    const events = await app.repos.runs.events(run.id);
    const nodeEvents = events.filter((e) => e.type.startsWith('node.')).map((e) => `${e.type}:${e.payload.nodeId}`);
    expect(nodeEvents).toContain('node.completed:council');
    expect(nodeEvents).toContain('node.skipped:stopped');
    expect(events.some((e) => e.type === 'judgment.recorded')).toBe(true);
  });

  it('a blocked table routes the workflow down the false branch', async () => {
    const { app } = await openApp();
    const { projectId } = await app.createDemo();
    const wf = await app.workflows.create('Guarded', projectId);
    const run = await app.workflows.start(wf.id, 'Delete inactive customer records from the production database', projectId);
    const done = await waitForSettle(app, run.id);
    expect(done.outcome).toBe('completed:Stopped');
  });
});
