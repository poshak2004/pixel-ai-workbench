import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PixelApp } from '@core/app/pixel';
import { MemoryCredentialStore } from '@core/security/credentials';
import { createApi } from './api';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
let app: PixelApp;
let api: ReturnType<typeof createApi>;

beforeAll(async () => {
  app = await PixelApp.open({ dataDir: await mkdtemp(join(tmpdir(), 'pixel-fuzz-')), migrationsFolder: MIGRATIONS, credentials: new MemoryCredentialStore(), latencyScale: 0 });
  api = createApi(app, { pickFolder: async () => null, version: 'test', dataDir: 'x' });
  await app.createDemo();
});
afterAll(() => app.close());

const HOSTILE: unknown[] = [
  undefined,
  null,
  0,
  -1,
  NaN,
  'string',
  true,
  [],
  {},
  { id: '' },
  { id: {} },
  { id: '../../etc/passwd' },
  { id: 'x'.repeat(1_000_000) },
  JSON.parse('{"__proto__":{"polluted":1},"id":"a"}'),
  { id: 'run_1', task: '', tableId: 'nope' },
  { id: 'a', table: { name: 'x', description: '', projectId: null, seats: [{ id: 'a', order: 0, spec: {} }], protocol: {}, rules: [] } },
];

describe('IPC fuzzing', () => {
  it('every channel validates input and never throws uncaught or hangs', async () => {
    const results: string[] = [];
    for (const [channel, def] of Object.entries(api) as [string, { schema: { safeParse(v: unknown): { success: boolean; data?: unknown } }; fn(i: unknown): unknown }][]) {
      if (channel === 'app.createDemo') continue;
      for (const input of HOSTILE) {
        const parsed = def.schema.safeParse(input);
        if (!parsed.success) continue;
        const outcome = await Promise.race([
          Promise.resolve()
            .then(() => def.fn(parsed.data))
            .then(() => 'ok', (e: unknown) => (e instanceof Error ? 'error' : `NON-ERROR THROWN: ${String(e)}`)),
          new Promise((r) => setTimeout(() => r('HANG'), 5000)),
        ]);
        if (outcome !== 'ok' && outcome !== 'error') results.push(`${channel}: ${outcome}`);
      }
    }
    expect(results).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  }, 120_000);

  it('rejects oversized strings on text inputs', () => {
    expect(api['runs.startTable'].schema.safeParse({ tableId: 't', task: 'x'.repeat(20_001) }).success).toBe(false);
    expect(api['providers.setSecret'].schema.safeParse({ id: 'p', secret: 'x'.repeat(5000) }).success).toBe(false);
  });

  it('policy saves cannot target locked layers or overwrite locked policies', async () => {
    expect(api['policies.save'].schema.safeParse({ id: null, name: 'x', layer: 'safety', scopeType: 'global', scopeId: null, rules: [] }).success).toBe(false);
    await expect(api['policies.save'].fn({ id: 'policy_system', name: 'x', layer: 'project', scopeType: 'global', scopeId: null, rules: [] })).rejects.toThrow(/Locked/);
    await expect(api['policies.delete'].fn({ id: 'policy_safety' })).rejects.toThrow(/Locked/);
  });
});
