import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadDownload } from '@/lib/download';

// Public guest page (QR code on the kiosk). Every request is looked up fresh: never prerendered or cached.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your photobooth photo',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function DownloadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await loadDownload(token);
  if (view.state === 'not_found') notFound();

  return (
    <main className="dl">
      <div className="dl-inner">
        <h1 className="dl-title">Your photo</h1>
        {view.state === 'ready' ? (
          <>
            {/* Signed, short-lived URL from Supabase Storage; next/image would proxy and cache it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="dl-photo" src={view.imageUrl} alt="Your photobooth photo" referrerPolicy="no-referrer" />
            <a className="dl-button" href={view.downloadUrl} rel="noreferrer" download>
              Download photo
            </a>
            <p className="dl-hint">Thanks for visiting the booth!</p>
          </>
        ) : view.state === 'uploading' ? (
          <p className="dl-message" role="status">
            Your photo is still uploading. Please refresh in a minute.
          </p>
        ) : (
          <p className="dl-message">This link has expired.</p>
        )}
      </div>
    </main>
  );
}
