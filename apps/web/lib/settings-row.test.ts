import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, type KioskSettings } from '@pb/core';
import { centavosToPesoInput, settingsFromRow, settingsToRow, type SettingsRow } from './settings-row';

const row: SettingsRow = {
  price_centavos: 17550,
  free_mode: true,
  shots_per_session: 3,
  countdown_seconds: 10,
  copies_per_session: 2,
  link_expiry_days: 14,
  active_template_id: '00000000-0000-0000-0000-0000000057a1',
};

const settings: KioskSettings = {
  priceCentavos: 17550,
  freeMode: true,
  shotsPerSession: 3,
  countdownSeconds: 10,
  copiesPerSession: 2,
  linkExpiryDays: 14,
  activeTemplateId: '00000000-0000-0000-0000-0000000057a1',
};

describe('settings row mapping', () => {
  it('maps snake_case row to KioskSettings', () => expect(settingsFromRow(row)).toEqual(settings));
  it('maps KioskSettings to snake_case row', () => expect(settingsToRow(settings)).toEqual(row));
  it('round-trips the defaults', () => expect(settingsFromRow(settingsToRow(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS));
});

describe('centavosToPesoInput', () => {
  it('formats for the price input', () => {
    expect(centavosToPesoInput(17500)).toBe('175.00');
    expect(centavosToPesoInput(15005)).toBe('150.05');
    expect(centavosToPesoInput(100000)).toBe('1000.00');
  });
});
