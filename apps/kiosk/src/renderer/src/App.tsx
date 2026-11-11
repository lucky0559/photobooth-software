import type { KioskState, Template } from '@pb/core';
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
      return <Placeholder title="Payment" />;
    case 'review':
      return template ? <Review state={state} template={template} dispatch={dispatch} /> : <Placeholder title="Pick a look" />;
    case 'output':
      return <OutputPlaceholder state={state} template={template} />;
    case 'delivery':
      return <Placeholder title="Scan to download your photo" />;
  }
}

function Placeholder({ title }: { title: string }) {
  return (
    <main className="screen">
      <h1>{title}</h1>
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
  return <Placeholder title="Printing your photo…" />;
}
