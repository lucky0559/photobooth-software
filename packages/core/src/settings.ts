import type { KioskSettings } from './types.ts';
import type { Result } from './result.ts';

export const DEFAULT_SETTINGS: KioskSettings = {
  priceCentavos: 15000,
  freeMode: false,
  shotsPerSession: 4,
  countdownSeconds: 5,
  copiesPerSession: 1,
  linkExpiryDays: 7,
  activeTemplateId: null,
};

export function validateSettings(input: unknown): Result<KioskSettings> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: { _: 'Settings must be an object' } };
  }
  const s = input as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const isInt = (v: unknown, min: number, max: number): boolean =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

  if (!isInt(s.priceCentavos, 2000, 100000)) errors.priceCentavos = 'Price must be between ₱20.00 and ₱1,000.00';
  if (typeof s.freeMode !== 'boolean') errors.freeMode = 'Free mode must be on or off';
  if (!isInt(s.shotsPerSession, 1, 4)) errors.shotsPerSession = 'Shots must be 1 to 4';
  if (s.countdownSeconds !== 3 && s.countdownSeconds !== 5 && s.countdownSeconds !== 10) {
    errors.countdownSeconds = 'Countdown must be 3, 5, or 10 seconds';
  }
  if (!isInt(s.copiesPerSession, 1, 4)) errors.copiesPerSession = 'Copies must be 1 to 4';
  if (!isInt(s.linkExpiryDays, 1, 30)) errors.linkExpiryDays = 'Link expiry must be 1 to 30 days';
  if (s.activeTemplateId !== null && typeof s.activeTemplateId !== 'string') {
    errors.activeTemplateId = 'Template must be a string or null';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: s as unknown as KioskSettings };
}
