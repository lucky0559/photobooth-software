import { DecorSvg, type DecorProps } from './DecorSvg';

// Torn zig-zag ends on a short strip of tape.
const TAPE = 'M4 4 L8 10 L4 16 L8 22 L4 28 L8 34 L4 40 H156 L152 34 L156 28 L152 22 L156 16 L152 10 L156 4 Z';

/** A strip of semi-opaque lime tape. */
export function TapeStrip(props: DecorProps) {
  return (
    <DecorSvg viewBox="0 0 160 44" {...props}>
      <path d={TAPE} fill="var(--lime)" fillOpacity="0.85" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M20 14 H140 M20 30 H140" stroke="var(--ink)" strokeOpacity="0.15" strokeWidth="3" strokeDasharray="10 8" />
    </DecorSvg>
  );
}
