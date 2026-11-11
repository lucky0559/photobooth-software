import { useEffect, useRef, useState } from 'react';
import type { KioskApi } from './api/kiosk-api';
import { Attract } from './screens/Attract';
import { PinPrompt } from './screens/PinPrompt';
import { Setup, type SetupAuth } from './screens/Setup';
import { registerTap } from './setup/secret-tap';

type Screen = 'loading' | 'setup' | 'pin' | 'attract';

export function App({ auth }: { api: KioskApi; auth: SetupAuth | null }) {
  const [screen, setScreen] = useState<Screen>('loading');
  const [cameraId, setCameraId] = useState<string | null>(null);
  const taps = useRef<number[]>([]);

  const reload = (): void => {
    void window.kiosk.getConfig().then((cfg) => {
      setCameraId(cfg.cameraDeviceId);
      setScreen(cfg.pinHash === null ? 'setup' : 'attract');
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
      {screen === 'pin' && <PinPrompt onUnlock={() => setScreen('setup')} onCancel={() => setScreen('attract')} />}
      {screen === 'attract' && <Attract />}
      {screen === 'attract' && <div className="secret-corner" aria-hidden onPointerDown={onSecretTap} />}
    </>
  );
}
