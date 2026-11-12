'use client';

// Fixed, calm message for any unexpected error under /admin; the error itself is never shown.
export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page narrow">
      <div className="card" role="alert">
        <h2>Something went wrong</h2>
        <p>The page could not finish loading or saving. Your last change may not have been saved.</p>
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </main>
  );
}
