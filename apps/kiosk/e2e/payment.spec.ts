import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appDir = join(__dirname, '..');
const shotsDir = join(appDir, 'test-results', 'theme');

interface PbDebug {
  createPaymentCalls(): number;
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

/** Paid session at the default ₱150.00 price. */
async function launch(fake: Record<string, unknown>): Promise<Page> {
  app = await electron.launch({
    args: [appDir],
    cwd: appDir,
    env: {
      ...process.env,
      PB_FAKE_CAMERA: '1',
      PB_FAKE_PRINT: '1',
      PB_USER_DATA: userData,
      PB_FAKE_CONFIG: JSON.stringify({
        settings: { freeMode: false, countdownSeconds: 3, shotsPerSession: 2 },
        payAfterMs: null,
        ...fake,
      }),
    },
  });
  return app.firstWindow();
}

async function startPaidSession(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Tap to start' }).click();
  await expect(page.getByRole('img', { name: 'Payment QR code' })).toBeVisible();
  await expect(page.getByText('₱150.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Scan with GCash, Maya, or your bank app', { exact: true })).toBeVisible();
}

const captureScreen = (page: Page) => page.getByText('Say cheese!', { exact: true });
const attractScreen = (page: Page) => page.getByRole('button', { name: 'Tap to start' });
const createPaymentCalls = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __pbDebug: PbDebug }).__pbDebug.createPaymentCalls());

test('QR with ₱150.00, then Capture once the payment lands', async () => {
  const page = await launch({ payAfterMs: 1500 });
  await startPaidSession(page);
  await expect(page.getByRole('timer')).toHaveText(/^(3:00|2:5\d)$/);
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(captureScreen(page)).toBeVisible({ timeout: 5_000 });
});

test('Cancel answered "cancelled" returns to attract', async () => {
  const page = await launch({ cancelReturns: 'cancelled' });
  await startPaidSession(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(attractScreen(page)).toBeVisible();
});

test('Cancel answered "paid" goes on to Capture (guest paid at the last second)', async () => {
  const page = await launch({ cancelReturns: 'paid' });
  await startPaidSession(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(captureScreen(page)).toBeVisible();
});

test('createPayment failure shows the staff message, then returns to attract after 10 s', async () => {
  const page = await launch({ createPaymentFails: true });
  await page.getByRole('button', { name: 'Tap to start' }).click();
  await expect(page.getByText('Payments are unavailable right now. Please call staff.', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Payment QR code' })).toHaveCount(0);
  // Still up after a few seconds: the 10 s are not cut short.
  await page.waitForTimeout(5_000);
  await expect(page.getByText('Payments are unavailable right now. Please call staff.')).toBeVisible();
  await expect(attractScreen(page)).toBeVisible({ timeout: 8_000 });
});

test('a failing cancel shows "Checking your payment…" and follows the eventual answer', async () => {
  const page = await launch({ cancelThrows: 2, cancelReturns: 'paid' });
  await startPaidSession(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Checking your payment…', { exact: true })).toBeVisible();
  // Two failures, retried 2 s apart, then the server says paid.
  await expect(captureScreen(page)).toBeVisible({ timeout: 8_000 });
});

test('createPayment runs exactly once per session', async () => {
  const page = await launch({});
  await startPaidSession(page);
  // Let a few poll rounds and re-renders pass.
  await page.waitForTimeout(4_500);
  expect(await createPaymentCalls(page)).toBe(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(attractScreen(page)).toBeVisible();
  // A second session creates its own (one more) payment.
  await startPaidSession(page);
  expect(await createPaymentCalls(page)).toBe(2);
});

// The ₱ glyph in the display font: checked by eye on these screenshots (Task 8b review follow-up).
for (const vp of [
  { name: 'portrait', width: 1080, height: 1920 },
  { name: 'landscape', width: 1920, height: 1080 },
]) {
  test(`payment amount screenshot ${vp.width}×${vp.height}`, async () => {
    const page = await launch({});
    await page.setViewportSize(vp);
    await startPaidSession(page);
    const sh = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(sh).toBeLessThanOrEqual(vp.height);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.screenshot({ path: join(shotsDir, `payment-amount-${vp.name}.png`) });
  });
}
