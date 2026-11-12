import { describe, expect, it } from 'vitest';
import { formatManilaTime, onePayment, sessionAmountLabel, statusLabel } from './dashboard';

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
