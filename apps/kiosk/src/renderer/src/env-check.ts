import { downloadUrl } from './screens/download-url';

export interface KioskEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_WEB_BASE_URL?: string;
  VITE_FAKE_API?: string;
}

/**
 * Build-time configuration check. `missing` (variable NAMES only) blocks the app; `warnings` do not:
 * without a usable `VITE_WEB_BASE_URL` only the download QR is unavailable.
 */
export type EnvCheck = { ok: true; warnings: string[] } | { ok: false; missing: string[]; warnings: string[] };

const isHttpUrl = (v: string | undefined): boolean => /^https?:\/\/[^/\s]+/i.test(v?.trim() ?? '');

export function checkEnv(env: KioskEnv): EnvCheck {
  const warnings = downloadUrl(env.VITE_WEB_BASE_URL, 'x') === null ? ['VITE_WEB_BASE_URL'] : [];
  if (env.VITE_FAKE_API === '1') return { ok: true, warnings };
  const missing: string[] = [];
  if (!isHttpUrl(env.VITE_SUPABASE_URL)) missing.push('VITE_SUPABASE_URL');
  if (!env.VITE_SUPABASE_ANON_KEY?.trim()) missing.push('VITE_SUPABASE_ANON_KEY');
  return missing.length > 0 ? { ok: false, missing, warnings } : { ok: true, warnings };
}
