import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { signOut } from '../login/actions';
import { NavLinks } from './nav-links';

export default async function PanelLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/admin" className="brand">
            Photobooth admin
          </Link>
          <nav aria-label="Admin">
            <NavLinks />
          </nav>
          <form action={signOut}>
            <button type="submit" className="btn">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
