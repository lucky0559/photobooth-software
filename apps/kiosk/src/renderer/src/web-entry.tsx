import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createDemoKioskApi } from './api/demo-api';
import { checkWebCapabilities } from './web-capabilities';
import { createBrowserBridge } from './web-bridge';
import { IndexedDbStore } from './web-store';
import { createWebTrial, WEB_TRIAL_KEY } from './web-trial';
import { WebPrintController } from './web-print';
import { TRIAL_HEARTBEAT_MS, type TrialStatus } from '../../shared/trial-clock';
import '@fontsource/bungee/400.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import './theme/tokens.css';
import './theme/theme.css';
import './styles.css';
import './web.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Photobooth root element is missing');
const root = createRoot(rootElement);
const api = createDemoKioskApi({ pairedPrint: false });
const trial = createWebTrial({
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
});

function StatusMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="web-message" role="status">
      <h1>{title}</h1>
      {children}
    </main>
  );
}

function TrialEnded() {
  return (
    <StatusMessage title="Trial ended">
      <p>Thank you for trying Photobooth.</p>
      <p>Please contact your vendor to continue.</p>
    </StatusMessage>
  );
}

function BrowserShell({ printer }: { printer: WebPrintController }) {
  const [trialStatus, setTrialStatus] = useState<TrialStatus>(() => trial.check());
  const [offlineWarning, setOfflineWarning] = useState<string | null>(null);

  useEffect(() => {
    const checkTrial = (): void => {
      const next = trial.check();
      if (next.state === 'ended') printer.cancel();
      setTrialStatus(next);
    };
    const syncStorage = (event: StorageEvent): void => {
      if (event.key === null || event.key === WEB_TRIAL_KEY) checkTrial();
    };
    const interval = window.setInterval(checkTrial, TRIAL_HEARTBEAT_MS);
    window.addEventListener('focus', checkTrial);
    window.addEventListener('storage', syncStorage);
    document.addEventListener('visibilitychange', checkTrial);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', checkTrial);
      window.removeEventListener('storage', syncStorage);
      document.removeEventListener('visibilitychange', checkTrial);
    };
  }, [printer]);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (!('serviceWorker' in navigator)) {
      setOfflineWarning('Offline app installation is unavailable in this browser. Keep the iPad online while testing.');
      return;
    }
    let live = true;
    void navigator.serviceWorker.register(new URL('sw.js', document.baseURI))
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (live) setOfflineWarning(null);
      })
      .catch(() => {
        if (live) setOfflineWarning('Offline app installation could not be confirmed. Keep the iPad online and reload.');
      });
    return () => {
      live = false;
    };
  }, []);

  if (trialStatus.state === 'ended') return <TrialEnded />;
  return <App api={api} auth={null} webPrint={printer} configWarnings={offlineWarning ? [offlineWarning] : []} />;
}

function showProblem(title: string, messages: string[]): void {
  root.render(
    <StatusMessage title={title}>
      {messages.map((message) => <p key={message}>{message}</p>)}
    </StatusMessage>,
  );
}

async function bootstrap(): Promise<void> {
  root.render(<StatusMessage title="Photobooth Trial"><p>Preparing this iPad…</p></StatusMessage>);
  const currentTrial = trial.check();
  if (currentTrial.state === 'ended') {
    root.render(<TrialEnded />);
    return;
  }

  const problems = await checkWebCapabilities();
  if (problems.length > 0) {
    showProblem('This iPad cannot start the trial app', problems);
    return;
  }

  const printLayer = document.getElementById('print-layer');
  if (!printLayer) {
    showProblem('This page is incomplete', ['Reload the Photobooth Trial page.']);
    return;
  }

  const printer = new WebPrintController(printLayer, window);
  const bundle = createBrowserBridge(new IndexedDbStore(window.indexedDB), printer);
  window.kiosk = bundle.bridge;
  window.kioskPrint = printer;

  try {
    await bundle.ready;
  } catch {
    bundle.cleanup();
    showProblem('Could not prepare this iPad', [
      'Safari could not open the local Photobooth storage.',
      'Enable Safari website data, close other Photobooth tabs, and reload.',
    ]);
    return;
  }

  if (trial.check().state === 'ended') {
    bundle.cleanup();
    root.render(<TrialEnded />);
    return;
  }

  window.addEventListener('pagehide', bundle.cleanup, { once: true });
  root.render(
    <StrictMode>
      <BrowserShell printer={printer} />
    </StrictMode>,
  );
}

void bootstrap();