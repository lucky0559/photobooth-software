import { describe, expect, it } from 'vitest';
import { allRowsOrNull, attentionFilter, attentionOverflowNote, formatManilaTime, onePayment, sessionAmountLabel, statusLabel } from './dashboard';

describe('allRowsOrNull (Today total)', () => {
  const rows = [1, 2, 3];
  it('returns the rows when the exact count says none were cut off', () => {
    expect(allRowsOrNull(rows, 3)).toBe(rows);
    expect(allRowsOrNull([], 0)).toEqual([]);
  });
  it('returns null when the server capped the rows (PostgREST max_rows), so no wrong total is shown', () => {
    expect(allRowsOrNull(rows, 4)).toBeNull();
    expect(allRowsOrNull(new Array(1000).fill(0), 1001)).toBeNull();
  });
  it('returns null when the rows or the count are missing', () => {
    expect(allRowsOrNull(null, 3)).toBeNull();
    expect(allRowsOrNull(rows, null)).toBeNull();
  });
});

describe('attentionOverflowNote (Needs attention)', () => {
  it('says how many are hidden when the list is capped', () => {
    expect(attentionOverflowNote(100, 250)).toBe('Showing the newest 100 of 250');
  });
  it('says nothing when every flagged session is shown or the count is unknown', () => {
    expect(attentionOverflowNote(100, 100)).toBeNull();
    expect(attentionOverflowNote(3, 3)).toBeNull();
    expect(attentionOverflowNote(0, 0)).toBeNull();
    expect(attentionOverflowNote(3, null)).toBeNull();
  });
});

describe('attentionFilter', () => {
  it('matches exactly what needsAttention flags: paid after cancel, or paid more than 10 minutes ago', () => {
    expect(attentionFilter(new Date('2026-11-12T06:30:00.000Z'))).toBe(
      'status.eq.paid_after_cancel,and(status.eq.paid,created_at.lt."2026-11-12T06:20:00.000Z")',
    );
  });
});

describe('dashboard helpers', () => {
  it('formats Manila time as MMM d, h:mm a', () => {
    expect(formatManilaTime('2026-11-12T06:05:00Z').replace(/\s/g, ' ')).toBe('Nov 12, 2:05 PM');
    expect(formatManilaTime('2026-11-11T16:00:00Z').replace(/\s/g, ' ')).toBe('Nov 12, 12:00 AM');
  });

  it('takes the amount from the paid payment, never from the session row', () => {
    const paid = { amount_centavos: 15000, status: 'paid' };
    expect(sessionAmountLabel({ status: 'completed', amount_centavos: 99999 }, paid)).toBe('₱150.00');
    expect(sessionAmountLabel({ status: 'completed', amount_centavos: 15000 }, null)).toBe('—');
    expect(sessionAmountLabel({ status: 'awaiting_payment', amount_centavos: 15000 }, { amount_centavos: 15000, status: 'pending' })).toBe('—');
    expect(sessionAmountLabel({ status: 'free', amount_centavos: 0 }, null)).toBe('Free');
    expect(sessionAmountLabel({ status: 'completed', amount_centavos: 0 }, null)).toBe('Free');
  });

  it('reads a one-to-one embed as object or array', () => {
    expect(onePayment({ amount_centavos: 1, status: 'paid' })).toEqual({ amount_centavos: 1, status: 'paid' });
    expect(onePayment([{ amount_centavos: 1, status: 'paid' }])).toEqual({ amount_centavos: 1, status: 'paid' });
    expect(onePayment(null)).toBeNull();
    expect(onePayment([])).toBeNull();
    expect(onePayment({ amount_centavos: '1', status: 'paid' })).toBeNull();
  });

  it('labels statuses in plain words', () => {
    expect(statusLabel('paid_after_cancel')).toBe('Paid after cancel');
    expect(statusLabel('awaiting_payment')).toBe('Awaiting payment');
  });
});
