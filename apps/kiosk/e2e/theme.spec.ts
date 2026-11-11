import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appDir = join(__dirname, '..');
const shotsDir = join(appDir, 'test-results', 'theme');

interface PbDebug {
  killCamera(): void;
}

const VIEWPORTS = [
  { name: 'portrait', width: 1080, height: 1920 },
  { name: 'landscape', width: 1920, height: 1080 },
] as const;

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

async function launch(viewport: { width: number; height: number }, settings = { freeMode: true }): Promise<Page> {
  app = await electron.launch({
    args: [appDir],
    cwd: appDir,
    env: {
      ...process.env,
      PB_FAKE_CAMERA: '1',
      PB_USER_DATA: userData,
      PB_FAKE_CONFIG: JSON.stringify({ settings: { ...settings, countdownSeconds: 3, shotsPerSession: 2 } }),
    },
  });
  const page = await app.firstWindow();
  await page.setViewportSize(viewport);
  return page;
}

/** No page scroll in either direction: everything fits the kiosk screen. */
async function expectNoScroll(page: Page): Promise<void> {
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
    iw: innerWidth,
    ih: innerHeight,
  }));
  expect(m.sw, 'scrollWidth').toBeLessThanOrEqual(m.iw);
  expect(m.sh, 'scrollHeight').toBeLessThanOrEqual(m.ih);
}

async function expectInsideViewport(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  const vp = page.viewportSize();
  expect(box).not.toBeNull();
  expect(vp).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp!.height);
}

/**
 * Decor marks are decorative only: hidden from AT and no pointer events. Foreground decor never touches a button or
 * the camera frame; the full-screen backdrop and the countdown's iris sit behind/inside by design and are exempt
 * from the overlap check only.
 */
async function expectDecorClear(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const decor = [...document.querySelectorAll<SVGSVGElement>('svg.decor')];
    const foreground = decor.filter((d) => !d.closest('.backdrop, .countdown'));
    const guarded = [...document.querySelectorAll<HTMLElement>('button, .camera-frame')];
    const overlaps: string[] = [];
    for (const d of foreground) {
      const a = d.getBoundingClientRect();
      for (const g of guarded) {
        const b = g.getBoundingClientRect();
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
          overlaps.push(`${d.getAttribute('class')} overlaps ${g.textContent || g.className}`);
        }
      }
    }
    return {
      count: foreground.length,
      overlaps,
      exposed: decor.filter((d) => d.getAttribute('aria-hidden') !== 'true').length,
      clickable: decor.filter((d) => getComputedStyle(d).pointerEvents !== 'none').length,
    };
  });
  expect(report.count).toBeGreaterThan(0);
  expect(report.overlaps).toEqual([]);
  expect(report.exposed).toBe(0);
  expect(report.clickable).toBe(0);
}

async function snap(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: join(shotsDir, `${name}.png`) });
}

for (const vp of VIEWPORTS) {
  test(`themed Attract, Capture and Review fit ${vp.width}×${vp.height}`, async () => {
    const page = await launch(vp);

    // Attract
    const start = page.getByRole('button', { name: 'Tap to start' });
    await expect(page.getByText('Smile!', { exact: true })).toBeVisible();
    await expect(page.getByText('Free today!', { exact: true })).toBeVisible();
    await expect(start).toBeEnabled();
    await expectInsideViewport(page, start);
    await expectNoScroll(page);
    await expectDecorClear(page);
    // The bundled display font actually loads (a family with no faces would make `fonts.check` vacuously true).
    expect(await page.evaluate(async () => (await document.fonts.load('40px Bungee')).length)).toBeGreaterThan(0);
    await snap(page, `attract-${vp.name}`);

    // Capture
    await start.click();
    const frame = page.locator('.camera-frame');
    await expect(page.locator('video')).toBeVisible();
    await expect(page.getByText('Say cheese!', { exact: true })).toBeVisible();
    await expect(page.getByText('Shot 1 of 2')).toBeVisible();
    await expect(page.locator('.countdown__num')).toBeVisible();
    await expectInsideViewport(page, frame);
    await expectNoScroll(page);
    await expectDecorClear(page);
    await snap(page, `capture-${vp.name}`);

    // Capture error, then retry back into the session.
    await page.evaluate(() => (globalThis as unknown as { __pbDebug: PbDebug }).__pbDebug.killCamera());
    const retry = page.getByRole('button', { name: 'Try again' });
    await expect(page.getByText('Camera not available. Please call staff.')).toBeVisible();
    await expectInsideViewport(page, retry);
    await expectNoScroll(page);
    await snap(page, `capture-error-${vp.name}`);
    await retry.click();

    // Review
    await expect(page.getByRole('heading', { name: 'Pick a look' })).toBeVisible({ timeout: 20_000 });
    for (const label of ['Original', 'Black & White', 'Warm']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    const print = page.getByRole('button', { name: 'Print', exact: true });
    await expect(print).toBeVisible();
    await expect(page.getByText(/retake/i)).toHaveCount(0);
    await expect(page.getByRole('timer')).toHaveText(/^[01]:[0-5]\d$/);
    await expect(page.locator('.filter-tile__thumb img')).toHaveCount(3);
    await page.getByRole('button', { name: 'Warm', exact: true }).click();
    await expectInsideViewport(page, print);
    await expectNoScroll(page);
    await expectDecorClear(page);
    await snap(page, `review-${vp.name}`);

    // Output placeholder (printing arrives in Task 9).
    await print.click();
    await expect(page.getByText('Printing your photo…')).toBeVisible();
    await expectNoScroll(page);
    await snap(page, `output-${vp.name}`);
  });
}

for (const vp of VIEWPORTS) {
  test(`paid session: themed payment shell with timer pill fits ${vp.width}×${vp.height}`, async () => {
    const page = await launch(vp, { freeMode: false });
    await page.getByRole('button', { name: 'Tap to start' }).click();
    await expect(page.getByRole('heading', { name: 'Payment' })).toBeVisible();
    // Display-only countdown derived from payment.startedAt + PAYMENT_TIMEOUT_MS (180 s).
    await expect(page.getByRole('timer')).toHaveText(/^(3:00|2:5\d)$/);
    await expectInsideViewport(page, page.locator('.qr-slot'));
    await expectNoScroll(page);
    await expectDecorClear(page);
    await snap(page, `payment-${vp.name}`);
  });
}

test('reduced motion turns off sticker wobble and the start-button pulse', async () => {
  const page = await launch(VIEWPORTS[0]);
  await expect(page.getByRole('button', { name: 'Tap to start' })).toBeEnabled();
  const animations = () =>
    page.evaluate(() => [
      ...[...document.querySelectorAll('.decor--wobble')].map((el) => getComputedStyle(el).animationName),
      ...[...document.querySelectorAll('.action--pulse')].map((el) => getComputedStyle(el, '::after').animationName),
    ]);
  expect((await animations()).some((name) => name !== 'none')).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await animations();
  expect(reduced.length).toBeGreaterThan(0);
  expect(reduced.every((name) => name === 'none')).toBe(true);
});
