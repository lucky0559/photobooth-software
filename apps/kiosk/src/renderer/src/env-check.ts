import { downloadUrl } from './screens/download-url';

export interface KioskEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_WEB_BASE_URL?: string;
  VITE_FAKE_API?: string;
  VITE_TRIAL?: string;
}

/**
 * Build-time configuration check. `missing` (variable NAMES only) blocks the app. In a production build a missing or
 * relative `VITE_WEB_BASE_URL` blocks too (a paid guest would get no download QR). Only the fake-API (e2e) build
 * treats it as a `warning` (download QR unavailable).
 */
export type EnvCheck = { ok: true; warnings: string[] } | { ok: false; missing: string[]; warnings: string[] };

const isHttpUrl = (v: string | undefined): boolean => /^https?:\/\/[^/\s]+/i.test(v?.trim() ?? '');

export function checkEnv(env: KioskEnv): EnvCheck {
  if (env.VITE_TRIAL === '1') return { ok: true, warnings: [] };
  const webBaseOk = downloadUrl(env.VITE_WEB_BASE_URL, 'x') !== null;
  if (env.VITE_FAKE_API === '1') return { ok: true, warnings: webBaseOk ? [] : ['VITE_WEB_BASE_URL'] };
  const missing: string[] = [];
  if (!isHttpUrl(env.VITE_SUPABASE_URL)) missing.push('VITE_SUPABASE_URL');
  if (!env.VITE_SUPABASE_ANON_KEY?.trim()) missing.push('VITE_SUPABASE_ANON_KEY');
  if (!webBaseOk) missing.push('VITE_WEB_BASE_URL');
  return missing.length > 0 ? { ok: false, missing, warnings: [] } : { ok: true, warnings: [] };
}
