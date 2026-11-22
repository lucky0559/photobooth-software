import { isPairedMode, type KioskSettings, type KioskState, type Template } from '@pb/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { composePairSheet } from '../compose/compose';
import { buildSessionSheet, buildSessionStrip } from '../compose/session-sheet';
import { recordSheet } from '../debug/last-sheet';
import { runOutput, type PairedOutcome } from '../output/run-output';
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
  /** Print outcome per session, so Try again never prints a second sheet. */
  const printed = useRef<{ sessionId: string; printError: string | null } | null>(null);

  /** Paired outcome per session, so Try again never claims, holds or prints the strip a second time. */
  const pairedOutcome = useRef<{ sessionId: string; outcome: PairedOutcome } | null>(null);

  const run = useCallback((): void => {
    if (running.current) return;
    running.current = true;
    setFailed(false);
    void (async () => {
      try {
        if (!template || !downloadToken || !createdAt) throw new Error('Session is incomplete');
        const paired = isPairedMode({ pairedPrint: settings.pairedPrint }, template.layout);
        const { printError, held, sheet } = await runOutput({
          compose: async () => {
            if (import.meta.env.VITE_FAKE_API === '1') fakeComposeFailure();
            const source = { template, shotIds: state.shots, filter: state.filter };
            return paired ? buildSessionStrip(source) : buildSessionSheet(source);
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
          priorPrint: printed.current?.sessionId === state.sessionId ? printed.current : undefined,
          onPrinted: (printError) => {
            printed.current = { sessionId: state.sessionId, printError };
          },
          paired: paired
            ? {
                bridge: window.kiosk,
                decode: (b) => createImageBitmap(b),
                composePair: composePairSheet,
                prior: pairedOutcome.current?.sessionId === state.sessionId ? pairedOutcome.current.outcome : undefined,
                onOutcome: (outcome) => {
                  pairedOutcome.current = { sessionId: state.sessionId, outcome };
                },
              }
            : undefined,
        });
        if (import.meta.env.VITE_FAKE_API === '1') recordSheet(sheet);
        dispatch({ type: 'OUTPUT_DONE', printError, held, now: Date.now() });
      } catch (err) {
        console.error('Output failed', err);
        running.current = false;
        setFailed(true);
      }
    })();
  }, [state, template, settings.copiesPerSession, settings.pairedPrint, downloadToken, createdAt, dispatch, onEnqueued]);

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
