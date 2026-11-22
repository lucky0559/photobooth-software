import { DecorSvg, type DecorProps } from './DecorSvg';

const FRAME = 100;
const HEIGHT = 90;

/** Fill of frame `i`: mostly empty dark frames, with a lime and a tangerine "exposure" every six. */
function frameFill(i: number): string {
  if (i % 6 === 1) return 'var(--lime)';
  if (i % 6 === 4) return 'var(--tangerine)';
  return 'var(--ink)';
}

/** A horizontal strip of 35 mm film: sprocket holes along both edges and `frames` picture frames. */
export function FilmStrip({ frames = 6, ...props }: DecorProps & { frames?: number }) {
  const width = frames * FRAME;
  const holes = Array.from({ length: frames * 4 }, (_, i) => i * (FRAME / 4) + 8);
  return (
    <DecorSvg viewBox={`0 0 ${width} ${HEIGHT}`} {...props}>
      <rect width={width} height={HEIGHT} fill="var(--ink-2)" />
      {holes.map((x) => (
        <g key={x} fill="var(--ink)">
          <rect x={x} y="6" width="10" height="10" rx="2" />
          <rect x={x} y={HEIGHT - 16} width="10" height="10" rx="2" />
        </g>
      ))}
      {Array.from({ length: frames }, (_, i) => (
        <rect
          key={i}
          x={i * FRAME + 8}
          y="22"
          width={FRAME - 16}
          height={HEIGHT - 44}
          rx="4"
          fill={frameFill(i)}
          stroke="var(--aqua)"
          strokeWidth="2"
        />
      ))}
    </DecorSvg>
  );
}
