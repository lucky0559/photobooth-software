/**
 * Records a tap on the hidden admin corner. Keeps only taps inside the window;
 * triggers (and clears the history) when `count` taps fall within `windowMs`.
 */
export function registerTap(
  taps: number[],
  now: number,
  count = 5,
  windowMs = 3000,
): { taps: number[]; triggered: boolean } {
  const recent = [...taps, now].filter((t) => now - t < windowMs);
  if (recent.length >= count) return { taps: [], triggered: true };
  return { taps: recent, triggered: false };
}
