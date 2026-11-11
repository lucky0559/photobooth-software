import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appDir = join(__dirname, '..');

type Debug = { __pbDebug?: { printCalls(): Promise<number> } };

let userData: string;
let app: ElectronApplication | undefined;

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'pb-kiosk-e2e-'));
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(userData, { recursive: true, force: true });
});

test('Setup: pick the printer and send a test page (fake print, never a real printer)', async () => {
  app = await electron.launch({
    args: [appDir],
    cwd: appDir,
    env: {
      ...process.env,
      PB_FAKE_CAMERA: '1',
      PB_FAKE_PRINT: '1',
      PB_USER_DATA: userData,
      PB_FAKE_CONFIG: JSON.stringify({ settings: { freeMode: true } }),
    },
  });
  const page = await app.firstWindow();
  const printCalls = (): Promise<number> => page.evaluate(() => (globalThis as Debug).__pbDebug?.printCalls() ?? -1);
  await page.getByLabel('Admin PIN').fill('2468');
  await page.getByRole('button', { name: 'Next' }).click();

  const printer = page.getByLabel('Printer');
  await expect(printer.locator('option', { hasText: 'Fake Printer' })).toBeAttached();
  await printer.selectOption('Fake Printer');
  expect(await printCalls()).toBe(0);

  await page.getByRole('button', { name: 'Print test page' }).click();
  await expect(page.getByText('Test page sent')).toBeVisible();
  expect(await printCalls()).toBe(1);

  await expect(page.getByLabel('Camera').locator('option', { hasText: /fake/i }).first()).toBeAttached();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Tap to start')).toBeVisible();
  const config = JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8')) as { printerName: string | null };
  expect(config.printerName).toBe('Fake Printer');
});
