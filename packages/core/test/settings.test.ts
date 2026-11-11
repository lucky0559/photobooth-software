import { describe, it, expect } from 'vitest';
import { validateSettings } from '../src/settings.ts';
import { DEFAULT_SETTINGS } from '../src/session-machine.ts';

describe('validateSettings', () => {
  it('accepts defaults', () => expect(validateSettings(DEFAULT_SETTINGS)).toEqual({ ok: true, value: DEFAULT_SETTINGS }));
  it('rejects price below ₱20 and above ₱1,000 with exact message', () => {
    for (const p of [1999, 100001, 150.5]) {
      const r = validateSettings({ ...DEFAULT_SETTINGS, priceCentavos: p });
      expect(r).toEqual({ ok: false, errors: { priceCentavos: 'Price must be between ₱20.00 and ₱1,000.00' } });
    }
  });
  it('reports every invalid field at once', () => {
    const r = validateSettings({ ...DEFAULT_SETTINGS, shotsPerSession: 5, countdownSeconds: 4, linkExpiryDays: 0 });
    expect(r.ok === false && Object.keys(r.errors).sort()).toEqual(['countdownSeconds', 'linkExpiryDays', 'shotsPerSession']);
  });
  it('rejects non-objects', () => {
    expect(validateSettings(null)).toEqual({ ok: false, errors: { _: 'Settings must be an object' } });
  });
  it('validates copies, template and free mode', () => {
    const r = validateSettings({ ...DEFAULT_SETTINGS, copiesPerSession: 5, activeTemplateId: 3, freeMode: 'yes' });
    expect(r).toEqual({ ok: false, errors: {
      copiesPerSession: 'Copies must be 1 to 4',
      activeTemplateId: 'Template must be a string or null',
      freeMode: 'Free mode must be on or off',
    } });
  });
});
