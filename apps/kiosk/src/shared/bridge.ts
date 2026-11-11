import type { KioskSettings, Template } from '@pb/core';
import type { QueueJob, QueueResult } from './queue';

export type PrintResult = { ok: true } | { ok: false; reason: string };

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
  /** Prints a 1200x1800 JPEG on the configured printer. Never rejects for printer failures. */
  print(jpeg: ArrayBuffer, copies: number): Promise<PrintResult>;
  listPrinters(): Promise<string[]>;
  /** Builds the 4x6 test page and prints it on the configured printer. */
  printTestPage(): Promise<PrintResult>;
  /** Writes `<userData>/photos/<sessionId>.jpg` and resolves to its path. `sessionId` must be a UUID. */
  savePhoto(sessionId: string, jpeg: ArrayBuffer): Promise<string>;
  /** Reads a photo saved by `savePhoto`; any path outside `<userData>/photos/` is rejected. */
  readPhoto(path: string): Promise<ArrayBuffer>;
  /** Persists new sync jobs (attempts and backoff are reset by the main process). */
  queueAdd(jobs: QueueJob[]): Promise<void>;
  queueList(): Promise<QueueJob[]>;
  /** Removes done jobs and records failures (attempts + 1, next attempt time, last error). */
  queueApply(result: QueueResult): Promise<void>;
}

export const IPC = {
  getConfig: 'config:get',
  setConfig: 'config:set',
  setPin: 'pin:set',
  checkPin: 'pin:check',
  saveOverlay: 'overlay:save',
  readOverlay: 'overlay:read',
  print: 'print:send',
  listPrinters: 'print:list',
  debugPrintCalls: 'print:debug-calls',
  savePhoto: 'photo:save',
  readPhoto: 'photo:read',
  queueAdd: 'queue:add',
  queueList: 'queue:list',
  queueApply: 'queue:apply',
} as const;

export const PIN_PATTERN = /^\d{4,8}$/;
export const TEMPLATE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
