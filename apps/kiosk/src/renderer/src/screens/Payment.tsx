import { formatPeso, PAYMENT_TIMEOUT_MS, type KioskState } from '@pb/core';
import { useEffect, useRef, useState } from 'react';
import type { KioskApi } from '../api/kiosk-api';
import { createPaymentOnce, startPaymentFlow, type CreatedPayment, type PaymentFlow } from '../payment/payment-flow';
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

type View = 'creating' | 'ready' | 'checking' | 'unavailable';

/**
 * QR Ph payment. All timing and the cancel/timeout race live in `startPaymentFlow`; this only renders it.
 * The state machine never leaves `payment` by itself, so the flow is what dispatches PAYMENT_PAID/CANCELLED.
 */
export function Payment({
  state,
  api,
  downloadToken,
  templateId,
  dispatch,
}: {
  state: Extract<KioskState, { name: 'payment' }>;
  api: KioskApi;
  downloadToken: string | null;
  templateId: string | null;
  dispatch: (e: KioskInput) => void;
}) {
  const deadline = state.startedAt + PAYMENT_TIMEOUT_MS;
  const remainingMs = useRemainingMs(deadline);
  const [payment, setPayment] = useState<CreatedPayment | null>(null);
  const [view, setView] = useState<View>('creating');
  const [cancelTapped, setCancelTapped] = useState(false);
  const flow = useRef<PaymentFlow | null>(null);
  const { sessionId, amountCentavos } = state;

  useEffect(() => {
    const created = createPaymentOnce(sessionId, () => {
      if (!downloadToken || !templateId) return Promise.reject(new Error('No download token or active template'));
      return api.createPayment({ sessionId, downloadToken, templateId });
    });
    const f = startPaymentFlow({
      api,
      payment: created,
      deadline,
      onReady: (p) => {
        if (p.amountCentavos !== amountCentavos) {
          console.warn(`Server amount ${p.amountCentavos} differs from local ${amountCentavos}; showing the server's`);
        }
        setPayment(p);
        setView('ready');
      },
      onStatus: setView,
      onPaid: () => dispatch({ type: 'PAYMENT_PAID' }),
      onCancelled: () => dispatch({ type: 'PAYMENT_CANCELLED' }),
    });
    flow.current = f;
    return () => {
      f.dispose();
      flow.current = null;
    };
    // One flow per session; the other inputs are fixed for the session's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const onCancel = (): void => {
    setCancelTapped(true);
    flow.current?.cancel();
  };

  return (
    <main className="stage qr-screen payment">
      <Backdrop kind="stripes" />
      <div className="topbar">
        <TimerPill remainingMs={remainingMs} />
        <Sparkle size="9vmin" fill="var(--lime)" wobble />
      </div>
      <BannerTitle tone="ink" tilt={-2}>
        Payment
      </BannerTitle>
      <div className="payment__body">
        <FramedCard polaroid className="qr-card">
          <div className={payment ? 'qr-slot qr-slot--filled' : 'qr-slot'}>
            {payment ? (
              <img className="qr-img" src={payment.qrImageDataUrl} alt="Payment QR code" />
            ) : (
              view === 'unavailable' && (
                <p className="qr-slot__error" role="alert">
                  Payments are unavailable right now. Please call staff.
                </p>
              )
            )}
          </div>
          {payment && <p className="payment__amount">{formatPeso(payment.amountCentavos)}</p>}
        </FramedCard>
        <div className="payment__side">
          {payment && <p className="payment__scan">Scan with GCash, Maya, or your bank app</p>}
          {view === 'checking' && (
            <p className="payment__checking" role="status">
              Checking your payment…
            </p>
          )}
          {view !== 'unavailable' && (
            <ActionButton variant="danger" disabled={cancelTapped} onClick={onCancel}>
              Cancel
            </ActionButton>
          )}
        </div>
      </div>
      <div className="decor-row">
        <Sprocket size="11vmin" className="decor--spin" />
        <FlashBolt size="8vmin" fill="var(--tangerine)" wobble />
      </div>
    </main>
  );
}
