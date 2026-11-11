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
    /** e2e-only helpers, installed only when `VITE_FAKE_API=1`. */
    __pbDebug?: {
      shotCount(): number;
      killCamera(): void;
      lastSheet(): Promise<{ width: number; height: number; type: string } | null>;
      lastSheetPixel(x: number, y: number): Promise<[number, number, number, number] | null>;
    };
  }
}
