import { describe, it, expect } from 'vitest';
import { formatPeso, pesosToCentavos } from '../src/money.ts';

describe('formatPeso', () => {
  it('formats centavos with peso sign, thousands separator, 2 decimals', () => {
    expect(formatPeso(15000)).toBe('₱150.00');
    expect(formatPeso(0)).toBe('₱0.00');
    expect(formatPeso(123456)).toBe('₱1,234.56');
  });
});

describe('pesosToCentavos', () => {
  it('parses whole and decimal pesos', () => {
    expect(pesosToCentavos('150')).toBe(15000);
    expect(pesosToCentavos('150.5')).toBe(15050);
    expect(pesosToCentavos(' 1,234.56 ')).toBe(123456);
  });
  it('rejects junk, negatives, and more than 2 decimals', () => {
    expect(pesosToCentavos('abc')).toBeNull();
    expect(pesosToCentavos('-5')).toBeNull();
    expect(pesosToCentavos('1.234')).toBeNull();
    expect(pesosToCentavos('')).toBeNull();
  });
});
