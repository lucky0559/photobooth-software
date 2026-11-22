import type { ButtonHTMLAttributes } from 'react';

export type ActionVariant = 'primary' | 'secondary' | 'danger';

/**
 * Chunky rounded-rectangle button on a hard shadow slab: primary = lime, secondary = aqua, danger = tangerine
 * (all with ink text). Min 96 px tall; pressing pushes it down-right onto the slab.
 */
export function ActionButton({
  variant = 'primary',
  className,
  type = 'button',
  ...rest
}: { variant?: ActionVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={['action', `action--${variant}`, className].filter(Boolean).join(' ')} {...rest} />;
}
