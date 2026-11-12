import { formatPeso } from '@pb/core';

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
