import { test, expect, type APIRequestContext } from '@playwright/test';
import { ADMIN, KIOSK, serviceClient, sessionCookies, signedInClient, signIn } from './fixtures';

// Settings are restored to this snapshot after the file runs.
let snapshot: Record<string, unknown> | null = null;

test.beforeAll(async () => {
  const { data, error } = await serviceClient().from('settings').select('*').eq('id', 1).single();
  if (error) throw error;
  snapshot = data;
});

test.afterAll(async () => {
  if (!snapshot) return;
  const { id: _id, ...rest } = snapshot;
  await serviceClient().from('settings').update(rest).eq('id', 1);
});

async function priceInDb(): Promise<number> {
  const { data, error } = await serviceClient().from('settings').select('price_centavos').eq('id', 1).single();
  if (error) throw error;
  return data.price_centavos as number;
}

test('typing the kiosk credentials into the admin login does not end the booth session', async ({ page }) => {
  const booth = await signedInClient(KIOSK); // stands in for the physical kiosk's own login

  await signIn(page, KIOSK);
  await expect(page).toHaveURL(/\/admin\/login\?error=not_admin/);
  await expect(page.locator('#login-error')).toHaveText('This account is not an admin');

  const { data, error } = await booth.auth.refreshSession();
  expect(error).toBeNull();
  expect(data.session).not.toBeNull();
  const { data: user, error: userError } = await booth.auth.getUser();
  expect(userError).toBeNull();
  expect(user.user?.email).toBe(KIOSK.email);
  await booth.auth.signOut({ scope: 'local' });
});

test('a kiosk session cookie cannot open admin pages or run the saveSettings action', async ({ browser, baseURL }) => {
  const base = baseURL ?? '';

  // 1. Capture a real saveSettings call (action id + encoded body) from an admin page, without running it.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, ADMIN);
  await expect(adminPage).toHaveURL(/\/admin$/);
  await adminPage.goto('/admin/settings');
  let captured: { headers: Record<string, string>; body: Buffer } | null = null;
  await adminPage.route('**/admin/settings', async (route) => {
    const req = route.request();
    const body = req.postDataBuffer();
    if (req.method() === 'POST' && req.headers()['next-action'] && body) {
      captured = { headers: req.headers(), body };
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await adminPage.getByLabel('Price per session (₱)').fill('999');
  await adminPage.getByRole('button', { name: 'Save settings' }).click();
  await expect.poll(() => captured !== null).toBe(true);
  const before = await priceInDb();
  expect(before).not.toBe(99900);

  const replay = (request: APIRequestContext, path: string) =>
    request.post(`${base}${path}`, {
      headers: {
        'next-action': captured!.headers['next-action'],
        'content-type': captured!.headers['content-type'],
        accept: 'text/x-component',
        origin: base,
      },
      data: captured!.body,
      maxRedirects: 0,
    });

  // 2. A browser holding only the kiosk's Supabase auth cookies.
  const kioskContext = await browser.newContext();
  await kioskContext.addCookies(await sessionCookies(KIOSK, base));
  const kioskPage = await kioskContext.newPage();
  await kioskPage.goto('/admin/settings');
  await expect(kioskPage).toHaveURL(/\/admin\/login(\?|$)/);

  // 3. Replay the captured action with the kiosk cookies. On its own page the middleware answers 307 to the
  //    login page. Posted to /admin/login (which the middleware lets through) Next forwards the action to its
  //    page internally, where the middleware stops it again, so no action result comes back. (The action's own
  //    requireAdmin() is unreachable over HTTP here; lib/actions-guard.test.ts covers it.)
  const onPage = await replay(kioskContext.request, '/admin/settings');
  expect(onPage.status()).toBe(307);
  expect(onPage.headers()['location']).toMatch(/\/admin\/login/);
  const forwarded = await replay(kioskContext.request, '/admin/login');
  expect(await forwarded.text()).not.toContain('"ok"');
  expect(await priceInDb()).toBe(before);

  // 4. Positive control: the same bytes with the admin's cookies do run the action, so the replay is real.
  const control = await replay(adminContext.request, '/admin/login');
  expect(await control.text()).toContain('"ok":true');
  expect(await priceInDb()).toBe(99900); // afterAll restores the snapshot

  await adminContext.close();
  await kioskContext.close();
});
