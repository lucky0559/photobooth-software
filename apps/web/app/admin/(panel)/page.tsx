import Link from 'next/link';

// Placeholder: Task 13 replaces this with the sales dashboard. Sign out lives in the shared top bar.
export default function AdminHome() {
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
