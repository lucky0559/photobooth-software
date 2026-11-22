import { DecorSvg, type DecorProps } from './DecorSvg';

const BLADES = 6;
const R = 46;
const OPEN = 16;

// Each blade runs from a vertex of the hexagonal opening out to the rim, so six straight edges read as an iris.
const BLADE_LINES = Array.from({ length: BLADES }, (_, i) => {
  const a = (i / BLADES) * Math.PI * 2;
  const x1 = OPEN * Math.cos(a);
  const y1 = OPEN * Math.sin(a);
  const dx = Math.cos(a + Math.PI / 2.4);
  const dy = Math.sin(a + Math.PI / 2.4);
  // Distance along (dx, dy) from the opening vertex to the inner rim (radius R − 2).
  const pd = x1 * dx + y1 * dy;
  const t = -pd + Math.sqrt(pd * pd - OPEN * OPEN + (R - 2) ** 2);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${(x1 + t * dx).toFixed(1)} ${(y1 + t * dy).toFixed(1)}`;
}).join(' ');

const OPENING = Array.from({ length: BLADES }, (_, i) => {
  const a = (i / BLADES) * Math.PI * 2;
  return `${(OPEN * Math.cos(a)).toFixed(1)},${(OPEN * Math.sin(a)).toFixed(1)}`;
}).join(' ');

/** Camera aperture: six blades around a hexagonal opening. */
export function ShutterIris({
  blade = 'var(--ink-2)',
  edge = 'var(--aqua)',
  ...props
}: DecorProps & { blade?: string; edge?: string }) {
  return (
    <DecorSvg viewBox="-50 -50 100 100" {...props}>
      <circle r={R} fill={blade} stroke={edge} strokeWidth="4" />
      <path d={BLADE_LINES} stroke={edge} strokeWidth="3" strokeLinecap="round" />
      <polygon points={OPENING} fill="var(--ink)" stroke={edge} strokeWidth="3" strokeLinejoin="round" />
    </DecorSvg>
  );
}
