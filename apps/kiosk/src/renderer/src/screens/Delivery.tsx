import { DELIVERY_TIMEOUT_MS, type KioskState } from '@pb/core';
import { toDataURL } from 'qrcode';
import { useEffect, useState } from 'react';
import type { KioskInput } from '../state/useKiosk';
import { ActionButton } from '../theme/components/ActionButton';
import { Backdrop } from '../theme/components/Backdrop';
import { BannerTitle } from '../theme/components/BannerTitle';
import { FramedCard } from '../theme/components/FramedCard';
import { TimerPill } from '../theme/components/TimerPill';
import { FlashBolt } from '../theme/decor/FlashBolt';
import { Sparkle } from '../theme/decor/Sparkle';
import { Sprocket } from '../theme/decor/Sprocket';
import { useRemainingMs } from '../theme/time';
import { deliveryQrPayload } from './download-url';

let warnedBaseUrl = false;

/** QR to the download page (shown right away, even offline: the upload catches up later). */
export function Delivery({
  state,
  downloadToken,
  dispatch,
}: {
  state: Extract<KioskState, { name: 'delivery' }>;
  downloadToken: string | null;
  dispatch: (e: KioskInput) => void;
}) {
  const remainingMs = useRemainingMs(state.enteredAt + DELIVERY_TIMEOUT_MS);
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    if (!downloadToken) return;
    const url = deliveryQrPayload(import.meta.env.VITE_TRIAL === '1', import.meta.env.VITE_WEB_BASE_URL, downloadToken);
    if (url === null) {
      if (!warnedBaseUrl) console.error('VITE_WEB_BASE_URL must be an absolute http(s) URL; the download QR is disabled');
      warnedBaseUrl = true;
      setQrFailed(true);
      return;
    }
    let live = true;
    toDataURL(url, { width: 480, margin: 1 }).then(
      (dataUrl) => live && setQr(dataUrl),
      (err: unknown) => {
        console.error('QR generation failed', err);
        if (live) setQrFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [downloadToken]);

  return (
    <main className="stage qr-screen delivery">
      <Backdrop kind="stripes" />
      <div className="topbar">
        <TimerPill remainingMs={remainingMs} />
        <Sparkle size="9vmin" fill="var(--lime)" wobble />
      </div>
      <BannerTitle tone="ink" tilt={-2}>
        Scan to download your photo
      </BannerTitle>
      <div className="delivery__body">
        <FramedCard polaroid className="qr-card">
          {qr ? (
            <img className="qr-img" src={qr} alt="QR code to download your photo" />
          ) : (
            <div className="qr-slot">
              {qrFailed && <p className="qr-slot__error">QR unavailable — please call staff</p>}
            </div>
          )}
        </FramedCard>
        <div className="delivery__side">
          {state.printHeld && (
            <p className="delivery__print-held" role="status">
              Your print comes out when the next guest finishes, or in about 10 minutes. Ask the owner for your print.
            </p>
          )}
          {state.printError !== null && (
            <p className="delivery__print-error" role="alert">
              Printing failed. Please call staff — your photo is still available through the QR code.
            </p>
          )}
          <ActionButton onClick={() => dispatch({ type: 'DONE' })}>Done</ActionButton>
        </div>
      </div>
      <div className="decor-row">
        <Sprocket size="11vmin" className="decor--spin" />
        <FlashBolt size="8vmin" fill="var(--tangerine)" wobble />
      </div>
    </main>
  );
}
