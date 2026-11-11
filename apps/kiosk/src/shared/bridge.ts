import type { KioskSettings, Template } from '@pb/core';

/** Device-local configuration, persisted by the main process in `<userData>/config.json`. */
export interface LocalConfig {
  pinHash: string | null;
  printerName: string | null;
  cameraDeviceId: string | null;
  cachedSettings: KioskSettings | null;
  cachedTemplate: Template | null;
}

export const DEFAULT_LOCAL_CONFIG: LocalConfig = {
  pinHash: null,
  printerName: null,
  cameraDeviceId: null,
  cachedSettings: null,
  cachedTemplate: null,
};

/** The only API the renderer can reach in the main process. Exposed as `window.kiosk`. */
export interface KioskBridge {
  getConfig(): Promise<LocalConfig>;
  /** `pinHash` is ignored here; use `setPin`. */
  setConfig(patch: Partial<LocalConfig>): Promise<LocalConfig>;
  setPin(pin: string): Promise<void>;
  checkPin(pin: string): Promise<boolean>;
  saveOverlay(templateId: string, png: ArrayBuffer): Promise<void>;
  readOverlay(templateId: string): Promise<ArrayBuffer | null>;
}

export const IPC = {
  getConfig: 'config:get',
  setConfig: 'config:set',
  setPin: 'pin:set',
  checkPin: 'pin:check',
  saveOverlay: 'overlay:save',
  readOverlay: 'overlay:read',
} as const;

export const PIN_PATTERN = /^\d{4,8}$/;
export const TEMPLATE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
