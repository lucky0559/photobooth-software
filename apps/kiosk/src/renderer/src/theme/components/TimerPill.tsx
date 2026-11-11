import { ShutterIris } from '../decor/ShutterIris';
import { formatMmSs } from '../time';

/** Ink pill with lime `m:ss` digits and a small aperture icon. Display only; pair with `useRemainingMs(deadline)`. */
export function TimerPill({ remainingMs }: { remainingMs: number }) {
  return (
    <p className="timer-pill" role="timer" aria-label="Time left">
      <ShutterIris size="0.9em" className="timer-pill__icon" />
      {formatMmSs(remainingMs)}
    </p>
  );
}
