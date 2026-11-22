import 'server-only';
import { downloadLinkState, manilaDayKey } from '@pb/core';
import { createAdminClient } from './supabase/admin';

/** Download tokens are 16 random bytes, base64url: exactly 22 characters (also a DB CHECK). */
export const DOWNLOAD_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SIGNED_URL_SECONDS = 3600;

export type DownloadView =
  | { state: 'not_found' | 'expired' | 'uploading' }
  | { state: 'ready'; imageUrl: string; downloadUrl: string };

/**
 * Public download lookup (guests, no login). The ONLY web code path that uses the service role, so it
 * stays minimal: one session by exact token (id, created_at, photo_path only), the expiry setting, and
 * signed URLs for that one session's photo. Failures never say which step failed.
 */
export async function loadDownload(token: string, now: Date = new Date()): Promise<DownloadView> {
  if (!DOWNLOAD_TOKEN_RE.test(token)) return { state: 'not_found' }; // before any DB call

  const db = createAdminClient();
  const [session, settings] = await Promise.all([
    db.from('sessions').select('id, created_at, photo_path').eq('download_token', token).maybeSingle(),
    db.from('settings').select('link_expiry_days').eq('id', 1).single(),
  ]);
  if (session.error || settings.error) throw new Error('Download lookup failed');

  const row = session.data as { id: string; created_at: string; photo_path: string | null } | null;
  const state = downloadLinkState(
    row && { createdAt: row.created_at, photoPath: row.photo_path },
    settings.data.link_expiry_days as number,
    now,
  );
  if (state !== 'ready') return { state };
  if (!row || !UUID_RE.test(row.id)) return { state: 'not_found' };

  // Object name from the session id, never from photo_path (that column is only the "uploaded" flag).
  const object = `${row.id}.jpg`;
  const bucket = db.storage.from('photos');
  const signed = await Promise.all([
    bucket.createSignedUrl(object, SIGNED_URL_SECONDS),
    bucket.createSignedUrl(object, SIGNED_URL_SECONDS, { download: `photobooth-${manilaDayKey(row.created_at)}.jpg` }),
  ]).catch(() => null);
  const imageUrl = signed?.[0].data?.signedUrl;
  const downloadUrl = signed?.[1].data?.signedUrl;
  // photo_path set but the object is missing, or Storage is down: the guest sees "still uploading". One fixed
  // line for the operator: no token, no ids, no error text (the error could echo the object name).
  if (!signed || signed[0].error || signed[1].error || !imageUrl || !downloadUrl) {
    console.error('download: signing failed');
    return { state: 'uploading' };
  }
  return { state: 'ready', imageUrl, downloadUrl };
}
