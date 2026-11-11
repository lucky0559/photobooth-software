import { DELIVERY_TIMEOUT_MS, PAYMENT_TIMEOUT_MS, type KioskState, type Template } from '@pb/core';
import { useEffect, useRef, useState } from 'react';
import type { KioskApi } from './api/kiosk-api';
import { buildSessionSheet } from './compose/session-sheet';
import { recordSheet } from './debug/last-sheet';
import { Attract } from './screens/Attract';
import { Capture } from './screens/Capture';
import { PinPrompt } from './screens/PinPrompt';
import { Review } from './screens/Review';
import { Setup, type SetupAuth } from './screens/Setup';
import { registerTap } from './setup/secret-tap';
import { attractStatus } from './state/settings-sync';
import { useKiosk } from './state/useKiosk';
import { Backdrop } from './theme/components/Backdrop';
import { BannerTitle } from './theme/components/BannerTitle';
import { FramedCard } from './theme/components/FramedCard';
import { TimerPill } from './theme/components/TimerPill';
import { FlashBolt } from './theme/decor/FlashBolt';
import { ShutterIris } from './theme/decor/ShutterIris';
import { Sparkle } from './theme/decor/Sparkle';
import { Sprocket } from './theme/decor/Sprocket';
import { useRemainingMs } from './theme/time';

type Screen = 'loading' | 'setup' | 'pin' | 'kiosk';

export function App({ api, auth }: { api: KioskApi; auth: SetupAuth | null }) {
  const [screen, setScreen] = useState<Screen>('loading');
  const [cameraId, setCameraId] = useState<string | null>(null);
  const taps = useRef<number[]>([]);

  const reload = (): void => {
    void window.kiosk.getConfig().then((cfg) => {
      setCameraId(cfg.cameraDeviceId);
      setScreen(cfg.pinHash === null ? 'setup' : 'kiosk');
    });
  };
  useEffect(reload, []);

  const onSecretTap = (): void => {
    const r = registerTap(taps.current, performance.now());
    taps.current = r.taps;
    if (r.triggered) setScreen('pin');
  };

  return (
    <>
      {screen === 'setup' && <Setup auth={auth} initialCameraId={cameraId} onDone={reload} />}
      {screen === 'pin' && <PinPrompt onUnlock={() => setScreen('setup')} onCancel={() => setScreen('kiosk')} />}
      {screen === 'kiosk' && <KioskFlow api={api} cameraId={cameraId} onSecretTap={onSecretTap} />}
    </>
  );
}

/** Guest flow driven by the session state machine. */
function KioskFlow({ api, cameraId, onSecretTap }: { api: KioskApi; cameraId: string | null; onSecretTap: () => void }) {
  const { state, settings, dispatch, template, online, ready } = useKiosk(api);

  switch (state.name) {
    case 'attract':
      return (
        <>
          <Attract
            status={ready ? attractStatus({ settings, template, online }) : null}
            onStart={() => dispatch({ type: 'START' })}
          />
          <div className="secret-corner" aria-hidden onPointerDown={onSecretTap} />
        </>
      );
    case 'capture':
      return <Capture state={state} settings={settings} cameraId={cameraId} dispatch={dispatch} />;
    // Placeholders: Payment, Output and Delivery screens arrive in later tasks.
    case 'payment':
      return <QrPlaceholder title="Payment" deadline={state.startedAt + PAYMENT_TIMEOUT_MS} />;
    case 'review':
      return template ? (
        <Review state={state} template={template} dispatch={dispatch} />
      ) : (
        <main className="stage">
          <Backdrop kind="paper" />
          <BannerTitle tone="tangerine">Pick a look</BannerTitle>
        </main>
      );
    case 'output':
      return <OutputPlaceholder state={state} template={template} />;
    case 'delivery':
      return <QrPlaceholder title="Scan to download your photo" deadline={state.enteredAt + DELIVERY_TIMEOUT_MS} />;
  }
}

/**
 * Themed shell for the payment and delivery screens: striped backdrop, timer pill, title and a taped polaroid
 * card with an empty QR slot. Tasks 10–11 put the real QR and copy into `.qr-slot`.
 */
function QrPlaceholder({ title, deadline }: { title: string; deadline: number }) {
  const remainingMs = useRemainingMs(deadline);
  return (
    <main className="stage qr-screen">
      <Backdrop kind="stripes" />
      <div className="topbar">
        <TimerPill remainingMs={remainingMs} />
        <Sparkle size="9vmin" fill="var(--lime)" wobble />
      </div>
      <BannerTitle tone="ink" tilt={-2}>
        {title}
      </BannerTitle>
      <FramedCard polaroid className="qr-card">
        <div className="qr-slot" />
      </FramedCard>
      <div className="decor-row">
        <Sprocket size="11vmin" className="decor--spin" />
        <FlashBolt size="8vmin" fill="var(--tangerine)" wobble />
      </div>
    </main>
  );
}

/** Composes the print sheet once on entry. Printing and upload replace this in Tasks 9–10. */
function OutputPlaceholder({ state, template }: { state: Extract<KioskState, { name: 'output' }>; template: Template | null }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !template) return;
    started.current = true;
    buildSessionSheet({ template, shotIds: state.shots, filter: state.filter }).then(
      (sheet) => {
        if (import.meta.env.VITE_FAKE_API === '1') recordSheet(sheet);
      },
      (err: unknown) => console.error('Composing print sheet failed', err),
    );
  }, [state, template]);
  return (
    <main className="stage stage--dark output">
      <Backdrop kind="darkroom" />
      <div className="stage__center">
        <ShutterIris size="34vmin" className="decor--spin" />
        <BannerTitle tone="lime" tilt={2}>
          Printing your photo…
        </BannerTitle>
      </div>
    </main>
  );
}
