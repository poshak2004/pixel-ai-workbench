import { _electron as electron, expect, test } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = join(process.cwd(), 'dist/mac-arm64/PIXEL.app/Contents/MacOS/PIXEL');

test.skip(!existsSync(exe), 'packaged app not built (run npm run dist)');

test('packaged app boots, migrates, and runs the demo council', async () => {
  const app = await electron.launch({ executablePath: exe, env: { ...process.env, PIXEL_DATA_DIR: mkdtempSync(join(tmpdir(), 'pixel-pkg-')), PIXEL_CREDENTIAL_STORE: 'memory', PIXEL_MOCK_LATENCY: '0' } });
  const page = await app.firstWindow();
  await page.getByTestId('run-demo').click();
  await page.getByTestId('run-table').click();
  await expect(page.getByTestId('governor').getByText('ALLOW')).toBeVisible({ timeout: 60_000 });
  await app.close();
});
