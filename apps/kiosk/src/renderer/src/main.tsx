import { createClient } from '@supabase/supabase-js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createFakeKioskApi } from './api/fake-api';
import type { KioskApi } from './api/kiosk-api';
import { SupabaseKioskApi } from './api/supabase-api';
import { simulateCameraLoss } from './camera/camera';
import { shotStore } from './camera/shot-store';
import { lastSheetInfo, lastSheetPixel } from './debug/last-sheet';
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
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in apps/kiosk/.env');
  // supabase-js persists the kiosk session in this renderer's localStorage.
  const api = new SupabaseKioskApi(createClient(url, key));
  return { api, auth: api };
}

const { api, auth } = createApi();

// e2e-only helpers; the whole block is dropped from production builds.
if (import.meta.env.VITE_FAKE_API === '1') {
  window.__pbDebug = {
    shotCount: () => shotStore.size(),
    killCamera: simulateCameraLoss,
    lastSheet: lastSheetInfo,
    lastSheetPixel,
    printCalls: () => (window.__pbPrintCalls ? window.__pbPrintCalls() : Promise.resolve(0)),
  };
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App api={api} auth={auth} />
  </StrictMode>,
);
