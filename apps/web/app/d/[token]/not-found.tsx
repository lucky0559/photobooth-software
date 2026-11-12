import type { Metadata } from 'next';

// A guest page: never the admin title from the root layout.
export const metadata: Metadata = {
  title: 'Photo not found',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

// Same page for a malformed and an unknown token (status 404): it never says which check failed.
export default function DownloadNotFound() {
  return (
    <main className="dl">
      <div className="dl-inner">
        <h1 className="dl-title">Photo not found</h1>
        <p className="dl-message">Check that you scanned the QR code printed with your photo.</p>
      </div>
    </main>
  );
}
