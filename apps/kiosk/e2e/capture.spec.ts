import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appDir = join(__dirname, '..');

interface PbDebug {
  shotCount(): number;
  killCamera(): void;
}

let userData: string;
let app: ElectronApplication | undefined;

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'pb-kiosk-e2e-'));
  // Skip first-run setup: any PIN hash is enough to land on Attract; null camera = default (fake) device.
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ pinHash: 'scrypt$e2e$e2e', cameraDeviceId: null }));
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(userData, { recursive: true, force: true });
});

async function launch(): Promise<Page> {
  app = await electron.launch({
    args: [appDir],
    cwd: appDir,
    env: {
      ...process.env,
      PB_FAKE_CAMERA: '1',
      PB_FAKE_PRINT: '1',
      PB_USER_DATA: userData,
      PB_FAKE_CONFIG: JSON.stringify({ settings: { freeMode: true, countdownSeconds: 3, shotsPerSession: 2 } }),
    },
  });
  return app.firstWindow();
}

const shotCount = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __pbDebug: PbDebug }).__pbDebug.shotCount());

/** The preview shows a live camera stream with frames. */
const isPlaying = (page: Page) =>
  page.locator('video').evaluate((v: HTMLVideoElement) => {
    const stream = v.srcObject as MediaStream | null;
    return v.readyState >= 2 && stream?.getVideoTracks()[0]?.readyState === 'live';
  });

test('free session: countdown captures 2 shots and lands on Review', async () => {
  const page = await launch();
  await expect(page.getByText('Free today!')).toBeVisible();
  await page.getByRole('button', { name: 'Tap to start' }).click();

  await expect(page.locator('video')).toBeVisible();
  await expect(page.getByText('Shot 1 of 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pick a look' })).toBeVisible({ timeout: 15_000 });
  expect(await shotCount(page)).toBe(2);
});

test('camera lost: error screen, Try again restores the preview', async () => {
  const page = await launch();
  await page.getByRole('button', { name: 'Tap to start' }).click();
  await expect(page.locator('video')).toBeVisible();
  await expect.poll(() => isPlaying(page)).toBe(true);

  await page.evaluate(() => (globalThis as unknown as { __pbDebug: PbDebug }).__pbDebug.killCamera());
  await expect(page.getByText('Camera not available. Please call staff.')).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);

  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('video')).toBeVisible();
  await expect.poll(() => isPlaying(page)).toBe(true);
  await expect(page.getByText('Camera not available. Please call staff.')).toHaveCount(0);
});
