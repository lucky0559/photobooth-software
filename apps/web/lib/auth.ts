import 'server-only';
import { redirect } from 'next/navigation';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from './supabase/server';
import { getAdminUser } from './supabase/roles';

/**
 * For pages and server actions: the admin's own Supabase client, or a redirect to the login page.
 * Middleware also guards /admin, but every action re-checks here (actions are plain POST endpoints).
 */
export async function requireAdmin(): Promise<{ supabase: SupabaseClient; user: User }> {
  const supabase = await createClient();
  const user = await getAdminUser(supabase);
  if (!user) redirect('/admin/login');
  return { supabase, user };
}
