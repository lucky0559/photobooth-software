import type { ConfigView } from '../../../shared/bridge';

export const DAMAGED_SETTINGS_NOTICE = 'Settings file was damaged and reset. Check the printer and camera.';
export const UPLOADS_DROPPED_NOTICE =
  'Some saved photo uploads could not be restored. A copy of the damaged file was kept in the kiosk data folder.';
export const SETTINGS_UNREADABLE_NOTICE = 'Settings file could not be read. Changes will not be saved; restart the kiosk.';
export const QUEUE_UNAVAILABLE_NOTICE =
  'Saved sessions file could not be read. The kiosk is out of service until it is fixed or the kiosk is restarted.';

export type NoticeFlags = Pick<ConfigView, 'recoveredFromCorruption' | 'uploadsDropped' | 'settingsUnreadable' | 'queueUnavailable'>;

/** Staff notices shown at the top of Setup, from the main process's load-time flags and live store health. */
export function setupNotices(cfg: NoticeFlags): string[] {
  const notices: string[] = [];
  if (cfg.queueUnavailable) notices.push(QUEUE_UNAVAILABLE_NOTICE);
  if (cfg.settingsUnreadable) notices.push(SETTINGS_UNREADABLE_NOTICE);
  if (cfg.recoveredFromCorruption) notices.push(DAMAGED_SETTINGS_NOTICE);
  if (cfg.uploadsDropped) notices.push(UPLOADS_DROPPED_NOTICE);
  return notices;
}
