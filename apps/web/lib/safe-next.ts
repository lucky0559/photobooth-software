/**
 * Post-login redirect target from an untrusted `next` value: only internal /admin paths, else '/admin'.
 * Rejects protocol-relative (`//host`), backslash and control-character tricks, and the login page itself.
 */
export function safeAdminPath(next: unknown): string {
  if (typeof next !== 'string' || next.length > 200) return '/admin';
  if (!/^\/admin(\/[A-Za-z0-9\-_/]*)?$/.test(next)) return '/admin';
  if (next.includes('//')) return '/admin';
  if (next === '/admin/login' || next.startsWith('/admin/login/')) return '/admin';
  return next;
}
