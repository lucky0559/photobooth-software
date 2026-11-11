import { DecorSvg, type DecorProps } from './DecorSvg';

const BOLT = 'M34 2 L6 54 H28 L18 98 L58 38 H36 L50 2 Z';

/** Flash lightning bolt on a slab shadow. */
export function FlashBolt({ fill = 'var(--lime)', ...props }: DecorProps & { fill?: string }) {
  return (
    <DecorSvg viewBox="0 0 68 106" {...props}>
      <path d={BOLT} transform="translate(5 5)" fill="var(--ink)" />
      <path d={BOLT} fill={fill} stroke="var(--ink)" strokeWidth="4" strokeLinejoin="round" />
    </DecorSvg>
  );
}
