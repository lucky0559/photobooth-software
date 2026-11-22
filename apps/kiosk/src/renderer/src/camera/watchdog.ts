/** How long a camera may go without delivering frames (or stay muted) before Capture reports it lost. */
export const FRAME_TIMEOUT_MS = 8000;

/**
 * Calls `onFail` once if the video still has no frame after `timeoutMs`. Catches capture cards with no
 * signal and busy webcams that open fine but never produce frames. Returns a stop function.
 */
export function watchFirstFrame(
  video: { readyState: number; videoWidth: number },
  onFail: () => void,
  timeoutMs = FRAME_TIMEOUT_MS,
): () => void {
  const id = setTimeout(() => {
    if (video.readyState < 2 || !video.videoWidth) onFail();
  }, timeoutMs);
  return () => clearTimeout(id);
}

/** Calls `onFail` once if the track stays muted (no frames) for `timeoutMs`. Returns a stop function. */
export function watchMute(
  track: EventTarget & { muted: boolean },
  onFail: () => void,
  timeoutMs = FRAME_TIMEOUT_MS,
): () => void {
  let id: ReturnType<typeof setTimeout> | undefined;
  const disarm = (): void => {
    clearTimeout(id);
    id = undefined;
  };
  const arm = (): void => {
    if (id === undefined) id = setTimeout(onFail, timeoutMs);
  };
  track.addEventListener('mute', arm);
  track.addEventListener('unmute', disarm);
  if (track.muted) arm();
  return () => {
    disarm();
    track.removeEventListener('mute', arm);
    track.removeEventListener('unmute', disarm);
  };
}
