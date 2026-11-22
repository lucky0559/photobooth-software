import { formatPeso, manilaDayKey, summarizeDay } from '@pb/core';
import { requireAdmin } from '@/lib/auth';
import {
  ATTENTION_COLUMNS,
  ATTENTION_LIMIT,
  REFUNDED_COLUMNS,
  REFUNDED_LIMIT,
  allRowsOrNull,
  attentionFilter,
  attentionOverflowNote,
  formatManilaTime,
  onePayment,
  sessionAmountLabel,
  statusLabel,
  toAttentionRows,
  toRefundedRows,
  type PaymentRef,
} from '@/lib/dashboard';
import { RefundButton } from './refund-button';

export const dynamic = 'force-dynamic';

const LOAD_ERROR = 'Could not load sales data. Refresh the page to try again.';
const DAY_MS = 24 * 60 * 60 * 1000;

type SessionRow = {
  id: string;
  created_at: string;
  status: string;
  amount_centavos: number;
  print_error: string | null;
  payment: PaymentRef;
};

const SESSION_COLUMNS = 'id, created_at, status, amount_centavos, print_error, payments(amount_centavos, status)';

function toSessionRows(rows: Record<string, unknown>[]): SessionRow[] {
  return rows.map((r) => ({
    id: r.id as string,
    created_at: r.created_at as string,
    status: r.status as string,
    amount_centavos: r.amount_centavos as number,
    print_error: (r.print_error as string | null) ?? null,
    payment: onePayment(r.payments),
  }));
}

