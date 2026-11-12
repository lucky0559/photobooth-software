/**
 * Format integer centavos as a peso string, e.g. 123456 -> "₱1,234.56", -150 -> "-₱1.50".
 * Throws RangeError for non-integer or non-finite input (money is always integer centavos).
 */
export function formatPeso(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) throw new RangeError('formatPeso expects integer centavos');
  const abs = Math.abs(centavos);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const sign = centavos < 0 ? '-' : '';
  return `${sign}₱${whole.toLocaleString('en-PH')}.${String(frac).padStart(2, '0')}`;
}

// Commas are allowed only as proper thousands separators ("1,234"), never "1,50" or "1,2,3".
const WITH_COMMAS = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;
const PLAIN = /^\d+(\.\d{1,2})?$/;

/** Parse a peso string ("1,234.56") to integer centavos, or null if invalid. */
export function pesosToCentavos(input: string): number | null {
  const trimmed = input.trim();
  if (!WITH_COMMAS.test(trimmed) && !PLAIN.test(trimmed)) return null;
  const [whole = '', frac = ''] = trimmed.replace(/,/g, '').split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
