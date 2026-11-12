import { test, expect, type Page } from '@playwright/test';
import {
  KIOSK,
  SEED_TEMPLATE_ID,
  serviceClient,
  signIn,
  signInAsAdmin,
  writeFixtures,
} from './fixtures';

const RUN = `e2e-${Date.now().toString(36)}`;
const STRIP_MESSAGE = 'Strip templates must be exactly 600 × 1800 px (2×6 in at 300 DPI)';
const PNG_MESSAGE = 'Template must be a PNG with transparent photo areas';

let files: ReturnType<typeof writeFixtures>;
let settingsSnapshot: Record<string, unknown> | null = null;


test.beforeAll(async () => {
  files = writeFixtures();
  const { data, error } = await serviceClient().from('settings').select('*').eq('id', 1).single();
  if (error) throw error;
  settingsSnapshot = data;
});

// Leave the local DB as it was: restore the settings row, delete templates (and objects) this run created.
test.afterAll(async () => {
  const db = serviceClient();
  if (settingsSnapshot) {
    const { id: _id, ...rest } = settingsSnapshot;
    await db.from('settings').update(rest).eq('id', 1);
  }
  const { data: rows } = await db.from('templates').select('id, overlay_path').like('name', `${RUN}%`);
  if (rows && rows.length > 0) {
    await db.storage.from('templates').remove(rows.map((r) => r.overlay_path as string));
    await db.from('templates').delete().in('id', rows.map((r) => r.id as string));
  }
});

function templateRow(page: Page, name: string) {
  return page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
}

async function upload(page: Page, name: string, layout: 'strip_2x6' | 'print_4r', file: string) {
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Layout').selectOption(layout);
  // The browser-reported type is irrelevant: the server checks the bytes.
  await page.getByLabel('PNG file').setInputFiles(file);
  await page.getByRole('button', { name: 'Upload template' }).click();
}

