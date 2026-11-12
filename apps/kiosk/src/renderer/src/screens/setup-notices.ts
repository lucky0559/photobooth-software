import type { ConfigView } from '../../../shared/bridge';

export const DAMAGED_SETTINGS_NOTICE = 'Settings file was damaged and reset. Check the printer and camera.';
export const UPLOADS_DROPPED_NOTICE =
  'Some saved photo uploads could not be restored. A copy of the damaged file was kept in the kiosk data folder.';
export const SETTINGS_UNREADABLE_NOTICE = 'Settings file could not be read. Changes will not be saved; restart the kiosk.';
export const QUEUE_UNAVAILABLE_NOTICE =
  'Saved sessions file could not be read. The kiosk is out of service until it is fixed or the kiosk is restarted.';

export type NoticeFlags = Pick<
  ConfigView,
  'recoveredFromCorruption' | 'uploadsDropped' | 'settingsUnreadable' | 'queueUnavailable' | 'syncFailures'
>;

const MAX_ERROR_CHARS = 120;

const noticeTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * `N saved uploads are failing since <time>: <last error>` for sync jobs that keep failing (R22), or null. The error
 * is shown as plain one-line text, cut to 120 characters.
 */
export function syncFailureNotice(s: ConfigView['syncFailures']): string | null {
  if (s.failingCount <= 0) return null;
  const what = s.failingCount === 1 ? '1 saved upload is failing' : `${s.failingCount} saved uploads are failing`;
  const since = s.oldestFailingSince === null ? '' : ` since ${noticeTime.format(new Date(s.oldestFailingSince)).replace(/\s/g, ' ')}`;
  let error = s.lastError?.replace(/\s+/g, ' ').trim() ?? '';
  if (error.length > MAX_ERROR_CHARS) error = `${error.slice(0, MAX_ERROR_CHARS - 1)}…`;
  return `${what}${since}${error ? `: ${error}` : ''}`;
}

/** Staff notices shown at the top of Setup, from the main process's load-time flags and live store health. */
export function setupNotices(cfg: NoticeFlags): string[] {
  const notices: string[] = [];
  if (cfg.queueUnavailable) notices.push(QUEUE_UNAVAILABLE_NOTICE);
  const failing = syncFailureNotice(cfg.syncFailures);
  if (failing) notices.push(failing);
  if (cfg.settingsUnreadable) notices.push(SETTINGS_UNREADABLE_NOTICE);
  if (cfg.recoveredFromCorruption) notices.push(DAMAGED_SETTINGS_NOTICE);
  if (cfg.uploadsDropped) notices.push(UPLOADS_DROPPED_NOTICE);
  return notices;
}
