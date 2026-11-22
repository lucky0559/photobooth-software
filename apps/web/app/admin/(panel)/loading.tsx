import { Spinner } from '@/components/spinner';

/** Shown while the next admin page loads its data (navigating between Dashboard, Settings and Templates). */
export default function PanelLoading() {
  return (
    <div className="page-loading" role="status">
      <Spinner />
      Loading…
    </div>
  );
}
