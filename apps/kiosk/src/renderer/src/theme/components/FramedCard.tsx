import type { HTMLAttributes } from 'react';
import { TapeStrip } from '../decor/TapeStrip';

/**
 * Paper card with the ink outline and slab shadow. `polaroid` gives it the deep bottom margin, a slight tilt
 * and a strip of tape across the top edge (for the review preview and the payment/delivery QR).
 */
export function FramedCard({
  polaroid = false,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { polaroid?: boolean }) {
  return (
    <div className={['framed-card', polaroid && 'framed-card--polaroid', className].filter(Boolean).join(' ')} {...rest}>
      {polaroid && <TapeStrip className="framed-card__tape" size="min(26vmin, 40%)" />}
      {children}
    </div>
  );
}
