import { createClient } from '@supabase/supabase-js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createFakeKioskApi } from './api/fake-api';
import type { KioskApi } from './api/kiosk-api';
import { SupabaseKioskApi } from './api/supabase-api';
import type { SetupAuth } from './screens/Setup';
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

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App api={api} auth={auth} />
  </StrictMode>,
);
