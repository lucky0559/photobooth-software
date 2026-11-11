import { DecorSvg, type DecorProps } from './DecorSvg';

const STEP = 10;

/** Dots on a grid whose size falls off with distance from the top-left corner (print-style halftone). */
function dots(cols: number, rows: number): { x: number; y: number; r: number }[] {
  const max = Math.hypot(cols, rows);
  const out: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const r = 4.6 * (1 - Math.hypot(i, j) / max);
      // Offset every other row, like a real halftone screen.
      if (r > 0.6) out.push({ x: i * STEP + (j % 2) * (STEP / 2) + 5, y: j * STEP + 5, r: Number(r.toFixed(2)) });
    }
  }
  return out;
}

/** A halftone dot field fading out from its top-left corner; flip it with CSS to fade from another corner. */
export function HalftoneField({
  fill = 'var(--lime)',
  cols = 16,
  rows = 16,
  ...props
}: DecorProps & { fill?: string; cols?: number; rows?: number }) {
  return (
    <DecorSvg viewBox={`0 0 ${cols * STEP} ${rows * STEP}`} {...props}>
      <g fill={fill}>
        {dots(cols, rows).map((d) => (
          <circle key={`${d.x},${d.y}`} cx={d.x} cy={d.y} r={d.r} />
        ))}
      </g>
    </DecorSvg>
  );
}
