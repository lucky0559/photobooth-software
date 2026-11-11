import type { KioskSettings, KioskState, Template } from '@pb/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildSessionSheet } from '../compose/session-sheet';
import { recordSheet } from '../debug/last-sheet';
import { runOutput } from '../output/run-output';
import type { KioskInput } from '../state/useKiosk';
import { ActionButton } from '../theme/components/ActionButton';
import { Backdrop } from '../theme/components/Backdrop';
import { BannerTitle } from '../theme/components/BannerTitle';
import { FramedCard } from '../theme/components/FramedCard';
import { ShutterIris } from '../theme/decor/ShutterIris';

type OutputState = Extract<KioskState, { name: 'output' }>;

/** e2e-only: `window.__pbFake.failCompose` makes the next N compositions reject. */
function fakeComposeFailure(): void {
  const fake = window.__pbFake;
  if (fake?.failCompose && fake.failCompose > 0) {
    fake.failCompose -= 1;
    throw new Error('Fake compose failure');
  }
}

/** Composes, saves, prints and queues the session photo, then moves on to Delivery. */
export function Output({
  state,
  template,
  settings,
  downloadToken,
  createdAt,
  dispatch,
  onEnqueued,
}: {
  state: OutputState;
  template: Template | null;
  settings: KioskSettings;
  downloadToken: string | null;
  createdAt: string | null;
  dispatch: (e: KioskInput) => void;
  onEnqueued: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const running = useRef(false);

  const run = useCallback((): void => {
    if (running.current) return;
    running.current = true;
    setFailed(false);
    void (async () => {
      try {
        if (!template || !downloadToken || !createdAt) throw new Error('Session is incomplete');
        const { printError, sheet } = await runOutput({
          compose: async () => {
            if (import.meta.env.VITE_FAKE_API === '1') fakeComposeFailure();
            return buildSessionSheet({ template, shotIds: state.shots, filter: state.filter });
          },
          bridge: window.kiosk,
          onEnqueued,
          copies: settings.copiesPerSession,
          session: {
            sessionId: state.sessionId,
            downloadToken,
            templateId: template.id,
            amountCentavos: state.amountCentavos,
            createdAt,
          },
          now: Date.now,
          newId: () => crypto.randomUUID(),
        });
        if (import.meta.env.VITE_FAKE_API === '1') recordSheet(sheet);
        dispatch({ type: 'OUTPUT_DONE', printError, now: Date.now() });
      } catch (err) {
        console.error('Output failed', err);
        running.current = false;
        setFailed(true);
      }
    })();
  }, [state, template, settings.copiesPerSession, downloadToken, createdAt, dispatch, onEnqueued]);

  // Runs once on entry (the ref also guards StrictMode's double effect); Try again re-runs it.
  useEffect(run, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) {
    return (
      <main className="stage stage--dark output-error">
        <Backdrop kind="darkroom" />
        <FramedCard className="message-card">
          <h1>We couldn't save your photo. Please call staff.</h1>
          <ActionButton onClick={run}>Try again</ActionButton>
        </FramedCard>
      </main>
    );
  }

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
