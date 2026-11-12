// Supabase clients, kiosk authentication and the Postgres PaymentStore for the Edge Functions.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { HttpError, requireEnv } from './http.ts';
import type { PaymentStatus, PaymentStore } from './payments.ts';

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** Service-role client: bypasses RLS. Server-side only; the key comes from the Edge Function environment. */
export function serviceClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), noSession);
}

/**
 * Verifies the caller's JWT with Supabase Auth and requires a `profiles.role = 'kiosk'` row.
 * Returns the kiosk's user id, which is the only source of kiosk_id (never the request body).
 * Throws HttpError 401 (no or invalid token) or 403 (valid user that is not a kiosk).
 */
export async function requireKiosk(req: Request, db: SupabaseClient): Promise<string> {
  const header = req.headers.get('authorization') ?? '';
  const m = header.match(/^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  if (!m) throw new HttpError(401, 'unauthorized');
  const anon = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), noSession);
  const { data, error } = await anon.auth.getUser(m[1]);
  if (error || !data.user) throw new HttpError(401, 'unauthorized');
  const { data: profile, error: pErr } = await db
    .from('profiles')
    .select('role')
    .eq('user_id', data.user.id)
    .maybeSingle<{ role: string }>();
  if (pErr) throw pErr;
  if (profile?.role !== 'kiosk') throw new HttpError(403, 'forbidden');
  return data.user.id;
}

const STATUSES: readonly PaymentStatus[] = ['pending', 'paid', 'failed', 'cancelled'];
const asStatus = (v: unknown): PaymentStatus | null => (STATUSES.includes(v as PaymentStatus) ? (v as PaymentStatus) : null);

async function rpcText<T extends string>(db: SupabaseClient, fn: string, args: Record<string, unknown>, allowed: readonly T[]): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  if (!allowed.includes(data as T)) throw new Error(`${fn} returned an unexpected value`);
  return data as T;
}

/** Thin wrapper over the SQL functions in 20261111000002_payment_functions.sql (each one atomic). */
export class SupabasePaymentStore implements PaymentStore {
  constructor(private readonly db: SupabaseClient) {}

  markPaidIfPending(intentId: string, paidAt: string) {
    return rpcText(this.db, 'mark_payment_paid', { p_intent: intentId, p_paid_at: paidAt }, [
      'updated',
      'not_pending',
      'not_found',
    ] as const);
  }

  async getStatusByIntent(intentId: string): Promise<PaymentStatus | null> {
    const { data, error } = await this.db
      .from('payments')
      .select('status')
      .eq('provider_intent_id', intentId)
      .maybeSingle<{ status: string }>();
    if (error) throw error;
    return data ? asStatus(data.status) : null;
  }

  markPaidAfterCancel(intentId: string, paidAt: string) {
    return rpcText(this.db, 'mark_payment_paid_after_cancel', { p_intent: intentId, p_paid_at: paidAt }, [
      'updated',
      'not_cancelled',
    ] as const);
  }

  cancelIfPending(paymentId: string, kioskId: string) {
    return rpcText(this.db, 'cancel_payment', { p_payment: paymentId, p_kiosk: kioskId }, [
      'cancelled',
      'not_pending',
      'forbidden',
      'not_found',
    ] as const);
  }

  async getStatus(paymentId: string): Promise<PaymentStatus | null> {
    const { data, error } = await this.db.from('payments').select('status').eq('id', paymentId).maybeSingle<{ status: string }>();
    if (error) throw error;
    return data ? asStatus(data.status) : null;
  }

  /** Raw webhook event, for the operator; informational only. */
  async recordEvent(intentId: string, event: unknown): Promise<void> {
    const { error } = await this.db.from('payments').update({ last_event: event }).eq('provider_intent_id', intentId);
    if (error) throw error;
  }
}
