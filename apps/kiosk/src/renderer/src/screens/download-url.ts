/** Download page for a session: `<base>/d/<token>`, or null unless `base` is an absolute http(s) URL. */
export function downloadUrl(base: string | undefined, token: string): string | null {
  const trimmed = base?.trim() ?? '';
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) return null;
  return `${trimmed.replace(/\/+$/, '')}/d/${token}`;
}

export const TRIAL_QR_TEXT = 'Trial build: the real kiosk shows your photo download link here.';

/** QR payload for the delivery screen: the fixed trial text in a trial build, else the download URL (null if unavailable). */
export function deliveryQrPayload(trial: boolean, base: string | undefined, token: string): string | null {
  return trial ? TRIAL_QR_TEXT : downloadUrl(base, token);
}
