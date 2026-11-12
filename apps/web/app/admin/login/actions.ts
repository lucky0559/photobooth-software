'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAdminUser } from '@/lib/supabase/roles';
import { safeAdminPath } from '@/lib/safe-next';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sign in with email + password; only admins stay signed in. Errors never reveal whether the account exists. */
export async function signIn(formData: FormData): Promise<void> {
  const email = formData.get('email');
  const password = formData.get('password');
  const next = safeAdminPath(formData.get('next'));

  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    email.length > 254 ||
    !EMAIL_RE.test(email.trim()) ||
    password.length < 1 ||
    password.length > 72
  ) {
    redirect('/admin/login?error=invalid');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) redirect('/admin/login?error=invalid');

  if (!(await getAdminUser(supabase))) {
    // 'local' ends only the session just created here. The default ('global') would revoke every refresh
    // token of that user, so typing the kiosk's credentials here would knock the booth offline.
    await supabase.auth.signOut({ scope: 'local' });
    redirect('/admin/login?error=not_admin');
  }

  redirect(next);
}

/** Sign out this browser only ('local'): an admin signed in on another device stays signed in. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/admin/login');
}
