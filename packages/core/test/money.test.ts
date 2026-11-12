import { describe, it, expect } from 'vitest';
import { formatPeso, pesosToCentavos } from '../src/money.ts';

describe('formatPeso', () => {
  it('formats centavos with peso sign, thousands separator, 2 decimals', () => {
    expect(formatPeso(15000)).toBe('₱150.00');
    expect(formatPeso(0)).toBe('₱0.00');
    expect(formatPeso(123456)).toBe('₱1,234.56');
  });
  it('formats small and large amounts', () => {
    expect(formatPeso(5)).toBe('₱0.05');
    expect(formatPeso(1234567890)).toBe('₱12,345,678.90');
  });
  it('formats negative amounts with the sign before the peso sign', () => {
    expect(formatPeso(-150)).toBe('-₱1.50');
    expect(formatPeso(-250)).toBe('-₱2.50');
    expect(formatPeso(-123456)).toBe('-₱1,234.56');
    expect(formatPeso(-0)).toBe('₱0.00');
  });
  it('throws RangeError for non-integer or non-finite input', () => {
    expect(() => formatPeso(1.5)).toThrow(RangeError);
    expect(() => formatPeso(-2.5)).toThrow(RangeError);
    expect(() => formatPeso(Number.NaN)).toThrow(RangeError);
    expect(() => formatPeso(Infinity)).toThrow(RangeError);
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
  it('accepts commas only as thousands separators', () => {
    expect(pesosToCentavos('1,234')).toBe(123400);
    expect(pesosToCentavos('12,345,678.9')).toBe(1234567890);
    expect(pesosToCentavos('100,000')).toBe(10000000);
  });
  it('rejects misplaced commas', () => {
    expect(pesosToCentavos('1,50')).toBeNull();
    expect(pesosToCentavos('1,2,3')).toBeNull();
    expect(pesosToCentavos(',100')).toBeNull();
    expect(pesosToCentavos('100,')).toBeNull();
    expect(pesosToCentavos('1234,567')).toBeNull();
    expect(pesosToCentavos('1,234.5,6')).toBeNull();
    expect(pesosToCentavos('1,,234')).toBeNull();
  });
  it('rejects whitespace inside the number', () => {
    expect(pesosToCentavos('1 234')).toBeNull();
  });
  it('handles decimal-point and zero edge cases', () => {
    expect(pesosToCentavos('.5')).toBeNull();
    expect(pesosToCentavos('5.')).toBeNull();
    expect(pesosToCentavos('0')).toBe(0);
    expect(pesosToCentavos('0.00')).toBe(0);
    expect(pesosToCentavos('007')).toBe(700);
  });
});
