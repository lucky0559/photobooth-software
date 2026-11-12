import type { KioskSettings } from '@pb/core';

/** The single `public.settings` row as Postgres returns it. */
export interface SettingsRow {
  price_centavos: number;
  free_mode: boolean;
  shots_per_session: number;
  countdown_seconds: number;
  copies_per_session: number;
  link_expiry_days: number;
  active_template_id: string | null;
}

export const SETTINGS_COLUMNS =
  'price_centavos, free_mode, shots_per_session, countdown_seconds, copies_per_session, link_expiry_days, active_template_id';

/** DB row -> KioskSettings. The DB CHECK constraints guarantee the narrowed ranges. */
export function settingsFromRow(row: SettingsRow): KioskSettings {
  return {
    priceCentavos: row.price_centavos,
    freeMode: row.free_mode,
    shotsPerSession: row.shots_per_session as KioskSettings['shotsPerSession'],
    countdownSeconds: row.countdown_seconds as KioskSettings['countdownSeconds'],
    copiesPerSession: row.copies_per_session as KioskSettings['copiesPerSession'],
    linkExpiryDays: row.link_expiry_days,
    activeTemplateId: row.active_template_id,
  };
}

/** KioskSettings -> DB columns. */
export function settingsToRow(s: KioskSettings): SettingsRow {
  return {
    price_centavos: s.priceCentavos,
    free_mode: s.freeMode,
    shots_per_session: s.shotsPerSession,
    countdown_seconds: s.countdownSeconds,
    copies_per_session: s.copiesPerSession,
    link_expiry_days: s.linkExpiryDays,
    active_template_id: s.activeTemplateId,
  };
}

/** Centavos as the plain peso text the price input uses, e.g. 17500 -> "175.00" (no ₱, no grouping). */
export function centavosToPesoInput(centavos: number): string {
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}
