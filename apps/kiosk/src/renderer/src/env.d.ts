/// <reference types="vite/client" />
import type { KioskBridge } from '../../shared/bridge';

declare global {
  interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL?: string;
    readonly VITE_SUPABASE_ANON_KEY?: string;
    readonly VITE_WEB_BASE_URL?: string;
    readonly VITE_FAKE_API?: string;
  }

  interface Window {
    kiosk: KioskBridge;
  }
}
