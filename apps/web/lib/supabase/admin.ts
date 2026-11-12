import 'server-only';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl } from './env';

/**
 * Service-role client: bypasses RLS. Use ONLY where the signed-in admin's own session cannot do the job.
 * The Task 12 pages do not need it (RLS already lets admins read and write what they edit).
 */
export function createAdminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createSupabaseClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}
