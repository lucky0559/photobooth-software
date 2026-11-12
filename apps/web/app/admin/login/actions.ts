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
    await supabase.auth.signOut();
    redirect('/admin/login?error=not_admin');
  }

  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/admin/login');
}
