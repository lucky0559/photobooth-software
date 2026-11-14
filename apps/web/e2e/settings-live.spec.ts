import { test, expect } from '@playwright/test';
import { serviceClient, signInAsAdmin } from './fixtures';

let snapshot: Record<string, unknown> | null = null;

test.beforeAll(async () => {
  const { data, error } = await serviceClient().from('settings').select('*').eq('id', 1).single();
  if (error) throw error;
  snapshot = data;
});

// Leave the local DB as it was.
test.afterAll(async () => {
  if (!snapshot) return;
  const { id: _id, ...rest } = snapshot;
  await serviceClient().from('settings').update(rest).eq('id', 1);
});

type Shown = { price: string; free: boolean; shots: string; countdown: string; copies: string; expiry: string };

async function shown(page: import('@playwright/test').Page): Promise<Shown> {
  return {
    price: await page.getByLabel('Price per session (₱)').inputValue(),
    free: await page.getByLabel('Free mode').isChecked(),
    shots: await page.getByLabel('Shots per session').inputValue(),
    countdown: await page.getByLabel('Countdown (seconds)').inputValue(),
    copies: await page.getByLabel('Printed copies').inputValue(),
    expiry: await page.getByLabel('Download link expiry (days)').inputValue(),
  };
}

test('saved settings show immediately after Save, with no reload, and match what a reload shows', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/admin/settings');
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeVisible();

  const before = await shown(page);
  // change every field to something different from what is saved now
  const next: Shown = {
    price: before.price === '175.50' ? '180' : '175.5',
    free: !before.free,
    shots: before.shots === '2' ? '3' : '2',
    countdown: before.countdown === '3' ? '10' : '3',
    copies: before.copies === '2' ? '3' : '2',
    expiry: before.expiry === '9' ? '12' : '9',
  };
  await page.getByLabel('Price per session (₱)').fill(next.price);
  if ((await page.getByLabel('Free mode').isChecked()) !== next.free) await page.getByLabel('Free mode').click();
  await page.getByLabel('Shots per session').selectOption(next.shots);
  await page.getByLabel('Countdown (seconds)').selectOption(next.countdown);
  await page.getByLabel('Printed copies').selectOption(next.copies);
  await page.getByLabel('Download link expiry (days)').fill(next.expiry);

  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved');

  // No reload: the form must already show what was saved (price re-formatted to two decimals).
  const expected: Shown = { ...next, price: Number(next.price).toFixed(2) };
  const live = await shown(page);
  expect(live).toEqual(expected);

  await page.reload();
  expect(await shown(page)).toEqual(expected);

  // Busy state: slow the save down, the button must show a spinner and be disabled until it finishes.
  await page.route('**/admin/settings', async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 900));
    await route.continue();
  });
  const save = page.getByRole('button', { name: /Sav(e settings|ing…)/ });
  await page.getByLabel('Shots per session').selectOption('3');
  await save.click();
  await expect(save).toBeDisabled();
  await expect(save.locator('.spinner')).toBeVisible();
  await expect(save).toContainText('Saving…');
  await expect(page.getByRole('status')).toHaveText('Settings saved');
  await expect(save.locator('.spinner')).toHaveCount(0);
  await page.unroute('**/admin/settings');

  // A second save of different values must also show immediately.
  await page.getByLabel('Price per session (₱)').fill('200');
  await page.getByLabel('Shots per session').selectOption('1');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved');
  const second = await shown(page);
  expect(second.price).toBe('200.00');
  expect(second.shots).toBe('1');
});

test('buttons and nav links dim on hover', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/admin/settings');
  const opacity = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => getComputedStyle(el).opacity);

  const save = page.getByRole('button', { name: 'Save settings' });
  expect(await opacity(save)).toBe('1');
  await save.hover();
  await expect.poll(() => opacity(save)).toBe('0.75');

  const templates = page.getByRole('link', { name: 'Templates' });
  await templates.hover();
  await expect.poll(() => opacity(templates)).toBe('0.75');

  const signOut = page.getByRole('button', { name: 'Sign out' });
  await signOut.hover();
  await expect.poll(() => opacity(signOut)).toBe('0.75');
});
