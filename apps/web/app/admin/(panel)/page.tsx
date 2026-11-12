import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';

// Placeholder: Task 13 replaces this with the sales dashboard. Sign out lives in the shared top bar.
export default async function AdminHome() {
  await requireAdmin(); // each page checks itself; layouts are not a security boundary
  return (
    <>
      <h1>Dashboard</h1>
      <ul className="dash-links">
        <li>
          <Link href="/admin/settings" className="btn">
            Settings
          </Link>
        </li>
        <li>
          <Link href="/admin/templates" className="btn">
            Templates
          </Link>
        </li>
      </ul>
    </>
  );
}
