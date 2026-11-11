import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appDir = join(__dirname, '..');

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
    args: [appDir],
    cwd: appDir,
    env: {
      ...process.env,
      PB_FAKE_CAMERA: '1',
      PB_USER_DATA: userData,
      PB_FAKE_CONFIG: JSON.stringify({ settings: { freeMode: true } }),
    },
  });
}

test('first run: set PIN, pick the fake camera, land on Attract', async () => {
  app = await launch();
  const page = await app.firstWindow();

  await expect(page.getByRole('heading', { name: 'Kiosk setup' })).toBeVisible();
  // The fake API is live and configured from PB_FAKE_CONFIG.
  const freeMode = await page.evaluate(
    () => (globalThis as { __pbFake?: { settings: { freeMode?: boolean } } }).__pbFake?.settings.freeMode,
  );
  expect(freeMode).toBe(true);

  await page.getByLabel('Admin PIN').fill('2468');
  await page.getByRole('button', { name: 'Next' }).click();

  // Fake API: no Supabase sign-in step.
  const camera = page.getByLabel('Camera');
  await expect(camera.locator('option', { hasText: /fake/i }).first()).toBeAttached();
  const fakeId = await camera
    .locator('option', { hasText: /fake/i })
    .first()
    .getAttribute('value');
  await camera.selectOption(fakeId ?? '');
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByText('Tap to start')).toBeVisible();

  const config = JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8')) as {
    pinHash: string | null;
    cameraDeviceId: string | null;
  };
  expect(config.pinHash).toMatch(/^scrypt\$/);
  expect(config.cameraDeviceId).toBe(fakeId);
});

test('secret corner: 5 taps + PIN reopens Setup', async () => {
  app = await launch();
  let page = await app.firstWindow();
  await page.getByLabel('Admin PIN').fill('2468');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('Camera').locator('option', { hasText: /fake/i }).first()).toBeAttached();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Tap to start')).toBeVisible();

  // Relaunch: config persisted, so Attract shows directly.
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByText('Tap to start')).toBeVisible();

  for (let i = 0; i < 5; i++) await page.mouse.click(40, 40);
  await page.getByLabel('PIN').fill('1111');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong PIN');

  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Kiosk setup' })).toBeVisible();
});
