'use client';

import './globals.css';

// Last-resort boundary (errors in the root layout). Replaces the whole document, so it renders html/body.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="page narrow">
          <div className="card" role="alert">
            <h2>Something went wrong</h2>
            <p>Please try again. If this keeps happening, reload the page.</p>
            <button type="button" className="btn btn-primary" onClick={() => reset()}>
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
