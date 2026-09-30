import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let page: Page;
const errors: string[] = [];

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'], env: { ...process.env, PIXEL_DATA_DIR: mkdtempSync(join(tmpdir(), 'pixel-stress-e2e-')), PIXEL_CREDENTIAL_STORE: 'memory', PIXEL_MOCK_LATENCY: '0.3' } });
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.getByTestId('run-demo').click();
  await expect(page.getByTestId('council')).toBeVisible();
});
test.afterAll(async () => app?.close());

test('double-clicking Convene starts exactly one run', async () => {
  await page.getByTestId('run-table').dblclick();
  await expect(page.getByTestId('open-run')).toBeVisible();
  await page.waitForTimeout(500);
  const runs = (await page.evaluate(() => window.pixel.invoke('runs.list'))) as unknown[];
  expect(runs).toHaveLength(1);
});

test('UI stays responsive during a storm of 25 concurrent runs', async () => {
  const tableId = page.url().split('/tables/')[1]!;
  await page.evaluate(async (tid) => {
    const projects = (await window.pixel.invoke('projects.list')) as { id: string }[];
    await Promise.all(Array.from({ length: 25 }, (_, i) => window.pixel.invoke('runs.startTable', { tableId: tid, task: `storm ${i}`, projectId: projects[0]!.id })));
  }, tableId);
  const pages = ['Runs', 'Home', 'Usage', 'Sessions', 'Tables', 'Runs', 'Models', 'Home'];
  for (let round = 0; round < 4; round++) {
    for (const name of pages) {
      const t0 = Date.now();
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.locator('main h1').first()).toBeVisible();
      expect(Date.now() - t0, `${name} took too long`).toBeLessThan(2500);
    }
  }
  await expect
    .poll(async () => ((await page.evaluate(() => window.pixel.invoke('runs.list'))) as { status: string }[]).filter((r) => r.status !== 'completed').length, { timeout: 90_000 })
    .toBe(0);
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(26);
});

test('run view with the full verbose timeline renders quickly', async () => {
  await page.locator('tbody tr').first().click();
  await expect(page.getByTestId('timeline')).toBeVisible();
  const t0 = Date.now();
  await page.getByText('all events').last().click();
  await expect(page.locator('[data-testid="timeline"] li').nth(60)).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(2500);
  for (const tab of ['Debate', 'Result', 'Usage', 'Artifacts', 'Timeline']) await page.getByRole('tab', { name: new RegExp(tab) }).click();
});

test('no renderer errors were logged during the stress run', async () => {
  expect(errors).toEqual([]);
});
