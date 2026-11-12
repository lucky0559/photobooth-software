import { ATTENTION_AFTER_MS, formatPeso } from '@pb/core';

/**
 * Rows of a capped query (PostgREST max_rows is 1000) can only be summed when the exact count shows nothing was
 * cut off; otherwise null, and the page shows its load error instead of a wrong total.
 */
export function allRowsOrNull<T>(rows: T[] | null, count: number | null): T[] | null {
  if (rows === null || count === null || count > rows.length) return null;
  return rows;
}

/** Refund signals must never silently disappear: say so when the list is capped. */
export function attentionOverflowNote(shown: number, total: number | null): string | null {
  return total !== null && total > shown ? `Showing the newest ${shown} of ${total}` : null;
}

/**
 * PostgREST `or` filter matching core `needsAttention` exactly (paid after cancel, or paid more than
 * ATTENTION_AFTER_MS ago), so the exact count is the number of flagged sessions.
 */
export function attentionFilter(now: Date): string {
  const cutoff = new Date(now.getTime() - ATTENTION_AFTER_MS).toISOString();
  return `status.eq.paid_after_cancel,and(status.eq.paid,created_at.lt."${cutoff}")`;
}

export const STATUS_LABELS: Record<string, string> = {
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  free: 'Free',
  cancelled: 'Cancelled',
  paid_after_cancel: 'Paid after cancel',
  completed: 'Completed',
};

export const ATTENTION_LABELS: Record<string, string> = {
  paid_after_cancel: 'Paid after cancel — consider a refund',
  paid: 'Paid but not completed — consider a refund',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const manilaTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** `MMM d, h:mm a` in Asia/Manila, e.g. "Nov 12, 2:05 PM". */
export function formatManilaTime(iso: string): string {
  return manilaTime.format(new Date(iso));
}

export type PaymentRef = { amount_centavos: number; status: string } | null;

/** PostgREST returns a one-to-one embed as an object, but tolerate an array too. */
export function onePayment(embed: unknown): PaymentRef {
  const p = Array.isArray(embed) ? embed[0] : embed;
  if (!p || typeof p !== 'object') return null;
  const { amount_centavos, status } = p as Record<string, unknown>;
  return typeof amount_centavos === 'number' && typeof status === 'string' ? { amount_centavos, status } : null;
}

/**
 * Money shown for a session comes only from its paid payment (server-written), never from the
 * kiosk-reported `sessions.amount_centavos`. A session without any payment and no charge is free.
 */
export function sessionAmountLabel(s: { status: string; amount_centavos: number }, payment: PaymentRef): string {
  if (payment?.status === 'paid') return formatPeso(payment.amount_centavos);
  if (!payment && (s.status === 'free' || (s.status === 'completed' && s.amount_centavos === 0))) return 'Free';
  return '—';
}
