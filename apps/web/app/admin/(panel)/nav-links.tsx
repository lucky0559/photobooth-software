'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/templates', label: 'Templates' },
] as const;

export function NavLinks() {
  const path = usePathname();
  return (
    <ul className="nav">
      {LINKS.map((l) => (
        <li key={l.href}>
          <Link href={l.href} aria-current={path === l.href ? 'page' : undefined}>
            {l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
