import { DEFAULT_SETTINGS, formatPeso, type KioskSettings, type Template } from '@pb/core';
import { DEFAULT_LOCAL_CONFIG, toConfigView, type KioskBridge } from '../../../shared/bridge';
import type { KioskApi } from '../api/kiosk-api';

export type SyncApi = Pick<KioskApi, 'getSettings' | 'getTemplate'>;
export type SyncBridge = Pick<KioskBridge, 'getConfig' | 'setConfig' | 'saveOverlay'>;

export interface SyncResult {
  settings: KioskSettings;
  template: Template | null;
  settingsFetchFailed: boolean;
}

/**
 * Fetches settings and the active template, caching both in LocalConfig (overlay PNG via `saveOverlay`).
 * Falls back to the cache when a fetch fails.
 */
export async function syncSettings(api: SyncApi, bridge: SyncBridge): Promise<SyncResult> {
  // Cache I/O failures are non-fatal: an unreadable cache counts as empty, a failed write is only logged.
  const config = await bridge.getConfig().catch((err: unknown) => {
    console.error('Reading cached settings failed', err);
    return toConfigView(DEFAULT_LOCAL_CONFIG);
  });
  let settings: KioskSettings;
  try {
    settings = await api.getSettings();
  } catch {
    return { settings: config.cachedSettings ?? DEFAULT_SETTINGS, template: config.cachedTemplate, settingsFetchFailed: true };
  }

  let template = config.cachedTemplate;
  const patch: { cachedSettings: KioskSettings; cachedTemplate?: Template | null } = { cachedSettings: settings };
  if (settings.activeTemplateId === null) {
    template = null;
    patch.cachedTemplate = null;
  } else {
    try {
      const fetched = await api.getTemplate(settings.activeTemplateId);
      // Save the overlay first so the cache never points at a missing file.
      await bridge.saveOverlay(fetched.template.id, fetched.overlayPng);
      template = fetched.template;
      patch.cachedTemplate = template;
    } catch {
      // Keep the cached template.
    }
  }
  await bridge.setConfig(patch).catch((err: unknown) => console.error('Caching settings failed', err));
  return { settings, template, settingsFetchFailed: false };
}

export interface AttractStatus {
  canStart: boolean;
  banner: string | null;
  priceLabel: string;
}

export const OUT_OF_SERVICE_BANNER = 'Out of service. Please call staff.';

export function attractStatus(i: {
  settings: KioskSettings;
  template: Template | null;
  online: boolean;
  /** Trial build: the demo backend needs no network, so being offline never blocks a paid session. */
  trial?: boolean;
  /** The saved-sessions file is unreadable: a new session could not be queued, so none may start (free mode too). */
  queueUnavailable?: boolean;
}): AttractStatus {
  const priceLabel = i.settings.freeMode ? 'Free today!' : formatPeso(i.settings.priceCentavos);
  if (i.queueUnavailable) return { canStart: false, banner: OUT_OF_SERVICE_BANNER, priceLabel };
  if (i.template === null) return { canStart: false, banner: 'Setup needed: no active template', priceLabel };
  if (!i.online && !i.trial && !i.settings.freeMode) return { canStart: false, banner: 'Offline — payments unavailable', priceLabel };
  return { canStart: true, banner: null, priceLabel };
}
