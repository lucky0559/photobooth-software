import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabaseAnonKey, supabaseUrl } from './lib/supabase/env';
import { getAdminUser } from './lib/supabase/roles';

/**
 * Refreshes the Supabase session cookie on every /admin request and lets only admins
 * (profiles.role = 'admin', read from the database) past /admin/login.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  const path = request.nextUrl.pathname;
  if (path === '/admin/login') {
    await supabase.auth.getUser(); // refresh only
    return response;
  }

  if (await getAdminUser(supabase)) return response;

  const url = request.nextUrl.clone();
  url.pathname = '/admin/login';
  url.search = path === '/admin' ? '' : `?next=${encodeURIComponent(path)}`;
  const redirect = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