test('logged-out /admin/settings redirects to the login page', async ({ page }) => {
  await page.goto('/admin/settings');
  await expect(page).toHaveURL(/\/admin\/login(\?|$)/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('responses carry the security headers and no x-powered-by', async ({ request }) => {
  const res = await request.get('/admin/login');
  const h = res.headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).toContain(`img-src 'self' data: blob: ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin}`);
  expect(h['x-powered-by']).toBeUndefined();
});

test('the next parameter cannot redirect off-site', async ({ page }) => {
  await page.goto('/admin/login?next=//evil.example');
  await page.getByLabel('Email').fill('admin@local.test');
  await page.getByLabel('Password').fill('localpass123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/admin$/);
});

test('wrong password shows a generic error', async ({ page }) => {
  await signIn(page, { email: 'admin@local.test', password: 'wrong-password' });
  await expect(page).toHaveURL(/\/admin\/login\?error=invalid/);
  await expect(page.locator('#login-error')).toHaveText('Invalid email or password');
});

test('a kiosk account cannot use the admin', async ({ page }) => {
  await signIn(page, KIOSK);
  await expect(page).toHaveURL(/\/admin\/login\?error=not_admin/);
  await expect(page.locator('#login-error')).toHaveText('This account is not an admin');
  await page.goto('/admin/settings');
  await expect(page).toHaveURL(/\/admin\/login(\?|$)/);
});

test('settings: save a price, reload, and reject an out-of-range price', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/admin/settings');
  const price = page.getByLabel('Price per session (₱)');

  await price.fill('175');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved');
  await page.reload();
  await expect(price).toHaveValue('175.00');

  await price.fill('10');
  await page.getByRole('button', { name: 'Save settings' }).click();
  const error = page.getByText('Price must be between ₱20.00 and ₱1,000.00');
  await expect(error).toBeVisible();
  await expect(price).toHaveAttribute('aria-invalid', 'true');
  await expect(price).toHaveAttribute('aria-describedby', /price-error/);
  await page.reload();
  await expect(price).toHaveValue('175.00');
});

test('templates: upload, set active, guard archive, reject bad files', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/admin/templates');
  const name = `${RUN} strip`;

  await upload(page, name, 'strip_2x6', files.strip);
  const row = templateRow(page, name);
  await expect(row).toBeVisible();
  await expect(row.getByText('Strip (2×6)')).toBeVisible();
  await expect(row.getByRole('img')).toBeVisible();

  // A second tab opened now still shows "Archive" on our row after it becomes active (stale page).
  const stale = await page.context().newPage();
  await stale.goto('/admin/templates');
  const staleRow = templateRow(stale, name);
  await expect(staleRow.getByRole('button', { name: 'Archive' })).toBeVisible();

  const seedRow = page.getByRole('listitem').filter({ has: page.getByText('Sample strip', { exact: true }) });
  await expect(seedRow.getByText('Active', { exact: true })).toBeVisible();
  await expect(seedRow.getByRole('button', { name: 'Archive' })).toHaveCount(0); // hidden on the active row
  await row.getByRole('button', { name: 'Set active' }).click();
  await expect(row.getByText('Active', { exact: true })).toBeVisible();
  await expect(seedRow.getByText('Active', { exact: true })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Archive' })).toHaveCount(0);

  // The server refuses even when the (stale) page offers the button.
  await staleRow.getByRole('button', { name: 'Archive' }).click();
  await expect(staleRow.getByText('Choose another active template first')).toBeVisible();
  await stale.close();

  await upload(page, `${RUN} wide`, 'strip_2x6', files.wide);
  await expect(page.getByText(STRIP_MESSAGE)).toBeVisible();
  await expect(templateRow(page, `${RUN} wide`)).toHaveCount(0);

  await upload(page, `${RUN} jpeg`, 'strip_2x6', files.fakeJpeg);
  await expect(page.getByText(PNG_MESSAGE)).toBeVisible();
  await expect(templateRow(page, `${RUN} jpeg`)).toHaveCount(0);

  // Right size, but RGB without tRNS: no transparent photo areas.
  await upload(page, `${RUN} opaque`, 'strip_2x6', files.opaque);
  await expect(page.getByText(PNG_MESSAGE)).toBeVisible();
  await expect(templateRow(page, `${RUN} opaque`)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/screens/templates-errors-desktop.png', fullPage: true });

  // Hand the active slot back to the seeded template, then archive ours.
  await seedRow.getByRole('button', { name: 'Set active' }).click();
  await expect(seedRow.getByText('Active', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Archive' }).click();
  await expect(row).toHaveCount(0);

  const { data } = await serviceClient().from('settings').select('active_template_id').eq('id', 1).single();
  expect(data?.active_template_id).toBe(SEED_TEMPLATE_ID);
});

const UPLOAD_FAILED = 'Upload failed. The file may be larger than this server accepts (limit 10 MB).';

for (const vp of [
  { label: 'phone', width: 390, height: 844 },
  { label: 'desktop', width: 1280, height: 800 },
] as const) {
  test(`templates: a rejected upload request shows a fixed message, not an error page (${vp.label})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await signInAsAdmin(page);
    await page.goto('/admin/templates');
    await expect(page.getByText('PNG up to 10 MB')).toBeVisible();

    // Simulate the host refusing the body (Vercel answers 413 above its limit) before the action runs.
    await page.route('**/admin/templates', async (route) => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        await route.fulfill({ status: 413, contentType: 'text/plain', body: 'Request Entity Too Large' });
      } else {
        await route.continue();
      }
    });
    await upload(page, `${RUN} too big ${vp.label}`, 'strip_2x6', files.strip);
    await expect(page.getByRole('alert').filter({ hasText: UPLOAD_FAILED })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upload a template' })).toBeVisible(); // still the page
    await page.screenshot({ path: `test-results/screens/templates-upload-failed-${vp.label}.png`, fullPage: true });
  });
}
