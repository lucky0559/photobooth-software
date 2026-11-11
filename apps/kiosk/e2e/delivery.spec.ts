import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appDir = join(__dirname, '..');

interface PbDebug {
  queueLength(): Promise<number>;
  printCalls(): Promise<number>;
}

let userData: string;
let app: ElectronApplication | undefined;

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'pb-kiosk-e2e-'));
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ pinHash: 'scrypt$e2e$e2e', cameraDeviceId: null }));
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(userData, { recursive: true, force: true });
});

async function launch(fake: Record<string, unknown> = {}, env: Record<string, string> = {}): Promise<Page> {
  app = await electron.launch({
    args: [appDir],
    cwd: appDir,
    env: {
      ...process.env,
      PB_FAKE_CAMERA: '1',
      PB_FAKE_PRINT: '1',
      PB_USER_DATA: userData,
      PB_FAKE_CONFIG: JSON.stringify({
        settings: { freeMode: true, countdownSeconds: 3, shotsPerSession: 2 },
        // Shortens only the 10 s queue loop interval; retry backoff keeps its production values.
        queueIntervalMs: 1000,
        ...fake,
      }),
      ...env,
    },
  });
  return app.firstWindow();
}

/** Runs a free 2-shot session through Review and taps Print. */
async function finishSession(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Tap to start' }).click();
  await expect(page.getByRole('heading', { name: 'Pick a look' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Print', exact: true }).click();
}

const debug = (page: Page) => ({
  queueLength: () => page.evaluate(() => (globalThis as unknown as { __pbDebug: PbDebug }).__pbDebug.queueLength()),
  printCalls: () => page.evaluate(() => (globalThis as unknown as { __pbDebug: PbDebug }).__pbDebug.printCalls()),
});

const deliveryHeading = (page: Page) => page.getByRole('heading', { name: 'Scan to download your photo' });

test('offline uploads: QR shows right away and the queue drains after 2 failed uploads', async () => {
  test.setTimeout(90_000);
  const page = await launch({ failUploads: 2 });
  await finishSession(page);

  await expect(deliveryHeading(page)).toBeVisible({ timeout: 15_000 });
  const qr = page.getByRole('img', { name: 'QR code to download your photo' });
  await expect(qr).toBeVisible({ timeout: 2_000 });
  expect(await qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  await expect(page.getByRole('timer')).toHaveText(/^0:4\d$/);
  await expect(page.getByText(/Printing failed/)).toHaveCount(0);
  expect(await debug(page).printCalls()).toBe(1);

  const photos = readdirSync(join(userData, 'photos')).filter((f) => f.endsWith('.jpg'));
  expect(photos).toHaveLength(1);
  expect(readFileSync(join(userData, 'photos', photos[0]!)).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

  await expect.poll(debug(page).queueLength, { timeout: 40_000, intervals: [500] }).toBe(0);
  const queue = JSON.parse(readFileSync(join(userData, 'queue.json'), 'utf8')) as {
    jobs: unknown[];
    completedUploads: { filePath: string }[];
  };
  expect(queue.jobs).toEqual([]);
  expect(queue.completedUploads.map((u) => u.filePath)).toEqual([join(userData, 'photos', photos[0]!)]);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Tap to start' })).toBeVisible();
});

test('print failure still shows the QR with the staff message', async () => {
  const page = await launch({}, { PB_FAKE_PRINT_FAIL: 'Out of paper' });
  await finishSession(page);
  await expect(deliveryHeading(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('img', { name: 'QR code to download your photo' })).toBeVisible();
  await expect(
    page.getByText('Printing failed. Please call staff — your photo is still available through the QR code.'),
  ).toBeVisible();
  // Everything, including Done, still fits a landscape screen without scrolling.
  for (const size of [
    { width: 1080, height: 1920 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    const done = await page.getByRole('button', { name: 'Done' }).boundingBox();
    expect(done!.y + done!.height).toBeLessThanOrEqual(size.height);
    const sh = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(sh).toBeLessThanOrEqual(size.height);
  }
  await expect.poll(debug(page).queueLength, { timeout: 15_000 }).toBe(0);
});

test('compose failure shows the staff error and Try again completes the session', async () => {
  const page = await launch({ failCompose: 1 });
  await finishSession(page);
  await expect(page.getByText("We couldn't save your photo. Please call staff.")).toBeVisible({ timeout: 15_000 });
  expect(await debug(page).printCalls()).toBe(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(deliveryHeading(page)).toBeVisible({ timeout: 15_000 });
  expect(await debug(page).printCalls()).toBe(1);
});

test('queued jobs survive an app restart', async () => {
  test.setTimeout(90_000);
  let page = await launch({ failUploads: 1000 });
  await finishSession(page);
  await expect(deliveryHeading(page)).toBeVisible({ timeout: 15_000 });
  // The QR does not wait for the upload: it is visible while the upload job is still queued.
  await expect(page.getByRole('img', { name: 'QR code to download your photo' })).toBeVisible();
  expect(await debug(page).queueLength()).toBeGreaterThan(0);
  await expect(page.getByText('QR unavailable — please call staff')).toHaveCount(0);
  // The session row syncs; the upload keeps failing and stays queued.
  await expect.poll(debug(page).queueLength, { timeout: 10_000 }).toBe(1);
  await app!.close();
  app = undefined;
  expect(existsSync(join(userData, 'queue.json'))).toBe(true);

  page = await launch({ failUploads: 0 });
  await expect(page.getByRole('button', { name: 'Tap to start' })).toBeVisible();
  // The restored upload job is retried after its backoff (5 s after the first failure).
  await expect.poll(debug(page).queueLength, { timeout: 30_000, intervals: [500] }).toBe(0);
});
