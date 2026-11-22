import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_MAIN } from './kiosk-app';

const appDir = join(__dirname, '..');

interface PbDebug {
  printCalls(): Promise<number>;
  lastSheet(): Promise<{ width: number; height: number; type: string } | null>;
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

const PAIRED = { settings: { freeMode: true, countdownSeconds: 3, shotsPerSession: 2, pairedPrint: true } };
const HELD_MSG = 'Your print comes out when the next guest finishes, or in about 10 minutes. Ask the owner for your print.';

async function launch(fake: Record<string, unknown> = {}, env: Record<string, string> = {}): Promise<Page> {
  app = await electron.launch({
    args: [E2E_MAIN],
    cwd: appDir,
    env: {
      ...process.env,
      PB_FAKE_CAMERA: '1',
      PB_FAKE_PRINT: '1',
      PB_USER_DATA: userData,
      PB_FAKE_CONFIG: JSON.stringify({
        settings: { freeMode: true, countdownSeconds: 3, shotsPerSession: 2 },
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
  printCalls: () => page.evaluate(() => (globalThis as unknown as { __pbDebug: PbDebug }).__pbDebug.printCalls()),
  lastSheet: () => page.evaluate(() => (globalThis as unknown as { __pbDebug: PbDebug }).__pbDebug.lastSheet()),
});

const deliveryHeading = (page: Page) => page.getByRole('heading', { name: 'Scan to download your photo' });
const heldFile = () => join(userData, 'held-strip.json');
const readHeld = () =>
  JSON.parse(readFileSync(heldFile(), 'utf8')) as { held: { sessionId: string; filePath: string; heldAt: number } | null };

test('two guests in a row print one sheet: 0 prints, then 1', async () => {
  test.setTimeout(120_000);
  const page = await launch(PAIRED);
  const d = debug(page);

  await finishSession(page);
  await expect(deliveryHeading(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(HELD_MSG)).toBeVisible();
  expect(await d.printCalls()).toBe(0);
  expect(await d.lastSheet()).toEqual({ width: 600, height: 1800, type: 'image/jpeg' });
  const { held } = readHeld();
  expect(held).not.toBeNull();
  expect(held!.filePath).toBe(join(userData, 'photos', `${held!.sessionId}.jpg`));

  await page.getByRole('button', { name: 'Done' }).click();
  await finishSession(page);
  await expect(deliveryHeading(page)).toBeVisible({ timeout: 15_000 });
  expect(await d.printCalls()).toBe(1);
  await expect(page.getByText(HELD_MSG)).toHaveCount(0);
  expect(readHeld().held).toBeNull();
  expect(readdirSync(join(userData, 'photos')).filter((f) => f.endsWith('.jpg'))).toHaveLength(2);
});

test('a held strip past the wait prints alone from the attract screen', async () => {
  test.setTimeout(120_000);
  const page = await launch({ ...PAIRED, pairWaitMs: 2000, pairPollMs: 500 });
  const d = debug(page);

  await finishSession(page);
  await expect(deliveryHeading(page)).toBeVisible({ timeout: 15_000 });
  expect(await d.printCalls()).toBe(0);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(d.printCalls, { timeout: 15_000 }).toBe(1);
  expect(readHeld().held).toBeNull();
});

test('an old held strip prints after a restart', async () => {
  test.setTimeout(120_000);
  const first = await launch(PAIRED);
  await finishSession(first);
  await expect(deliveryHeading(first)).toBeVisible({ timeout: 15_000 });
  expect(await debug(first).printCalls()).toBe(0);
  expect(readHeld().held).not.toBeNull();
  await app!.close();
  app = undefined;

  const page = await launch({ ...PAIRED, pairWaitMs: 1000, pairPollMs: 500 });
  await expect(page.getByRole('button', { name: 'Tap to start' })).toBeVisible({ timeout: 20_000 });
  await expect.poll(debug(page).printCalls, { timeout: 15_000 }).toBe(1);
  expect(readHeld().held).toBeNull();
});

test('without pairedPrint nothing is held and the sheet prints as today', async () => {
  test.setTimeout(120_000);
  const page = await launch();
  const d = debug(page);
  await finishSession(page);
  await expect(deliveryHeading(page)).toBeVisible({ timeout: 15_000 });
  expect(await d.printCalls()).toBe(1);
  expect(await d.lastSheet()).toEqual({ width: 1200, height: 1800, type: 'image/jpeg' });
  await expect(page.getByText(HELD_MSG)).toHaveCount(0);
  expect(existsSync(heldFile())).toBe(false);
});
