import { DecorSvg, type DecorProps } from './DecorSvg';

const TEETH = Array.from({ length: 10 }, (_, i) => i * 36);

/** Film-advance sprocket wheel: square teeth, a hub and three cut-outs. */
export function Sprocket({ fill = 'var(--aqua)', ...props }: DecorProps & { fill?: string }) {
  return (
    <DecorSvg viewBox="-56 -56 116 116" {...props}>
      <g transform="translate(5 5)" fill="var(--ink)">
        {TEETH.map((deg) => (
          <rect key={deg} x="-7" y="-50" width="14" height="16" transform={`rotate(${deg})`} />
        ))}
        <circle r="38" />
      </g>
      <g fill={fill} stroke="var(--ink)" strokeWidth="3.5" strokeLinejoin="round">
        {TEETH.map((deg) => (
          <rect key={deg} x="-7" y="-50" width="14" height="16" transform={`rotate(${deg})`} />
        ))}
        <circle r="38" />
      </g>
      {[0, 120, 240].map((deg) => (
        <circle key={deg} cx="0" cy="-21" r="8" transform={`rotate(${deg})`} fill="var(--ink)" />
      ))}
      <circle r="9" fill="var(--paper)" stroke="var(--ink)" strokeWidth="3.5" />
    </DecorSvg>
  );
}
