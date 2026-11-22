import type { KioskSettings } from './types.ts';

export function sessionAmountCentavos(settings: KioskSettings): number {
  return settings.freeMode ? 0 : settings.priceCentavos;
}
