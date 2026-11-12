'use server';

import { revalidatePath } from 'next/cache';
import type { Result } from '@pb/core';
import { requireAdmin } from '@/lib/auth';

// "Mark refunded" / "Undo" on the dashboard (R20). The write goes through the admin's own session: the database allows
// admins to update payments.refunded_at and nothing else (migration 20261111000006).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MSG = {
  notFound: 'Payment not found or already changed. Refresh the page.',
  saveFailed: 'Could not save. Please try again.',
} as const;

async function setRefunded(paymentId: string, refunded: boolean): Promise<Result<true>> {
  const { supabase } = await requireAdmin();
  if (typeof paymentId !== 'string' || !UUID_RE.test(paymentId)) return { ok: false, errors: { _: MSG.notFound } };

  let query = supabase
    .from('payments')
    .update({ refunded_at: refunded ? new Date().toISOString() : null })
    .eq('id', paymentId)
    .eq('status', 'paid');
  // Only a change: marking twice (two tabs) or undoing an unrefunded payment touches nothing.
  query = refunded ? query.is('refunded_at', null) : query.not('refunded_at', 'is', null);
  const { data, error } = await query.select('id');
  if (error) return { ok: false, errors: { _: MSG.saveFailed } };
  if (!data || data.length !== 1) return { ok: false, errors: { _: MSG.notFound } };

  revalidatePath('/admin');
  return { ok: true, value: true };
}

export async function markRefunded(paymentId: string): Promise<Result<true>> {
  return setRefunded(paymentId, true);
}

export async function undoRefund(paymentId: string): Promise<Result<true>> {
  return setRefunded(paymentId, false);
}
