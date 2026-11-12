import 'server-only';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl } from './env';

/**
 * Service-role client: bypasses RLS. Use ONLY where the signed-in admin's own session cannot do the job.
 * Only the public download page uses it (lib/download.ts); admin pages work through the admin's own session.
 */
export function createAdminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createSupabaseClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}