export default async function Dashboard() {
  // Each page checks itself; layouts are not a security boundary. Data comes through the admin's own
  // session (RLS lets admins read sessions and payments), not the service role.
  const { supabase } = await requireAdmin();
  const now = new Date();
  const today = manilaDayKey(now.toISOString());
  const dayStart = new Date(`${today}T00:00:00+08:00`);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);

  // Money comes only from server-written payments, grouped by paid_at in Asia/Manila.
  // Exact counts: the Today total must never be a silently truncated sum, and capped refund signals are announced.
  const [paidToday, attention, refunded, recent] = await Promise.all([
    supabase
      .from('payments')
      .select('amount_centavos, paid_at', { count: 'exact' })
      .eq('status', 'paid')
      .gte('paid_at', dayStart.toISOString())
      .lt('paid_at', dayEnd.toISOString()),
    // One row per flagged session with a paid payment that is not marked refunded (payments!inner: the payment
    // filters also apply to the sessions and their exact count).
    supabase
      .from('sessions')
      .select(ATTENTION_COLUMNS, { count: 'exact' })
      .or(attentionFilter(now))
      .eq('payments.status', 'paid')
      .is('payments.refunded_at', null)
      .order('created_at', { ascending: false })
      .limit(ATTENTION_LIMIT),
    supabase
      .from('payments')
      .select(REFUNDED_COLUMNS)
      .not('refunded_at', 'is', null)
      .order('refunded_at', { ascending: false })
      .limit(REFUNDED_LIMIT),
    supabase.from('sessions').select(SESSION_COLUMNS).order('created_at', { ascending: false }).limit(50),
  ]);

  const paidRows = paidToday.error ? null : allRowsOrNull(paidToday.data ?? [], paidToday.count);
  const summary = paidRows
    ? summarizeDay(
        paidRows.map((p) => ({ amountCentavos: p.amount_centavos as number, paidAt: p.paid_at as string })),
        today,
      )
    : null;
  const flagged = attention.error ? null : toAttentionRows(attention.data ?? [], now);
  const overflow = flagged ? attentionOverflowNote(flagged.length, attention.count) : null;
  const refundedRows = refunded.error ? null : toRefundedRows(refunded.data ?? []);
  const sessions = recent.error ? null : toSessionRows(recent.data ?? []);

  return (
    <>
      <h1>Dashboard</h1>

      <section className="card today" aria-labelledby="today-heading">
        <h2 id="today-heading">Today</h2>
        {summary ? (
          <dl className="today-stats">
            <div>
              <dt>Paid sessions</dt>
              <dd data-testid="today-count">{summary.count}</dd>
            </div>
            <div>
              <dt>Sales</dt>
              <dd data-testid="today-total">{formatPeso(summary.totalCentavos)}</dd>
            </div>
          </dl>
        ) : (
          <p className="alert" role="alert">
            {LOAD_ERROR}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="attention-heading">
        <h2 id="attention-heading">Needs attention</h2>
        {flagged === null ? (
          <p className="alert" role="alert">
            {LOAD_ERROR}
          </p>
        ) : flagged.length === 0 ? (
          <p className="hint">Nothing needs attention.</p>
        ) : (
          <>
            {overflow && (
              <p className="hint" data-testid="attention-overflow">
                {overflow}
              </p>
            )}
            <ul className="attention-list" data-testid="attention-list">
              {flagged.map((a) => (
                <li key={a.paymentId} data-session-id={a.sessionId} data-payment-id={a.paymentId}>
                  <span className="attention-amount">{formatPeso(a.amountCentavos)}</span>
                  <span className="attention-time">Paid {a.paidAt ? formatManilaTime(a.paidAt) : '—'}</span>
                  <span className="attention-label">{a.label}</span>
                  <span className="attention-intent" data-testid="attention-intent">
                    {a.intentId}
                  </span>
                  <span className="attention-meta">Session started {formatManilaTime(a.sessionCreatedAt)}</span>
                  <RefundButton paymentId={a.paymentId} mode="mark" />
                </li>
              ))}
            </ul>
            <p className="hint">
              Search the PayMongo dashboard for the payment intent id (pi_…), refund it there, then press Mark refunded.
              An offline booth&apos;s sessions appear here until it reconnects.
            </p>
          </>
        )}
        {refundedRows === null ? (
          <p className="alert" role="alert">
            {LOAD_ERROR}
          </p>
        ) : (
          refundedRows.length > 0 && (
            <details className="refunded" data-testid="refunded">
              <summary>Refunded (last {REFUNDED_LIMIT})</summary>
              <ul className="attention-list refunded-list" data-testid="refunded-list">
                {refundedRows.map((r) => (
                  <li key={r.paymentId} data-session-id={r.sessionId ?? undefined} data-payment-id={r.paymentId}>
                    <span className="attention-amount">{formatPeso(r.amountCentavos)}</span>
                    <span className="attention-time">Refunded {formatManilaTime(r.refundedAt)}</span>
                    <span className="attention-intent">{r.intentId}</span>
                    <span className="attention-meta">Paid {r.paidAt ? formatManilaTime(r.paidAt) : '—'}</span>
                    <RefundButton paymentId={r.paymentId} mode="undo" />
                  </li>
                ))}
              </ul>
            </details>
          )
        )}
      </section>

      <section aria-labelledby="sessions-heading">
        <h2 id="sessions-heading">Recent sessions</h2>
        {sessions === null ? (
          <p className="alert" role="alert">
            {LOAD_ERROR}
          </p>
        ) : sessions.length === 0 ? (
          <p className="hint">No sessions yet.</p>
        ) : (
          <div className="table-wrap" role="region" aria-labelledby="sessions-heading" tabIndex={0}>
            <table className="sessions" data-testid="sessions-table">
              <caption className="visually-hidden">Last 50 sessions, newest first (Manila time)</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col">Print error</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} data-session-id={s.id}>
                    <td className="nowrap col-time">{formatManilaTime(s.created_at)}</td>
                    <td className="nowrap col-amount">{sessionAmountLabel(s, s.payment)}</td>
                    <td className="col-status">{statusLabel(s.status)}</td>
                    <td className={s.print_error ? 'print-error' : 'print-error print-error-none'}>
                      {s.print_error ? (
                        <>
                          <span className="phone-label">Print error: </span>
                          {s.print_error}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
