import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appDir = join(__dirname, '..');

type Rgba = [number, number, number, number];

interface PbDebug {
  lastSheet(): Promise<{ width: number; height: number; type: string } | null>;
  lastSheetPixel(x: number, y: number): Promise<Rgba | null>;
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

/** Launches with the fake strip template and runs a free 2-shot capture through to Review. */
async function toReview(): Promise<Page> {
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
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Tap to start' }).click();
  await expect(page.getByRole('heading', { name: 'Pick a look' })).toBeVisible({ timeout: 15_000 });
  return page;
}

const debug = (page: Page) => ({
  lastSheet: () => page.evaluate(() => (globalThis as unknown as { __pbDebug: PbDebug }).__pbDebug.lastSheet()),
  pixel: (x: number, y: number) =>
    page.evaluate(
      ([px, py]) => (globalThis as unknown as { __pbDebug: PbDebug }).__pbDebug.lastSheetPixel(px, py),
      [x, y] as const,
    ),
});

/** RGBA at (x, y) of the Review preview canvas. */
const previewPixel = (page: Page, x: number, y: number) =>
  page.locator('canvas').evaluate(
    (c: HTMLCanvasElement, [px, py]) => Array.from(c.getContext('2d')!.getImageData(px, py, 1, 1).data) as Rgba,
    [x, y] as const,
  );

/** Largest channel difference: 0 for a pure gray pixel. */
const chroma = ([r, g, b]: Rgba): number => Math.max(r, g, b) - Math.min(r, g, b);

// Photo pixels in the second slot of the 600×1800 strip (slot 2 of 2 spans y 800–1540, x 40–560).
const PHOTO_POINTS: Array<[number, number]> = [
  [100, 900],
  [300, 900],
  [500, 1200],
  [300, 1500],
];

test('Warm + Print composes a 1200×1800 JPEG with two identical strip halves', async () => {
  const page = await toReview();
  for (const label of ['Original', 'Black & White', 'Warm']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await expect(page.locator('canvas')).toBeVisible();

  await page.getByRole('button', { name: 'Warm', exact: true }).click();
  await page.getByRole('button', { name: 'Print', exact: true }).click();

  const d = debug(page);
  await expect.poll(d.lastSheet, { timeout: 10_000 }).toEqual({ width: 1200, height: 1800, type: 'image/jpeg' });
  // Both strip copies are identical. The right copy starts at x=600, off the 16-px JPEG MCU grid,
  // so compare per channel with a small tolerance rather than exactly.
  for (const [x, y] of [
    [300, 900],
    [150, 400],
  ] as const) {
    const left = (await d.pixel(x, y))!;
    const right = (await d.pixel(x + 600, y))!;
    for (let c = 0; c < 4; c++) expect(Math.abs(left[c]! - right[c]!), `channel ${c} at (${x}, ${y})`).toBeLessThanOrEqual(6);
  }

  // The fake overlay's #d6336c footer band (bottom 220 px) is drawn on top, unfiltered, on both halves.
  for (const x of [300, 900]) {
    const [r, g, b] = (await d.pixel(x, 1640))!;
    expect(Math.abs(r - 0xd6) + Math.abs(g - 0x33) + Math.abs(b - 0x6c)).toBeLessThanOrEqual(12);
  }
});

test('Black & White renders photo pixels gray in the preview and the sheet', async () => {
  const page = await toReview();
  const canvas = page.locator('canvas');
  // The preview is the layout at half scale.
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([300, 900]);

  // Original: the fake camera frame is colored, so at least one photo pixel has clear chroma.
  await expect
    .poll(async () => {
      const px = await Promise.all(PHOTO_POINTS.map(([x, y]) => previewPixel(page, x / 2, y / 2)));
      return Math.max(...px.map(chroma));
    })
    .toBeGreaterThan(30);

  await page.getByRole('button', { name: 'Black & White', exact: true }).click();
  await expect
    .poll(async () => {
      const px = await Promise.all(PHOTO_POINTS.map(([x, y]) => previewPixel(page, x / 2, y / 2)));
      return Math.max(...px.map(chroma));
    })
    .toBeLessThanOrEqual(2);

  await page.getByRole('button', { name: 'Print', exact: true }).click();
  const d = debug(page);
  await expect.poll(d.lastSheet, { timeout: 10_000 }).toEqual({ width: 1200, height: 1800, type: 'image/jpeg' });
  for (const [x, y] of PHOTO_POINTS) {
    const px = await d.pixel(x, y);
    // JPEG chroma subsampling may leave a tiny residue on an otherwise gray pixel.
    expect(chroma(px!)).toBeLessThanOrEqual(4);
  }
});
