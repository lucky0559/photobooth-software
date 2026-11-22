import type { CSSProperties, ReactNode } from 'react';

export type BannerTone = 'tangerine' | 'lime' | 'aqua' | 'ink';

/** Tilted, squared-off banner heading with outline and slab shadow. Renders an `h1` unless `as` says otherwise. */
export function BannerTitle({
  tone = 'tangerine',
  tilt = -2,
  as: Tag = 'h1',
  className,
  children,
}: {
  tone?: BannerTone;
  /** Degrees, −3 to +3 per DESIGN.md. */
  tilt?: number;
  as?: 'h1' | 'h2' | 'p';
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={['banner-title', `banner-title--${tone}`, className].filter(Boolean).join(' ')}
      style={{ '--tilt': `${tilt}deg` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
