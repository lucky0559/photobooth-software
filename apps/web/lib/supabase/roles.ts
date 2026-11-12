import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * The signed-in user if their `profiles.role` is 'admin', else null.
 * `getUser()` validates the session with the Auth server, and the role comes from the database
 * (RLS: a user may read only their own profile), never from a client-supplied claim.
 */
export async function getAdminUser(supabase: SupabaseClient): Promise<User | null> {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) return null;
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle();
  return profile?.role === 'admin' ? auth.user : null;
}
