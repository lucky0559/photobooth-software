import type { AttractStatus } from '../state/settings-sync';

/** `status` is null until the first settings sync finishes; start stays disabled until then. */
export function Attract({ status, onStart }: { status: AttractStatus | null; onStart: () => void }) {
  return (
    <main className="screen attract">
      <button type="button" className="start" disabled={!status?.canStart} onClick={onStart}>
        Tap to start
      </button>
      {status && <p className="price">{status.priceLabel}</p>}
      {status?.banner && (
        <p className="banner" role="status">
          {status.banner}
        </p>
      )}
    </main>
  );
}
