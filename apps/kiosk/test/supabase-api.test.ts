import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { NOT_KIOSK_ACCOUNT } from '../src/renderer/src/api/kiosk-api';
import { SupabaseKioskApi } from '../src/renderer/src/api/supabase-api';

/** Records the call chain of a supabase-js query builder and resolves to `result`. */
function query(result: unknown) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  for (const m of ['select', 'eq', 'single', 'maybeSingle', 'upsert', 'update']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return builder;
    };
  }
  return { builder, calls };
}

function client(parts: {
  from?: (table: string) => unknown;
  upload?: (...a: unknown[]) => unknown;
  invoke?: (...a: unknown[]) => unknown;
}) {
  const order: string[] = [];
  const db = {
    from: (t: string) => {
      order.push(`from:${t}`);
      return parts.from?.(t);
    },
    storage: {
      from: (bucket: string) => ({
        upload: (...a: unknown[]) => {
          order.push(`upload:${bucket}`);
          return parts.upload?.(...a);
        },
      }),
    },
    functions: { invoke: (...a: unknown[]) => parts.invoke?.(...a) },
  };
  return { db: db as unknown as SupabaseClient, order };
}

describe('SupabaseKioskApi', () => {
  it('uploadPhoto upserts <id>.jpg into photos, then sets sessions.photo_path', async () => {
    const q = query({ error: null });
    const upload = vi.fn(() => ({ data: {}, error: null }));
    const { db, order } = client({ from: () => q.builder, upload });
    const jpeg = new ArrayBuffer(4);

    expect(await new SupabaseKioskApi(db).uploadPhoto('abc', jpeg)).toBe('abc.jpg');
    expect(order).toEqual(['upload:photos', 'from:sessions']);
    expect(upload).toHaveBeenCalledWith('abc.jpg', jpeg, { contentType: 'image/jpeg', upsert: true });
    expect(q.calls).toEqual([
      ['update', [{ photo_path: 'abc.jpg' }]],
      ['eq', ['id', 'abc']],
    ]);
  });

  it('uploadPhoto does not touch the session when the upload fails', async () => {
    const { db, order } = client({ upload: () => ({ data: null, error: new Error('nope') }) });
    await expect(new SupabaseKioskApi(db).uploadPhoto('abc', new ArrayBuffer(1))).rejects.toThrow('nope');
    expect(order).toEqual(['upload:photos']);
  });

  it('upsertSession maps SessionSync to snake_case columns', async () => {
    const q = query({ error: null });
    const { db, order } = client({ from: () => q.builder });
    await new SupabaseKioskApi(db).upsertSession({
      id: 's1',
      downloadToken: 'tok',
      templateId: 't1',
      amountCentavos: 15000,
      status: 'completed',
      printError: null,
      createdAt: '2026-11-11T00:00:00Z',
      completedAt: '2026-11-11T00:01:00Z',
    });
    expect(order).toEqual(['from:sessions']);
    expect(q.calls).toEqual([
      [
        'upsert',
        [
          {
            id: 's1',
            template_id: 't1',
            download_token: 'tok',
            amount_centavos: 15000,
            status: 'completed',
            print_error: null,
            created_at: '2026-11-11T00:00:00Z',
            completed_at: '2026-11-11T00:01:00Z',
          },
        ],
      ],
    ]);
  });

  it('createPayment and cancelPayment call the Edge Functions', async () => {
    const invoke = vi.fn((name: unknown) =>
      name === 'create-payment'
        ? { data: { paymentId: 'p1', qrImageDataUrl: 'data:image/png;base64,AA', amountCentavos: 15000 }, error: null }
        : { data: { status: 'paid' }, error: null },
    );
    const api = new SupabaseKioskApi(client({ invoke }).db);
    const input = { sessionId: 's1', downloadToken: 'tok', templateId: 't1' };
    expect(await api.createPayment(input)).toEqual({
      paymentId: 'p1',
      qrImageDataUrl: 'data:image/png;base64,AA',
      amountCentavos: 15000,
    });
    expect(await api.cancelPayment('p1')).toBe('paid');
    expect(invoke).toHaveBeenNthCalledWith(1, 'create-payment', { body: input });
    expect(invoke).toHaveBeenNthCalledWith(2, 'cancel-payment', { body: { paymentId: 'p1' } });
  });

  it('createPayment rejects a QR that is not a data:image/ URL', async () => {
    const input = { sessionId: 's1', downloadToken: 'tok', templateId: 't1' };
    for (const qrImageDataUrl of ['https://evil.example/qr.png', 'data:text/html,<b>x</b>', '', undefined]) {
      const invoke = vi.fn(() => ({ data: { paymentId: 'p1', qrImageDataUrl, amountCentavos: 15000 }, error: null }));
      const api = new SupabaseKioskApi(client({ invoke }).db);
      await expect(api.createPayment(input)).rejects.toThrow('QR');
    }
  });

  it('getPaymentStatus selects payments.status by id', async () => {
    const q = query({ data: { status: 'pending' }, error: null });
    const { db, order } = client({ from: () => q.builder });
    expect(await new SupabaseKioskApi(db).getPaymentStatus('p1')).toBe('pending');
    expect(order).toEqual(['from:payments']);
    expect(q.calls).toEqual([
      ['select', ['status']],
      ['eq', ['id', 'p1']],
      ['single', []],
    ]);
  });
});

