import type { CSSProperties, ReactNode } from 'react';

export interface DecorProps {
  /** CSS width, e.g. `14vmin`. Height follows the viewBox. */
  size?: string;
  /** Gentle idle wobble; off under `prefers-reduced-motion`. */
  wobble?: boolean;
  className?: string;
}

/** Shared wrapper: decorative, hidden from assistive tech, never takes pointer events (see theme.css). */
export function DecorSvg({
  viewBox,
  size = '14vmin',
  wobble = false,
  className,
  children,
}: DecorProps & { viewBox: string; children: ReactNode }) {
  return (
    <svg
      className={['decor', wobble && 'decor--wobble', className].filter(Boolean).join(' ')}
      style={{ '--decor-size': size } as CSSProperties}
      viewBox={viewBox}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
