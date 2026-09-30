import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let page: Page;
const shots = join(process.cwd(), 'test-results', 'screens');

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['.'],
    // E2E_DATA_ROOT lets us run under ~/Library like the real app does.
    env: { ...process.env, PIXEL_DATA_DIR: mkdtempSync(join(process.env.E2E_DATA_ROOT ?? tmpdir(), 'pixel-e2e-')), PIXEL_CREDENTIAL_STORE: 'memory', PIXEL_MOCK_LATENCY: '0.15' },
  });
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.error('pageerror', e));
  await page.setViewportSize({ width: 1440, height: 920 });
});

test.afterAll(async () => {
  await app?.close();
});

test('vertical slice: demo → table → run → debate → judge → governance → usage', async () => {
  await expect(page.getByText('Convene a council in one click')).toBeVisible();
  await page.screenshot({ path: join(shots, '01-home.png') });

  await page.getByTestId('run-demo').click();
  await expect(page.getByTestId('council')).toBeVisible();
  for (const s of ['architect', 'engineer', 'security', 'judge']) await expect(page.getByTestId(`seat-${s}`)).toBeVisible();
  await page.screenshot({ path: join(shots, '02-table.png') });

  await page.getByTestId('run-table').click();
  await expect(page.getByTestId('open-run')).toBeVisible();
  await expect(page.getByTestId('governor').getByText('ALLOW')).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: join(shots, '03-table-after-run.png') });

  await page.getByTestId('open-run').click();
  await expect(page.getByTestId('timeline')).toBeVisible();
  await expect(page.getByTestId('agent-tree')).toContainText('Security Reviewer');
  await page.getByText('→ challenge (critical)').first().click();
  await expect(page.getByTestId('inspector')).toContainText('Evidence');
  await page.screenshot({ path: join(shots, '04-run-timeline.png') });

  await page.getByRole('tab', { name: /Debate/ }).click();
  await expect(page.getByTestId('challenge').first()).toBeVisible();
  await page.screenshot({ path: join(shots, '05-run-debate.png') });

  await page.getByRole('tab', { name: /Result/ }).click();
  await expect(page.getByTestId('verdict')).toContainText('ALLOW');
  await expect(page.getByTestId('final-result')).toContainText('Recommendation');
  await page.screenshot({ path: join(shots, '06-run-result.png') });

  await page.getByRole('tab', { name: /Timeline/ }).click();
  await page.getByText('all events').last().click();
  await page.getByText('→ received context').first().click();
  await expect(page.getByTestId('context-inspector')).toContainText('ROLE CONSTITUTION');
  await page.screenshot({ path: join(shots, '07-context-inspector.png') });

  await page.getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(page.getByText('Model calls').first()).toBeVisible();
  await page.screenshot({ path: join(shots, '08-usage.png') });

  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(page.getByText('Demo · Atlas')).toBeVisible();
  await page.screenshot({ path: join(shots, '09-models.png') });
});

test('governance blocks a destructive task despite judge approval', async () => {
  await page.getByRole('button', { name: 'Tables', exact: true }).click();
  await page.locator('[data-testid^="table-card-"]').first().click();
  await page.getByLabel('Task').fill('Delete inactive customer records from the production database');
  await page.getByTestId('run-table').click();
  await expect(page.getByTestId('governor').getByText('BLOCK')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('open-run').click();
  await page.getByRole('tab', { name: /Result/ }).click();
  await expect(page.getByTestId('verdict')).toContainText('system.veto');
  await page.screenshot({ path: join(shots, '10-blocked.png') });
});

test('create a table from scratch, add a seat and assign a different model', async () => {
  await page.getByRole('button', { name: 'Tables', exact: true }).click();
  await page.getByTestId('new-table').click();
  await page.getByTestId('table-name').fill('E2E Council');
  await page.getByText('Adversarial Review').click();
  await page.getByTestId('create-table').click();
  await expect(page.getByTestId('council')).toBeVisible();
  await page.getByLabel('Add seat').click();
  await page.getByRole('button', { name: /^Tester/ }).click();
  await page.getByTestId('add-seat-confirm').click();
  await page.getByLabel('Model').first().selectOption({ label: 'Borealis Pro · $2.5/$10' });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('seat-tester')).toContainText('Borealis Pro');
  await page.screenshot({ path: join(shots, '11-custom-table.png') });
});

test('every page renders without crashing', async () => {
  const pages = ['Home', 'Playground', 'Agents', 'Tables', 'Workflows', 'Projects', 'Runs', 'Sessions', 'Models', 'Usage', 'MCP', 'Settings'];
  for (const name of pages) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('main h1').first(), name).toBeVisible();
    await expect(page.getByText('Something went wrong'), name).toHaveCount(0);
  }
  // Project detail, reached directly and via the list.
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Permission ceiling' })).toBeVisible();
  await page.screenshot({ path: join(shots, '12-projects.png') });
});
