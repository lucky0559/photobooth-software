import { DecorSvg, type DecorProps } from './DecorSvg';

// A four-point glint with concave sides, plus a tiny companion glint.
const GLINT = 'M30 0 Q34 26 60 30 Q34 34 30 60 Q26 34 0 30 Q26 26 30 0 Z';

/** Tiny lens-glint sparkle mark. */
export function Sparkle({ fill = 'var(--aqua)', ...props }: DecorProps & { fill?: string }) {
  return (
    <DecorSvg viewBox="-4 -4 84 84" {...props}>
      <path d={GLINT} fill={fill} stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
      <path d={GLINT} transform="translate(56 52) scale(0.36)" fill={fill} stroke="var(--ink)" strokeWidth="7" />
    </DecorSvg>
  );
}
