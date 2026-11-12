import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAdminUser } from '@/lib/supabase/roles';
import { safeAdminPath } from '@/lib/safe-next';
import { signIn } from './actions';

const MESSAGES: Record<string, string> = {
  invalid: 'Invalid email or password',
  not_admin: 'This account is not an admin',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeAdminPath(params.next);

  if (await getAdminUser(await createClient())) redirect(next);

  const code = typeof params.error === 'string' ? params.error : '';
  const message = Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : null;

  return (
    <main className="page narrow">
      <h1>Photobooth admin</h1>
      <div className="card">
        <h2>Sign in</h2>
        {message && (
          <p id="login-error" className="alert" role="alert">
            {message}
          </p>
        )}
        <form action={signIn} className="form">
          <input type="hidden" name="next" value={next} />
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              aria-describedby={message ? 'login-error' : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={72}
              aria-describedby={message ? 'login-error' : undefined}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
