import type { AttractStatus } from '../state/settings-sync';
import { ActionButton } from '../theme/components/ActionButton';
import { Backdrop } from '../theme/components/Backdrop';
import { BannerTitle } from '../theme/components/BannerTitle';
import { FlashBolt } from '../theme/decor/FlashBolt';
import { ShutterIris } from '../theme/decor/ShutterIris';
import { Sparkle } from '../theme/decor/Sparkle';
import { Sprocket } from '../theme/decor/Sprocket';

/** `status` is null until the first settings sync finishes; start stays disabled until then. */
export function Attract({ status, onStart }: { status: AttractStatus | null; onStart: () => void }) {
  return (
    <main className="stage stage--dark attract">
      <Backdrop kind="film" />
      <div className="decor-row">
        <Sparkle size="9vmin" wobble />
        <ShutterIris size="16vmin" className="decor--spin" />
      </div>
      <div className="stage__center">
        <div className="title-row">
          <FlashBolt size="9vmin" wobble />
          <BannerTitle tone="tangerine" tilt={-3}>
            Smile!
          </BannerTitle>
          <Sparkle size="7vmin" fill="var(--lime)" />
        </div>
        <ActionButton className="action--hero action--pulse" disabled={!status?.canStart} onClick={onStart}>
          Tap to start
        </ActionButton>
        {status && <p className="price-ticket">{status.priceLabel}</p>}
        {status?.banner && (
          <p className="status-banner" role="status">
            {status.banner}
          </p>
        )}
      </div>
      <div className="decor-row">
        <Sprocket size="15vmin" className="decor--spin" />
        <FlashBolt size="8vmin" fill="var(--tangerine)" wobble />
      </div>
    </main>
  );
}
