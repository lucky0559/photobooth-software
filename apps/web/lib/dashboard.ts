import { ATTENTION_AFTER_MS, formatPeso, needsAttention } from '@pb/core';

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

// ---------------------------------------------------------------------------
// Needs attention / refunds (R20): one row per flagged PAYMENT the operator may have to refund
// ---------------------------------------------------------------------------

/** Newest flagged payments shown; the overflow note says when there are more. */
export const ATTENTION_LIMIT = 100;
/** Newest refunded payments listed under "Refunded" (with Undo). */
export const REFUNDED_LIMIT = 20;

/**
 * Sessions query columns for Needs attention: `payments!inner` so filters on the payment (not refunded) also filter
 * the sessions and their exact count.
 */
export const ATTENTION_COLUMNS =
  'id, created_at, status, payments!inner(id, provider_intent_id, amount_centavos, paid_at, refunded_at, status)';

/** Payments query columns for the Refunded list. */
export const REFUNDED_COLUMNS = 'id, provider_intent_id, amount_centavos, paid_at, refunded_at, sessions(id, created_at)';

export interface AttentionRow {
  paymentId: string;
  sessionId: string;
  intentId: string;
  amountCentavos: number;
  paidAt: string | null;
  sessionCreatedAt: string;
  label: string;
}

export interface RefundedRow {
  paymentId: string;
  sessionId: string | null;
  intentId: string;
  amountCentavos: number;
  paidAt: string | null;
  refundedAt: string;
  sessionCreatedAt: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const one = (embed: unknown): Record<string, unknown> | null => {
  const v = Array.isArray(embed) ? embed[0] : embed;
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
};

/**
 * Flagged sessions (paid after cancel, or paid and not completed after 10 minutes, exactly core `needsAttention`)
 * whose payment is paid and NOT marked refunded. Malformed rows are dropped.
 */
export function toAttentionRows(rows: Record<string, unknown>[], now: Date): AttentionRow[] {
  const out: AttentionRow[] = [];
  for (const r of rows) {
    const sessionId = str(r.id);
    const createdAt = str(r.created_at);
    const status = str(r.status);
    const p = one(r.payments);
    if (!sessionId || !createdAt || !status || !p) continue;
    if (!needsAttention({ status, createdAt }, now)) continue;
    const paymentId = str(p.id);
    const intentId = str(p.provider_intent_id);
    if (!paymentId || !intentId || typeof p.amount_centavos !== 'number') continue;
    if (p.status !== 'paid' || p.refunded_at != null) continue;
    out.push({
      paymentId,
      sessionId,
      intentId,
      amountCentavos: p.amount_centavos,
      paidAt: str(p.paid_at),
      sessionCreatedAt: createdAt,
      label: ATTENTION_LABELS[status] ?? statusLabel(status),
    });
  }
  return out;
}

/** Payments marked refunded, newest first as queried. Malformed rows (or ones not refunded) are dropped. */
export function toRefundedRows(rows: Record<string, unknown>[]): RefundedRow[] {
  const out: RefundedRow[] = [];
  for (const r of rows) {
    const paymentId = str(r.id);
    const intentId = str(r.provider_intent_id);
    const refundedAt = str(r.refunded_at);
    if (!paymentId || !intentId || !refundedAt || typeof r.amount_centavos !== 'number') continue;
    const s = one(r.sessions);
    out.push({
      paymentId,
      sessionId: s ? str(s.id) : null,
      intentId,
      amountCentavos: r.amount_centavos,
      paidAt: str(r.paid_at),
      refundedAt,
      sessionCreatedAt: s ? str(s.created_at) : null,
    });
  }
  return out;
}
