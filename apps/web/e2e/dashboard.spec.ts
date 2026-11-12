import { test, expect } from '@playwright/test';
import { Seeder, serviceClient, signInAsAdmin } from './fixtures';

const MIN = 60_000;
const MANILA_MS = 8 * 60 * MIN;

const manilaDay = (d: Date | string) => new Date(new Date(d).getTime() + MANILA_MS).toISOString().slice(0, 10);
const peso = (c: number) => `₱${Math.floor(c / 100).toLocaleString('en-PH')}.${String(c % 100).padStart(2, '0')}`;

const seeder = new Seeder();
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const now = Date.now();
  const startOfToday = new Date(`${manilaDay(new Date(now))}T00:00:00+08:00`).getTime();
  const at = (ms: number) => new Date(ms);
  const seed = async (name: string, s: Parameters<Seeder['session']>[0]) => {
    ids[name] = (await seeder.session(s)).id;
  };

  // Paid today (Manila): a completed sale, the paid-after-cancel and the stuck paid session below, and a payment at
  // exactly 00:00 Manila today. Paid one second before 00:00 Manila is yesterday.
  await seed('paidToday', { status: 'completed', createdAt: at(now - 2 * MIN), payment: { amountCentavos: 15000, paidAt: at(now - MIN) } });
  await seed('midnight', { status: 'completed', createdAt: at(startOfToday - MIN), payment: { amountCentavos: 2500, paidAt: at(startOfToday) } });
  await seed('yesterday', {
    status: 'completed',
    createdAt: at(startOfToday - 2 * MIN),
    payment: { amountCentavos: 20000, paidAt: at(startOfToday - 1000) },
  });
  await seed('paidAfterCancel', { status: 'paid_after_cancel', createdAt: at(now - 3 * MIN), payment: { amountCentavos: 15000, paidAt: at(now - MIN) } });
  await seed('stuckPaid', { status: 'paid', createdAt: at(now - 15 * MIN), payment: { amountCentavos: 12000, paidAt: at(now - 14 * MIN) } });
  await seed('freshPaid', { status: 'paid', createdAt: at(now - 2 * MIN), payment: { amountCentavos: 15000, paidAt: at(now - MIN) } });
  await seed('freeCompleted', { status: 'completed', createdAt: at(now - 20 * MIN), printError: 'Printer offline (paper jam)' });
  // A kiosk-reported amount without a payment must never count as money.
  await seed('kioskClaims', { status: 'completed', createdAt: at(now - 4 * MIN), amountCentavos: 99900 });
  // Manila boundary on a fixed past day: 15:59 UTC is Nov 1, 16:00 UTC is Nov 2 in Manila.
  await seed('beforeBoundary', { status: 'completed', createdAt: new Date('2026-11-01T15:59:00Z'), payment: { amountCentavos: 15000, paidAt: new Date('2026-11-01T15:59:00Z') } });
  await seed('afterBoundary', { status: 'completed', createdAt: new Date('2026-11-01T16:00:00Z'), payment: { amountCentavos: 15000, paidAt: new Date('2026-11-01T16:00:00Z') } });
});

test.afterAll(async () => {
  await seeder.cleanup();
});

test('the dashboard shows today’s paid sales, the refund list and recent sessions', async ({ page }) => {
  // Expected Today values straight from the payments table (also covers any rows not made by this test).
  const { data, error } = await serviceClient().from('payments').select('session_id, amount_centavos, paid_at').eq('status', 'paid');
  if (error) throw error;
  const today = manilaDay(new Date());
  const todays = data.filter((p) => manilaDay(p.paid_at as string) === today);
  const total = todays.reduce((sum, p) => sum + (p.amount_centavos as number), 0);
  const seededToday = todays.map((p) => p.session_id);
  expect(seededToday).toEqual(expect.arrayContaining([ids.paidToday, ids.midnight, ids.paidAfterCancel, ids.stuckPaid, ids.freshPaid]));
  expect(seededToday).not.toContain(ids.yesterday);

  await signInAsAdmin(page);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByTestId('today-count')).toHaveText(String(todays.length));
  await expect(page.getByTestId('today-total')).toHaveText(peso(total));

  // Needs attention: exactly the paid-after-cancel and the paid session older than 10 minutes.
  const attention = page.getByTestId('attention-list').locator('li');
  const flagged = await attention.evaluateAll((els) => els.map((e) => e.getAttribute('data-session-id')));
  const seededIds = new Set(Object.values(ids));
  expect(flagged.filter((id) => seededIds.has(id!)).sort()).toEqual([ids.paidAfterCancel, ids.stuckPaid].sort());
  await expect(page.locator(`[data-testid="attention-list"] li[data-session-id="${ids.paidAfterCancel}"]`)).toContainText(
    'Paid after cancel — consider a refund',
  );
  const stuck = page.locator(`[data-testid="attention-list"] li[data-session-id="${ids.stuckPaid}"]`);
  await expect(stuck).toContainText('Paid but not completed — consider a refund');
  await expect(stuck).toContainText('₱120.00');

  // Last 50 sessions: Manila time, amount from the payment only, status, print error.
  const row = (name: string) => page.locator(`[data-testid="sessions-table"] tr[data-session-id="${ids[name]}"]`);
  await expect(row('paidToday')).toContainText('₱150.00');
  await expect(row('paidToday')).toContainText('Completed');
  await expect(row('kioskClaims')).not.toContainText('₱');
  await expect(row('freeCompleted')).toContainText('Free');
  await expect(row('freeCompleted')).toContainText('Printer offline (paper jam)');
  await expect(row('paidAfterCancel')).toContainText('Paid after cancel');
  await expect(row('beforeBoundary')).toContainText(/Nov 1, 11:59\sPM/);
  await expect(row('afterBoundary')).toContainText(/Nov 2, 12:00\sAM/);
  expect(manilaDay('2026-11-01T15:59:00Z')).not.toBe(manilaDay('2026-11-01T16:00:00Z'));
});

const VIEWPORTS = [
  { label: 'phone', width: 390, height: 844 },
  { label: 'desktop', width: 1280, height: 800 },
] as const;

test('dashboard screenshots at phone and desktop width', async ({ page }) => {
  await signInAsAdmin(page);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/admin');
    await expect(page.getByTestId('sessions-table')).toBeVisible();
    await page.screenshot({ path: `test-results/screens/dashboard-${vp.label}.png`, fullPage: true });
  }
});
