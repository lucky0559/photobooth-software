import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from './env';

/** Browser client (publishable key + cookie session). Not used by the Task 12 pages, which work through server actions. */
export function createClient(): SupabaseClient {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
