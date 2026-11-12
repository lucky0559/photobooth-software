import { test, expect } from '@playwright/test';
import { Seeder, serviceClient, signInAsAdmin } from './fixtures';

const MIN = 60_000;
const MANILA_MS = 8 * 60 * MIN;

const manilaDay = (d: Date | string) => new Date(new Date(d).getTime() + MANILA_MS).toISOString().slice(0, 10);
const peso = (c: number) => `₱${Math.floor(c / 100).toLocaleString('en-PH')}.${String(c % 100).padStart(2, '0')}`;

const DAY = 24 * 60 * MIN;

const seeder = new Seeder();
const ids: Record<string, string> = {};
// The Manila day the seeds were made for; the page and the expectations both use it.
let seedDay = '';
let nearMidnight = false;

test.beforeAll(async () => {
  const now = Date.now();
  seedDay = manilaDay(new Date(now));
  const startOfToday = new Date(`${seedDay}T00:00:00+08:00`).getTime();
  // Seeds made just before Manila midnight would be "yesterday" by the time the page loads: skip instead of flaking.
  nearMidnight = startOfToday + DAY - now < 5 * MIN;
  if (nearMidnight) return;
  const at = (ms: number) => new Date(ms);
  // "Paid a few minutes ago" must still be today right after Manila midnight.
  const todayAt = (ms: number) => at(Math.max(ms, startOfToday + 1000));
  const seed = async (name: string, s: Parameters<Seeder['session']>[0]) => {
    ids[name] = (await seeder.session(s)).id;
  };

  // Paid today (Manila): a completed sale, the paid-after-cancel and the stuck paid session below, and a payment at
  // exactly 00:00 Manila today. Paid one second before 00:00 Manila is yesterday.
  await seed('paidToday', { status: 'completed', createdAt: at(now - 2 * MIN), payment: { amountCentavos: 15000, paidAt: todayAt(now - MIN) } });
  await seed('midnight', { status: 'completed', createdAt: at(startOfToday - MIN), payment: { amountCentavos: 2500, paidAt: at(startOfToday) } });
  await seed('yesterday', {
    status: 'completed',
    createdAt: at(startOfToday - 2 * MIN),
    payment: { amountCentavos: 20000, paidAt: at(startOfToday - 1000) },
  });
  await seed('paidAfterCancel', { status: 'paid_after_cancel', createdAt: at(now - 3 * MIN), payment: { amountCentavos: 15000, paidAt: todayAt(now - MIN) } });
  await seed('stuckPaid', { status: 'paid', createdAt: at(now - 15 * MIN), payment: { amountCentavos: 12000, paidAt: todayAt(now - 14 * MIN) } });
  await seed('freshPaid', { status: 'paid', createdAt: at(now - 2 * MIN), payment: { amountCentavos: 15000, paidAt: todayAt(now - MIN) } });
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
  test.skip(nearMidnight, 'within 5 minutes before Manila midnight: the page would already be on the next day');
  // Expected Today values straight from the payments table (also covers any rows not made by this test).
  const { data, error } = await serviceClient().from('payments').select('session_id, amount_centavos, paid_at').eq('status', 'paid');
  if (error) throw error;
  const today = seedDay;
  expect(manilaDay(new Date()), 'the Manila day changed during the test').toBe(today);
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
  await expect(page.getByText("An offline booth's sessions appear here until it reconnects.")).toBeVisible();
  // Fewer than 100 flagged sessions locally: no "Showing the newest 100 of N" note.
  await expect(page.getByTestId('attention-overflow')).toHaveCount(0);

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

test('needs attention shows the intent id and paid time; Mark refunded moves a payment to Refunded and Undo brings it back', async ({ page }) => {
  test.skip(nearMidnight, 'no seeded sessions near Manila midnight');
  const { data, error } = await serviceClient()
    .from('payments')
    .select('id, session_id, provider_intent_id')
    .in('session_id', [ids.paidAfterCancel, ids.stuckPaid]);
  if (error) throw error;
  const bySession = new Map(data.map((p) => [p.session_id as string, p as { id: string; provider_intent_id: string }]));
  const stuckPay = bySession.get(ids.stuckPaid)!;
  const pacPay = bySession.get(ids.paidAfterCancel)!;

  await signInAsAdmin(page);
  const attentionRow = (sessionId: string) => page.locator(`[data-testid="attention-list"] li[data-session-id="${sessionId}"]`);
  await expect(attentionRow(ids.paidAfterCancel)).toContainText(pacPay.provider_intent_id);
  await expect(attentionRow(ids.stuckPaid)).toContainText(stuckPay.provider_intent_id);
  await expect(attentionRow(ids.stuckPaid)).toContainText(/Paid \w{3} \d{1,2}, \d{1,2}:\d{2}\s[AP]M/);
  await expect(attentionRow(ids.stuckPaid)).toContainText('Session started');

  // Inline confirmation: the first click only asks.
  await attentionRow(ids.stuckPaid).getByRole('button', { name: 'Mark refunded' }).click();
  await attentionRow(ids.stuckPaid).getByRole('button', { name: 'Cancel' }).click();
  await expect(attentionRow(ids.stuckPaid).getByRole('button', { name: 'Mark refunded' })).toBeVisible();
  await attentionRow(ids.stuckPaid).getByRole('button', { name: 'Mark refunded' }).click();
  await attentionRow(ids.stuckPaid).getByRole('button', { name: 'Yes, mark refunded' }).click();

  await expect(attentionRow(ids.stuckPaid)).toHaveCount(0);
  await expect(attentionRow(ids.paidAfterCancel)).toHaveCount(1);
  const refundedRow = page.locator(`[data-testid="refunded-list"] li[data-payment-id="${stuckPay.id}"]`);
  await page.getByText(/Refunded \(last 20\)/).click();
  await expect(refundedRow).toBeVisible();
  await expect(refundedRow).toContainText(stuckPay.provider_intent_id);
  const { data: marked } = await serviceClient().from('payments').select('refunded_at, status').eq('id', stuckPay.id).single();
  expect(marked?.refunded_at).toBeTruthy();
  expect(marked?.status).toBe('paid');

  await refundedRow.getByRole('button', { name: 'Undo' }).click();
  await expect(attentionRow(ids.stuckPaid)).toHaveCount(1);
  await expect(refundedRow).toHaveCount(0);
  const { data: undone } = await serviceClient().from('payments').select('refunded_at').eq('id', stuckPay.id).single();
  expect(undone?.refunded_at).toBeNull();
});

const VIEWPORTS = [
  { label: 'phone', width: 390, height: 844 },
  { label: 'desktop', width: 1280, height: 800 },
] as const;

test('dashboard screenshots at phone and desktop width', async ({ page }) => {
  test.skip(nearMidnight, 'no seeded sessions near Manila midnight');
  await signInAsAdmin(page);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/admin');
    await expect(page.getByTestId('sessions-table')).toBeVisible();
    await page.screenshot({ path: `test-results/screens/dashboard-${vp.label}.png`, fullPage: true });
  }
});
