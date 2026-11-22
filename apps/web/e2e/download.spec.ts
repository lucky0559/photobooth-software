import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { Seeder, serviceClient } from './fixtures';

const DAY_MS = 24 * 60 * 60 * 1000;
const UPLOADING = 'Your photo is still uploading. Please refresh in a minute.';
const EXPIRED = 'This link has expired.';

const seeder = new Seeder();
let ready: { id: string; token: string };
let readyCreatedAt: Date;
let uploading: { token: string };
let expired: { token: string };
let missingObject: { token: string };

/** A real (decodable) JPEG, encoded by the browser's canvas. */
async function makeJpeg(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 600;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0F1B3D';
    g.fillRect(0, 0, 400, 600);
    g.fillStyle = '#C6F432';
    g.fillRect(40, 40, 320, 240);
    g.fillStyle = '#FF6B2C';
    g.fillRect(40, 320, 320, 240);
    return c.toDataURL('image/jpeg', 0.9);
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

function manilaDay(d: Date): string {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test.beforeAll(async ({ browser }) => {
  const { data, error } = await serviceClient().from('settings').select('link_expiry_days').eq('id', 1).single();
  if (error) throw error;
  const expiryDays = data.link_expiry_days as number;

  const page = await browser.newPage();
  const jpeg = await makeJpeg(page);
  await page.close();

  readyCreatedAt = new Date(Date.now() - 60_000);
  ready = await seeder.session({ status: 'completed', createdAt: readyCreatedAt, photo: true }, jpeg);
  uploading = await seeder.session({ status: 'completed', createdAt: new Date(Date.now() - 60_000) });
  expired = await seeder.session(
    { status: 'completed', createdAt: new Date(Date.now() - (expiryDays + 1) * DAY_MS), photo: true },
    jpeg,
  );
  // photo_path set, but the object was never uploaded.
  missingObject = await seeder.session({ status: 'completed', createdAt: new Date(Date.now() - 60_000), photo: true });
});

test.afterAll(async () => {
  await seeder.cleanup();
});

test('a ready link shows the photo and a Download photo button with a signed attachment URL', async ({ page, request }) => {
  await page.goto(`/d/${ready.token}`);
  await expect(page).toHaveTitle('Your photobooth photo');
  const img = page.getByRole('img', { name: 'Your photobooth photo' });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBeGreaterThan(0);

  const link = page.getByRole('link', { name: 'Download photo' });
  await expect(link).toBeVisible();
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(56);

  const href = (await link.getAttribute('href'))!;
  expect(href).toContain(`/storage/v1/object/sign/photos/${ready.id}.jpg`);
  expect(href).toContain('token=');
  const file = await request.get(href);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('image/jpeg');
  expect(file.headers()['content-disposition']).toContain(`photobooth-${manilaDay(readyCreatedAt)}.jpg`);
});

test('a session without an uploaded photo shows the uploading message', async ({ page }) => {
  await page.goto(`/d/${uploading.token}`);
  await expect(page.getByText(UPLOADING)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download photo' })).toHaveCount(0);
});

test('photo_path set but the object is missing also shows the uploading message', async ({ page }) => {
  const res = await page.goto(`/d/${missingObject.token}`);
  expect(res!.status()).toBe(200);
  await expect(page.getByText(UPLOADING)).toBeVisible();
});

test('an expired link says so and shows no photo', async ({ page }) => {
  await page.goto(`/d/${expired.token}`);
  await expect(page.getByText(EXPIRED)).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(0);
});

test('unknown and malformed tokens are the same plain 404', async ({ page }) => {
  const paths = [
    randomBytes(16).toString('base64url'), // valid format, not in the DB
    'abc',
    'A'.repeat(40),
    '..%2Fetc%2Fpasswd',
    encodeURIComponent('ÄbCdEfGhIjKlMnOpQrSt_-'),
    encodeURIComponent('AbCdEfGhIjKlMnOpQrS t-'),
  ];
  const texts: string[] = [];
  for (const p of paths) {
    const res = await page.goto(`/d/${p}`);
    expect(res!.status(), p).toBe(404);
    await expect(page, p).toHaveTitle('Photo not found'); // a neutral guest title, never the admin's
    texts.push(await page.locator('body').innerText());
  }
  // What the guest sees is identical whether the token was malformed or unknown: no oracle.
  expect(new Set(texts).size).toBe(1);
  expect(texts[0]).toContain('Photo not found');
});

test('the download page sends privacy headers', async ({ request }) => {
  for (const token of [ready.token, uploading.token, randomBytes(16).toString('base64url')]) {
    const res = await request.get(`/d/${token}`);
    const h = res.headers();
    expect(h['cache-control']).toContain('no-store');
    expect(h['x-robots-tag']).toContain('noindex');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
    expect(h['permissions-policy']).toBe('camera=(), microphone=(), geolocation=(), payment=()');
    expect(h['content-security-policy']).toMatch(/img-src[^;]*http:\/\/127\.0\.0\.1:54321/);
  }
  const html = await (await request.get(`/d/${ready.token}`)).text();
  expect(html).toContain('noindex');
});

test('the service role key never reaches the page or the browser bundle', async ({ request }) => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  expect(key.length).toBeGreaterThan(20);
  const html = await (await request.get(`/d/${ready.token}`)).text();
  expect(html).not.toContain(key);

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(join(process.cwd(), '.next', 'static'));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const text = readFileSync(f, 'latin1');
    expect(text.includes(key), f).toBe(false);
    expect(text.includes('SUPABASE_SERVICE_ROLE_KEY'), f).toBe(false);
  }
});

test('screenshots of every download state at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const shots: [string, string][] = [
    ['ready', ready.token],
    ['uploading', uploading.token],
    ['expired', expired.token],
    ['not-found', randomBytes(16).toString('base64url')],
  ];
  for (const [label, token] of shots) {
    await page.goto(`/d/${token}`);
    if (label === 'ready') {
      const img = page.getByRole('img', { name: 'Your photobooth photo' });
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBeGreaterThan(0);
    }
    await page.screenshot({ path: `test-results/screens/download-${label}-phone.png`, fullPage: true });
  }
});
