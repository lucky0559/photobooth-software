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
// The first comma group has no leading zero ("0,100" is not a number).
const WITH_COMMAS = /^[1-9]\d{0,2}(,\d{3})+(\.\d{1,2})?$/;
const PLAIN = /^\d+(\.\d{1,2})?$/;
// 13 whole-peso digits keep every result well inside Number.MAX_SAFE_INTEGER centavos.
const MAX_WHOLE_DIGITS = 13;

/** Parse a peso string ("1,234.56") to integer centavos, or null if invalid or too large to be exact. */
export function pesosToCentavos(input: string): number | null {
  const trimmed = input.trim();
  if (!WITH_COMMAS.test(trimmed) && !PLAIN.test(trimmed)) return null;
  const [whole = '', frac = ''] = trimmed.replace(/,/g, '').split('.');
  if (whole.replace(/^0+(?=\d)/, '').length > MAX_WHOLE_DIGITS) return null;
  const centavos = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(centavos) ? centavos : null;
}
