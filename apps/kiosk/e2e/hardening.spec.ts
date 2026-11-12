import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_MAIN } from './kiosk-app';

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

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: [E2E_MAIN],
    env: {
      ...process.env,
      PB_FAKE_CAMERA: '1',
      PB_FAKE_PRINT: '1',
      PB_USER_DATA: userData,
      PB_FAKE_CONFIG: JSON.stringify({ settings: { freeMode: true } }),
    },
  });
}

test('damaged config.json: moved aside, Setup shows the staff notice until Setup completes', async () => {
  writeFileSync(join(userData, 'config.json'), '{ "pinHash": "scrypt$');
  app = await launch();
  const page = await app.firstWindow();

  await expect(page.getByRole('heading', { name: 'Kiosk setup' })).toBeVisible();
  await expect(page.getByText('Settings file was damaged and reset. Check the printer and camera.')).toBeVisible();
  const backups = readdirSync(userData).filter((f) => f.startsWith('config.json.corrupt-'));
  expect(backups).toHaveLength(1);
  expect(readFileSync(join(userData, backups[0]), 'utf8')).toBe('{ "pinHash": "scrypt$');

  await page.getByLabel('Admin PIN').fill('2468');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('Camera').locator('option', { hasText: /fake/i }).first()).toBeAttached();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Tap to start')).toBeVisible();

  const config = JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8')) as { recoveredFromCorruption: boolean };
  expect(config.recoveredFromCorruption).toBe(false);
});

test('the renderer never receives the PIN hash and cannot navigate away', async () => {
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ pinHash: 'scrypt$e2e$e2e', cameraDeviceId: null }));
  app = await launch();
  const page = await app.firstWindow();
  await expect(page.getByText('Tap to start')).toBeVisible();

  const cfg = await page.evaluate(() => (globalThis as unknown as { kiosk: { getConfig(): Promise<object> } }).kiosk.getConfig());
  expect(cfg).toMatchObject({ pinSet: true });
  expect(JSON.stringify(cfg)).not.toContain('scrypt');

  // setConfig cannot write pinHash.
  await page.evaluate(() =>
    (globalThis as unknown as { kiosk: { setConfig(p: object): Promise<unknown> } }).kiosk.setConfig({ pinHash: null, printerName: 'X' }),
  );
  const onDisk = JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8')) as { pinHash: string; printerName: string };
  expect(onDisk).toMatchObject({ pinHash: 'scrypt$e2e$e2e', printerName: 'X' });

  const before = await page.evaluate(() => location.href);
  await page.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await page.waitForTimeout(500);
  // Read the page state directly: Playwright's locators keep waiting on the navigation main cancelled.
  const after = await page.evaluate(() => ({ href: location.href, attract: (document.body.textContent ?? '').includes('Tap to start') }));
  expect(after).toEqual({ href: before, attract: true });
});
