import { useEffect, useRef, useState } from 'react';
import type { KioskApi } from './api/kiosk-api';
import { Attract } from './screens/Attract';
import { Capture } from './screens/Capture';
import { PinPrompt } from './screens/PinPrompt';
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
    // Placeholders: Payment, Review, Output and Delivery screens arrive in later tasks.
    case 'payment':
      return <Placeholder title="Payment" />;
    case 'review':
      return <Placeholder title="Pick a look" />;
    case 'output':
      return <Placeholder title="Printing your photo…" />;
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
