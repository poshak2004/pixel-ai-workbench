import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'pixel-recovery-'));
const env = { ...process.env, PIXEL_DATA_DIR: dataDir, PIXEL_CREDENTIAL_STORE: 'memory', PIXEL_MOCK_LATENCY: '3' };

test('a hard kill mid-run is recovered on next launch; data survives', async () => {
  const app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.getByTestId('run-demo').click();
  await page.getByTestId('run-table').click();
  await expect(page.getByTestId('open-run')).toBeVisible();
  await page.waitForTimeout(800);
  app.process().kill('SIGKILL');

  const app2 = await electron.launch({ args: ['.'], env });
  const page2 = await app2.firstWindow();
  const runs = (await page2.evaluate(() => window.pixel.invoke('runs.list'))) as { status: string; error: string | null }[];
  expect(runs).toHaveLength(1);
  expect(runs[0]!.status).toBe('failed');
  expect(runs[0]!.error).toMatch(/Interrupted/);
  const tables = (await page2.evaluate(() => window.pixel.invoke('tables.list'))) as unknown[];
  expect(tables).toHaveLength(1);
  await app2.close();
});

test('a second PIXEL instance on the same data does not open a competing writer', async () => {
  const a = await electron.launch({ args: ['.'], env });
  await a.firstWindow();
  const b = await electron.launch({ args: ['.'], env }).catch(() => null);
  if (b) {
    // The second instance must exit rather than open the same database.
    await expect.poll(() => b.process().exitCode, { timeout: 10_000 }).not.toBeNull();
  }
  await a.close();
});
