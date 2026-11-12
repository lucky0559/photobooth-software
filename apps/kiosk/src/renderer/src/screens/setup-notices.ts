import type { ConfigView } from '../../../shared/bridge';

export const DAMAGED_SETTINGS_NOTICE = 'Settings file was damaged and reset. Check the printer and camera.';
export const UPLOADS_DROPPED_NOTICE = 'Some saved photo uploads could not be restored. Check the photos folder backup.';
export const SETTINGS_UNREADABLE_NOTICE = 'Settings file could not be read. Changes will not be saved; restart the kiosk.';

/** Staff notices shown at the top of Setup, from the main process's load-time flags. */
export function setupNotices(cfg: Pick<ConfigView, 'recoveredFromCorruption' | 'uploadsDropped' | 'settingsUnreadable'>): string[] {
  const notices: string[] = [];
  if (cfg.settingsUnreadable) notices.push(SETTINGS_UNREADABLE_NOTICE);
  if (cfg.recoveredFromCorruption) notices.push(DAMAGED_SETTINGS_NOTICE);
  if (cfg.uploadsDropped) notices.push(UPLOADS_DROPPED_NOTICE);
  return notices;
}
