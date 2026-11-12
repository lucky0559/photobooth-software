import type { ReactNode } from 'react';

// Every admin page depends on the signed-in user's cookies: never prerender or cache.
export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
