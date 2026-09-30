import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';

// The packaged app has hardened Electron fuses (no inspector, no RUN_AS_NODE), so Playwright
// cannot attach to it. We launch the real binary and check its effects instead.
const exe = join(process.cwd(), 'dist/mac-arm64/PIXEL.app/Contents/MacOS/PIXEL');
test.skip(!existsSync(exe), 'packaged app not built (run npm run dist)');

test('packaged app boots and migrates its database', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'pixel-pkg-'));
  const child = spawn(exe, [], { env: { ...process.env, PIXEL_DATA_DIR: dataDir, PIXEL_CREDENTIAL_STORE: 'memory' }, stdio: 'ignore' });
  try {
    await expect.poll(() => existsSync(join(dataDir, 'pixel.db')), { timeout: 20_000 }).toBe(true);
    const db = createClient({ url: `file:${join(dataDir, 'pixel.db')}` });
    await expect
      .poll(async () => (await db.execute("select count(*) as n from roles")).rows[0]?.n ?? 0, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(15);
    const providers = await db.execute("select kind from providers");
    expect(providers.rows.length).toBe(3);
    db.close();
    expect(child.exitCode).toBeNull();
  } finally {
    child.kill();
  }
});

test('fuses: the packaged binary cannot be used as a Node runtime', async () => {
  const out = await new Promise<string>((resolve) => {
    const c = spawn(exe, ['-e', 'console.log("PWNED:" + process.versions.node)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PIXEL_DATA_DIR: mkdtempSync(join(tmpdir(), 'pixel-fuse-')), PIXEL_CREDENTIAL_STORE: 'memory' } });
    let buf = '';
    c.stdout.on('data', (d) => (buf += d));
    c.stderr.on('data', (d) => (buf += d));
    setTimeout(() => {
      c.kill();
      resolve(buf);
    }, 5000);
  });
  expect(out).not.toContain('PWNED:');
});
