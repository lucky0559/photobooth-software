import { useCallback, useEffect, useRef, useState } from 'react';
import type { KioskApi } from './api/kiosk-api';
import { composePairSheet } from './compose/compose';
import { DEFAULT_PAIR_TIMING, flushDueHeldStrip, heldStripTimerActive, type PairTiming } from './output/held-strip-timer';
import { Attract } from './screens/Attract';
import { Capture } from './screens/Capture';
import { Delivery } from './screens/Delivery';
import { Output } from './screens/Output';
import { Payment } from './screens/Payment';
import { PinPrompt } from './screens/PinPrompt';
import { Review } from './screens/Review';
import { Setup, type SetupAuth } from './screens/Setup';
import { setupNotices, type NoticeFlags } from './screens/setup-notices';
import { registerTap } from './setup/secret-tap';
import { attractStatus } from './state/settings-sync';
import { useKiosk } from './state/useKiosk';
import { QUEUE_INTERVAL_MS, startQueueRunner, type QueueRunner } from './sync/queue';
import { NO_SYNC_FAILURES } from '../../shared/queue';
import { Backdrop } from './theme/components/Backdrop';
import { BannerTitle } from './theme/components/BannerTitle';

type Screen = 'loading' | 'setup' | 'pin' | 'kiosk';

export function App({
  api,
  auth,
  configWarnings = [],
  pairTiming = DEFAULT_PAIR_TIMING,
}: {
  api: KioskApi;
  auth: SetupAuth | null;
  configWarnings?: string[];
  pairTiming?: PairTiming;
}) {
  const [screen, setScreen] = useState<Screen>('loading');
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [noticeFlags, setNoticeFlags] = useState<Omit<NoticeFlags, 'queueUnavailable' | 'syncFailures'> | null>(null);
  // Sync jobs that keep failing (R22): live, refreshed after every queue run like queueUnavailable.
  const [syncFailures, setSyncFailures] = useState<NoticeFlags['syncFailures']>(NO_SYNC_FAILURES);
  // The PIN that unlocked Setup through the secret corner; main needs it to change the PIN. Dropped on exit.
  const [unlockPin, setUnlockPin] = useState<string | null>(null);
  // The saved-sessions file is unreadable (main keeps retrying): no new session may start.
  const [queueUnavailable, setQueueUnavailable] = useState(false);
  const taps = useRef<number[]>([]);
  const queue = useRef<QueueRunner | null>(null);

  // Offline sync: runs every 10 s and after each enqueue, in every screen (jobs survive restarts in queue.json).
  // Each queueList also lets main retry an unreadable queue.json, so queue health is re-checked right after.
  useEffect(() => {
    const intervalMs =
      import.meta.env.VITE_FAKE_API === '1' ? (window.__pbFake?.queueIntervalMs ?? QUEUE_INTERVAL_MS) : QUEUE_INTERVAL_MS;
    const recheckHealth = (): void => {
      window.kiosk.getConfig().then(
        (cfg) => {
          setQueueUnavailable(cfg.queueUnavailable);
          setSyncFailures(cfg.syncFailures);
        },
        (err: unknown) => console.error('Reading queue health failed', err),
      );
    };
    // `window` fires `online` on reconnect: the runner then syncs at once instead of waiting out the backoff.
    const runner = startQueueRunner(api, window.kiosk, intervalMs, recheckHealth, window);
    queue.current = runner;
    return () => {
      runner.stop();
      queue.current = null;
    };
  }, [api]);
  const kickQueue = useCallback(() => queue.current?.kick(), []);

  const reload = (): void => {
    void window.kiosk.getConfig().then((cfg) => {
      setCameraId(cfg.cameraDeviceId);
      setNoticeFlags(cfg);
      setQueueUnavailable(cfg.queueUnavailable);
      setSyncFailures(cfg.syncFailures);
      setUnlockPin(null);
      setScreen(cfg.pinSet ? 'kiosk' : 'setup');
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
      {screen === 'setup' && (
        <Setup
          auth={auth}
          initialCameraId={cameraId}
          currentPin={unlockPin}
          notices={noticeFlags ? setupNotices({ ...noticeFlags, queueUnavailable, syncFailures }) : []}
          configWarnings={configWarnings}
          onDone={reload}
        />
      )}
      {screen === 'pin' && (
        <PinPrompt
          onUnlock={(pin) => {
            setUnlockPin(pin);
            setScreen('setup');
          }}
          onCancel={() => setScreen('kiosk')}
        />
      )}
      {screen === 'kiosk' && (
        <KioskFlow
          api={api}
          cameraId={cameraId}
          queueUnavailable={queueUnavailable}
          onSecretTap={onSecretTap}
          onEnqueued={kickQueue}
          pairTiming={pairTiming}
        />
      )}
    </>
  );
}

/** Guest flow driven by the session state machine. */
function KioskFlow({
  api,
  cameraId,
  queueUnavailable,
  onSecretTap,
  onEnqueued,
  pairTiming,
}: {
  api: KioskApi;
  cameraId: string | null;
  queueUnavailable: boolean;
  onSecretTap: () => void;
  onEnqueued: () => void;
  pairTiming: PairTiming;
}) {
  const { state, settings, dispatch, template, online, ready, downloadToken, sessionCreatedAt } = useKiosk(api);

  // Paired print: while idle on the attract screen, print a held strip alone once it has waited long enough.
  const timerActive = heldStripTimerActive(settings, state.name);
  useEffect(() => {
    if (!timerActive) return;
    let busy = false;
    const id = setInterval(() => {
      if (busy) return;
      busy = true;
      void flushDueHeldStrip({
        bridge: window.kiosk,
        decode: (b) => createImageBitmap(b),
        composePair: composePairSheet,
        now: Date.now,
        waitMs: pairTiming.waitMs,
      }).finally(() => {
        busy = false;
      });
    }, pairTiming.pollMs);
    return () => clearInterval(id);
  }, [timerActive, pairTiming.waitMs, pairTiming.pollMs]);

  switch (state.name) {
    case 'attract':
      return (
        <>
          <Attract
            status={ready ? attractStatus({ settings, template, online, queueUnavailable, trial: import.meta.env.VITE_TRIAL === '1' }) : null}
            onStart={() => dispatch({ type: 'START' })}
          />
          <div className="secret-corner" aria-hidden onPointerDown={onSecretTap} />
        </>
      );
    case 'capture':
      return <Capture state={state} settings={settings} cameraId={cameraId} dispatch={dispatch} />;
    case 'payment':
      return (
        <Payment
          state={state}
          api={api}
          downloadToken={downloadToken}
          templateId={template?.id ?? settings.activeTemplateId}
          dispatch={dispatch}
        />
      );
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
      return (
        <Output
          state={state}
          template={template}
          settings={settings}
          downloadToken={downloadToken}
          createdAt={sessionCreatedAt}
          dispatch={dispatch}
          onEnqueued={onEnqueued}
        />
      );
    case 'delivery':
      return <Delivery state={state} downloadToken={downloadToken} dispatch={dispatch} />;
  }
}