// R21: an admin (or any non-kiosk) account signed in on the kiosk would fail every write forever.
describe('SupabaseKioskApi sign-in role check', () => {
  function authClient(profile: { data: unknown; error: unknown }, signInError: unknown = null) {
    const q = query(profile);
    const signInWithPassword = vi.fn(async () => ({
      data: signInError ? { user: null, session: null } : { user: { id: 'u1' }, session: {} },
      error: signInError,
    }));
    const signOut = vi.fn(async (_o?: unknown) => ({ error: null }));
    const order: string[] = [];
    const db = {
      auth: { signInWithPassword, signOut },
      from: (t: string) => {
        order.push(`from:${t}`);
        return q.builder;
      },
    } as unknown as SupabaseClient;
    return { db, q, signInWithPassword, signOut, order };
  }

  it('a kiosk account signs in and stays signed in', async () => {
    const c = authClient({ data: { role: 'kiosk' }, error: null });
    await new SupabaseKioskApi(c.db).signIn('kiosk@x', 'pw');
    expect(c.signInWithPassword).toHaveBeenCalledWith({ email: 'kiosk@x', password: 'pw' });
    expect(c.order).toEqual(['from:profiles']);
    expect(c.q.calls).toEqual([
      ['select', ['role']],
      ['eq', ['user_id', 'u1']],
      ['maybeSingle', []],
    ]);
    expect(c.signOut).not.toHaveBeenCalled();
  });

  it('an admin account is signed out locally with the fixed error', async () => {
    const c = authClient({ data: { role: 'admin' }, error: null });
    await expect(new SupabaseKioskApi(c.db).signIn('admin@x', 'pw')).rejects.toThrow(NOT_KIOSK_ACCOUNT);
    expect(NOT_KIOSK_ACCOUNT).toBe('This account is not a kiosk account.');
    expect(c.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('an account without a profile row is not a kiosk account either', async () => {
    const c = authClient({ data: null, error: null });
    await expect(new SupabaseKioskApi(c.db).signIn('nobody@x', 'pw')).rejects.toThrow(NOT_KIOSK_ACCOUNT);
    expect(c.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('a profile read error signs out and rethrows (never a half-checked session)', async () => {
    const c = authClient({ data: null, error: new Error('network down') });
    await expect(new SupabaseKioskApi(c.db).signIn('kiosk@x', 'pw')).rejects.toThrow('network down');
    expect(c.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('a failed sign-in never reads the profile', async () => {
    const c = authClient({ data: { role: 'kiosk' }, error: null }, new Error('Invalid login credentials'));
    await expect(new SupabaseKioskApi(c.db).signIn('kiosk@x', 'bad')).rejects.toThrow('Invalid login credentials');
    expect(c.order).toEqual([]);
  });

  it('signOut ends only this device session (local scope)', async () => {
    const c = authClient({ data: null, error: null });
    await new SupabaseKioskApi(c.db).signOut();
    expect(c.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
