import { createClient } from '@supabase/supabase-js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createFakeKioskApi, FakeKioskApi } from './api/fake-api';
import type { KioskApi } from './api/kiosk-api';
import { SupabaseKioskApi } from './api/supabase-api';
import { simulateCameraLoss } from './camera/camera';
import { shotStore } from './camera/shot-store';
import { lastSheetInfo, lastSheetPixel } from './debug/last-sheet';
import { checkEnv } from './env-check';
import { NotConfigured } from './screens/NotConfigured';
import type { SetupAuth } from './screens/Setup';
// Fonts are bundled from @fontsource: the kiosk may be offline, so no runtime font requests.
import '@fontsource/bungee/400.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import './theme/tokens.css';
import './theme/theme.css';
import './styles.css';

function createApi(): { api: KioskApi; auth: SetupAuth | null } {
  if (import.meta.env.VITE_FAKE_API === '1') return { api: createFakeKioskApi(), auth: null };
  // checkEnv has already verified both are set.
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  // supabase-js persists the kiosk session in this renderer's localStorage.
  const api = new SupabaseKioskApi(createClient(url, key));
  return { api, auth: api };
}

const root = createRoot(document.getElementById('root') as HTMLElement);
const env = checkEnv(import.meta.env);
if (env.warnings.length > 0) console.warn(`Kiosk config warning: not set or invalid: ${env.warnings.join(', ')}`);

if (!env.ok) {
  // No devtools in a packaged kiosk: tell staff instead of showing a black screen.
  root.render(<NotConfigured missing={env.missing} warnings={env.warnings} />);
} else {
  const { api, auth } = createApi();
  if (import.meta.env.VITE_FAKE_API === '1') installDebugHooks(api);
  root.render(
    <StrictMode>
      <App api={api} auth={auth} configWarnings={env.warnings} />
    </StrictMode>,
  );
}

// e2e-only helpers; only called (and only bundled) when VITE_FAKE_API=1.
function installDebugHooks(api: KioskApi): void {
  window.__pbDebug = {
    shotCount: () => shotStore.size(),
    killCamera: simulateCameraLoss,
    lastSheet: lastSheetInfo,
    lastSheetPixel,
    printCalls: () => (window.__pbPrintCalls ? window.__pbPrintCalls() : Promise.resolve(0)),
    queueLength: async () => (await window.kiosk.queueList()).length,
    syncedSessions: () => (api instanceof FakeKioskApi ? [...api.sessions.values()] : []),
    createPaymentCalls: () => (api instanceof FakeKioskApi ? api.createPaymentCalls : 0),
  };
}
