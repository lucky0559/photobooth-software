/** Format integer centavos as a peso string, e.g. 123456 -> "₱1,234.56". */
export function formatPeso(centavos: number): string {
  const whole = Math.floor(centavos / 100);
  const frac = centavos % 100;
  return `₱${whole.toLocaleString('en-PH')}.${String(frac).padStart(2, '0')}`;
}

/** Parse a peso string ("1,234.56") to integer centavos, or null if invalid. */
export function pesosToCentavos(input: string): number | null {
  const s = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
