// Sales and download-link rules shared by the web dashboard and the public download page.
// All "today" grouping uses Asia/Manila: UTC+8, no DST.

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ATTENTION_AFTER_MS = 10 * 60 * 1000;

/** The Asia/Manila calendar day of an ISO timestamp, as 'YYYY-MM-DD'. */
export function manilaDayKey(iso: string): string {
  return new Date(Date.parse(iso) + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Count and total of the payments whose `paidAt` falls on the given Manila day. */
export function summarizeDay(
  payments: { amountCentavos: number; paidAt: string }[],
  dayKey: string,
): { count: number; totalCentavos: number } {
  let count = 0;
  let totalCentavos = 0;
  for (const p of payments) {
    if (manilaDayKey(p.paidAt) !== dayKey) continue;
    count += 1;
    totalCentavos += p.amountCentavos;
  }
  return { count, totalCentavos };
}

export type DownloadLinkState = 'not_found' | 'expired' | 'uploading' | 'ready';

/**
 * What the public download page shows. Expiry is checked first: a link is expired from exactly
 * `createdAt + linkExpiryDays` days on, whether or not the photo ever arrived.
 */
export function downloadLinkState(
  session: { createdAt: string; photoPath: string | null } | null,
  linkExpiryDays: number,
  now: Date,
): DownloadLinkState {
  if (!session) return 'not_found';
  const created = Date.parse(session.createdAt);
  // NaN never compares below, so a bad timestamp fails closed (expired).
  if (!(now.getTime() < created + linkExpiryDays * DAY_MS)) return 'expired';
  return session.photoPath === null ? 'uploading' : 'ready';
}

/**
 * Refund signal for the operator: paid after the kiosk cancelled, or paid more than 10 minutes ago
 * without ever reaching `completed`.
 */
export function needsAttention(s: { status: string; createdAt: string }, now: Date): boolean {
  if (s.status === 'paid_after_cancel') return true;
  return s.status === 'paid' && now.getTime() - Date.parse(s.createdAt) > ATTENTION_AFTER_MS;
}
