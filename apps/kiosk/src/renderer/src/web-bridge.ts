import { validateSettings, type KioskSettings, type SessionSync, type Template } from '@pb/core';
import {
  DEFAULT_LOCAL_CONFIG,
  PIN_PATTERN,
  TEMPLATE_ID_PATTERN,
  toConfigView,
  type ConfigPatch,
  type KioskBridge,
  type LocalConfig,
  type StoreHealth,
} from '../../shared/bridge';
import { MAX_PRINT_ERROR_CHARS, NO_SYNC_FAILURES, UUID_PATTERN, truncatePrintError, type QueueJob, type QueueResult } from '../../shared/queue';
import { buildTestPageJpeg } from '../../shared/test-page';
import { createPinThrottle } from '../../main/pin-throttle';
import type { WebPrintUi } from './web-print';
import type { KeyValueStore } from './web-store';

const CONFIG_KEY = 'config';
const QUEUE_KEY = 'queue';
const PHOTO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OVERLAY_BYTES = 10 * 1024 * 1024;
const MAX_PRINTER_CHARS = 200;
const MAX_CAMERA_CHARS = 500;
const MAX_JOBS_PER_ADD = 10;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface QueueData {
  jobs: QueueJob[];
  completedUploads: { sessionId: string; completedAt: number }[];
}

interface StoredPhoto {
  blob: Blob;
  savedAt: number;
}

interface StoredOverlay {
  blob: Blob;
  savedAt: number;
}

const emptyQueue = (): QueueData => ({ jobs: [], completedUploads: [] });
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
const isIso = (value: unknown): value is string =>
  typeof value === 'string' && ISO_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
const photoKey = (id: string): string => 'photos/' + id + '.jpg';
const overlayKey = (id: string): string => 'overlays/' + id + '.png';

function cloneDefaultConfig(): LocalConfig {
  return { ...DEFAULT_LOCAL_CONFIG };
}

function validTemplate(value: unknown): Template | null {
  if (value === null) return null;
  if (!isObject(value)) return null;
  const { id, name, layout, overlayPath } = value;
  if (typeof id !== 'string' || !TEMPLATE_ID_PATTERN.test(id)) return null;
  if (typeof name !== 'string' || name.length > 60) return null;
  if (layout !== 'strip_2x6' && layout !== 'print_4r') return null;
  if (typeof overlayPath !== 'string' || overlayPath.length > 200) return null;
  return { id, name, layout, overlayPath };
}

function validSettings(value: unknown): KioskSettings | null {
  if (value === null) return null;
  const result = validateSettings(value);
  return result.ok ? result.value : null;
}

function validPinHash(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  const parts = value.split('$');
  return parts.length === 4 && parts[0] === 'pbkdf2' && parts[1] === '100000' &&
    decodeBase64(parts[2])?.length === 16 && decodeBase64(parts[3])?.length === 32;
}

function normalizeConfig(value: unknown): LocalConfig {
  if (value === undefined) return cloneDefaultConfig();
  if (!isObject(value)) return { ...cloneDefaultConfig(), recoveredFromCorruption: true };

  const pinValid = validPinHash(value.pinHash);
  const printerValid = value.printerName === null ||
    (typeof value.printerName === 'string' && value.printerName.length <= MAX_PRINTER_CHARS);
  const cameraValid = value.cameraDeviceId === null ||
    (typeof value.cameraDeviceId === 'string' && value.cameraDeviceId.length <= MAX_CAMERA_CHARS);
  const settings = validSettings(value.cachedSettings);
  const template = validTemplate(value.cachedTemplate);
  const settingsValid = value.cachedSettings === null || settings !== null;
  const templateValid = value.cachedTemplate === null || template !== null;
  const flagsValid = typeof value.recoveredFromCorruption === 'boolean' && typeof value.uploadsDropped === 'boolean';

  return {
    pinHash: pinValid ? value.pinHash as string | null : null,
    printerName: printerValid ? value.printerName as string | null : null,
    cameraDeviceId: cameraValid ? value.cameraDeviceId as string | null : null,
    cachedSettings: settingsValid ? settings : null,
    cachedTemplate: templateValid ? template : null,
    recoveredFromCorruption: value.recoveredFromCorruption === true ||
      !pinValid || !printerValid || !cameraValid || !settingsValid || !templateValid || !flagsValid,
    uploadsDropped: value.uploadsDropped === true,
  };
}

function validateConfigPatch(value: unknown): ConfigPatch {
  if (!isObject(value)) throw new Error('Invalid config patch');
  const patch: ConfigPatch = {};
  if ('printerName' in value) {
    if (value.printerName !== null && (typeof value.printerName !== 'string' || value.printerName.length > MAX_PRINTER_CHARS)) {
      throw new Error('Invalid printer name');
    }
    patch.printerName = value.printerName as string | null;
  }
  if ('cameraDeviceId' in value) {
    if (value.cameraDeviceId !== null && (typeof value.cameraDeviceId !== 'string' || value.cameraDeviceId.length > MAX_CAMERA_CHARS)) {
      throw new Error('Invalid camera selection');
    }
    patch.cameraDeviceId = value.cameraDeviceId as string | null;
  }
  if ('cachedSettings' in value) {
    const settings = validSettings(value.cachedSettings);
    if (value.cachedSettings !== null && settings === null) throw new Error('Invalid cached settings');
    patch.cachedSettings = settings;
  }
  if ('cachedTemplate' in value) {
    const template = validTemplate(value.cachedTemplate);
    if (value.cachedTemplate !== null && template === null) throw new Error('Invalid cached template');
    patch.cachedTemplate = template;
  }
  return patch;
}

function validateRow(value: unknown): SessionSync {
  if (!isObject(value)) throw new Error('Invalid queue session row');
  const row = value;
  if (!isUuid(row.id)) throw new Error('Invalid session id');
  if (typeof row.downloadToken !== 'string' || !TOKEN_PATTERN.test(row.downloadToken)) throw new Error('Invalid download token');
  if (typeof row.templateId !== 'string' || !TEMPLATE_ID_PATTERN.test(row.templateId)) throw new Error('Invalid template id');
  if (typeof row.amountCentavos !== 'number' || !Number.isInteger(row.amountCentavos) || row.amountCentavos < 0 || row.amountCentavos > 100_000) {
    throw new Error('Invalid session amount');
  }
  if (row.status !== 'free' && row.status !== 'completed') throw new Error('Invalid session status');
  if (row.printError !== null && typeof row.printError !== 'string') throw new Error('Invalid print error');
  if (!isIso(row.createdAt) || (row.completedAt !== null && !isIso(row.completedAt))) throw new Error('Invalid session timestamp');
  return {
    id: row.id,
    downloadToken: row.downloadToken,
    templateId: row.templateId,
    amountCentavos: row.amountCentavos,
    status: row.status,
    printError: row.printError === null ? null : truncatePrintError(row.printError),
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

function normalizedQueue(value: unknown): QueueData {
  if (!isObject(value) || !Array.isArray(value.jobs) || !Array.isArray(value.completedUploads)) return emptyQueue();
  const jobs = value.jobs.flatMap((item): QueueJob[] => {
    if (!isObject(item) || !isUuid(item.id) ||
      typeof item.attempts !== 'number' || !Number.isInteger(item.attempts) || item.attempts < 0 ||
      typeof item.nextAttemptAt !== 'number' || !Number.isFinite(item.nextAttemptAt) ||
      (item.lastError !== null && typeof item.lastError !== 'string')) return [];
    const retry = {
      attempts: item.attempts,
      nextAttemptAt: item.nextAttemptAt,
      lastError: item.lastError as string | null,
      ...(typeof item.firstFailedAt === 'number' && Number.isFinite(item.firstFailedAt) ? { firstFailedAt: item.firstFailedAt } : {}),
    };
    try {
      if (item.kind === 'upsert_session') return [{ id: item.id, kind: 'upsert_session', row: validateRow(item.row), ...retry }];
      if (item.kind === 'upload_photo' && isUuid(item.sessionId)) {
        return [{ id: item.id, kind: 'upload_photo', sessionId: item.sessionId, filePath: photoKey(item.sessionId), ...retry }];
      }
    } catch {
      return [];
    }
    return [];
  });
  const completedUploads = value.completedUploads.flatMap((item) =>
    isObject(item) && isUuid(item.sessionId) && typeof item.completedAt === 'number' && Number.isFinite(item.completedAt)
      ? [{ sessionId: item.sessionId, completedAt: item.completedAt }]
      : [],
  );
  return { jobs, completedUploads };
}

function validQueueData(value: unknown): value is { jobs: unknown[]; completedUploads: unknown[] } {
  if (!isObject(value) || !Array.isArray(value.jobs) || !Array.isArray(value.completedUploads)) return false;
  const normalized = normalizedQueue(value);
  return normalized.jobs.length === value.jobs.length &&
    normalized.completedUploads.length === value.completedUploads.length &&
    new Set(normalized.jobs.map((job) => job.id)).size === normalized.jobs.length;
}

function validateJobs(value: unknown): QueueJob[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_JOBS_PER_ADD) throw new Error('Invalid queue job list');
  return value.map((item): QueueJob => {
    if (!isObject(item) || !isUuid(item.id)) throw new Error('Invalid queue job');
    if (item.kind === 'upsert_session') {
      return { id: item.id, kind: 'upsert_session', row: validateRow(item.row), attempts: 0, nextAttemptAt: 0, lastError: null };
    }
    if (item.kind === 'upload_photo' && isUuid(item.sessionId) && item.filePath === photoKey(item.sessionId)) {
      return { id: item.id, kind: 'upload_photo', sessionId: item.sessionId, filePath: item.filePath, attempts: 0, nextAttemptAt: 0, lastError: null };
    }
    throw new Error('Invalid queue job payload');
  });
}

function validateResult(value: unknown): QueueResult {
  if (!isObject(value) || !Array.isArray(value.done) || !Array.isArray(value.failed)) throw new Error('Invalid queue result');
  const done = value.done.map((id) => {
    if (!isUuid(id)) throw new Error('Invalid completed job id');
    return id;
  });
  const failed = value.failed.map((item) => {
    if (!isObject(item) || !isUuid(item.id) || typeof item.error !== 'string' ||
      typeof item.nextAttemptAt !== 'number' || !Number.isFinite(item.nextAttemptAt)) throw new Error('Invalid failed job');
    return { id: item.id, error: item.error.slice(0, MAX_PRINT_ERROR_CHARS), nextAttemptAt: item.nextAttemptAt };
  });
  return { done, failed };
}

function failureSummary(jobs: QueueJob[], now: number): StoreHealth['syncFailures'] {
  const failing = jobs.filter((job) => job.attempts >= 10 ||
    (job.firstFailedAt !== undefined && now - job.firstFailedAt > 60 * 60 * 1000));
  if (failing.length === 0) return NO_SYNC_FAILURES;
  const starts = failing.flatMap((job) => job.firstFailedAt === undefined ? [] : [job.firstFailedAt]);
  const latest = failing.reduce((a, b) => b.nextAttemptAt > a.nextAttemptAt ? b : a);
  return { failingCount: failing.length, oldestFailingSince: starts.length ? Math.min(...starts) : null, lastError: latest.lastError };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return bytesToBase64(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
  return 'pbkdf2$100000$' + bytesToBase64(salt) + '$' + bytesToBase64(new Uint8Array(bits));
}

async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2' || parts[1] !== '100000') return false;
  const salt = decodeBase64(parts[2]);
  const expected = decodeBase64(parts[3]);
  if (!salt || salt.length !== 16 || !expected || expected.length !== 32) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const saltBuffer = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltBuffer).set(salt);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations: 100_000 }, key, 256));
  return bits.every((byte, index) => byte === expected[index]);
}

function validPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && bytes.length <= MAX_OVERLAY_BYTES &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

export interface BrowserBridgeBundle {
  bridge: KioskBridge;
  ready: Promise<void>;
  cleanup(): void;
}

export function createBrowserBridge(
  store: KeyValueStore,
  printer: WebPrintUi,
  now: () => number = Date.now,
): BrowserBridgeBundle {
  const throttle = createPinThrottle(now);
  let pinTail = Promise.resolve();
  let queueUnavailable = false;

  const withPinLock = <T>(work: () => Promise<T>): Promise<T> => {
    const next = pinTail.then(work, work);
    pinTail = next.then(() => undefined, () => undefined);
    return next;
  };

  const readConfig = async (): Promise<LocalConfig> =>
    store.update('meta', CONFIG_KEY, (value) => normalizeConfig(value));

  const readQueue = async (): Promise<QueueData> => {
    const stored = await store.get<unknown>('meta', QUEUE_KEY);
    if (stored === undefined) {
      queueUnavailable = false;
      return emptyQueue();
    }
    if (!validQueueData(stored)) {
      queueUnavailable = true;
      return emptyQueue();
    }
    queueUnavailable = false;
    return normalizedQueue(stored);
  };

  const saveQueue = async (change: (queue: QueueData) => QueueData): Promise<void> => {
    try {
      await store.update<unknown>('meta', QUEUE_KEY, (value) => {
        if (value !== undefined && !validQueueData(value)) throw new Error('The saved sync queue is damaged; reload the app and contact staff.');
        return change(value === undefined ? emptyQueue() : normalizedQueue(value));
      });
      queueUnavailable = false;
    } catch (error) {
      queueUnavailable = true;
      throw error;
    }
  };

  const configView = async (): Promise<ReturnType<typeof toConfigView>> => {
    const [config, queue] = await Promise.all([readConfig(), readQueue()]);
    return toConfigView(config, {
      settingsUnreadable: false,
      queueUnavailable,
      syncFailures: failureSummary(queue.jobs, now()),
    });
  };

  const checkPinUnlocked = async (pin: string): Promise<{ ok: true } | { ok: false; retryAfterMs: number | null }> => {
    const wait = throttle.retryAfterMs();
    if (wait > 0) return { ok: false, retryAfterMs: wait };
    const config = await readConfig();
    const ok = typeof pin === 'string' && PIN_PATTERN.test(pin) && config.pinHash !== null && await verifyPin(pin, config.pinHash);
    if (ok) {
      throttle.recordSuccess();
      return { ok: true };
    }
    const retryAfterMs = throttle.recordFailure();
    return { ok: false, retryAfterMs: retryAfterMs > 0 ? retryAfterMs : null };
  };

  const bridge: KioskBridge = {
    async getConfig() {
      return configView();
    },

    async setConfig(patchValue: ConfigPatch) {
      const patch = validateConfigPatch(patchValue);
      const config = await store.update<LocalConfig>('meta', CONFIG_KEY, (stored) => ({ ...normalizeConfig(stored), ...patch }));
      const queue = await readQueue();
      return toConfigView(config, {
        queueUnavailable,
        syncFailures: failureSummary(queue.jobs, now()),
      });
    },

    async setPin(pin, currentPin) {
      return withPinLock(async () => {
        if (!PIN_PATTERN.test(pin)) throw new Error('PIN must be 4 to 8 digits');
        const config = await readConfig();
        if (config.pinHash !== null) {
          const checked = await checkPinUnlocked(currentPin ?? '');
          if (!checked.ok) throw new Error(checked.retryAfterMs ? 'Too many wrong PIN attempts; try again later' : 'Current PIN is incorrect');
        }
        const pinHash = await hashPin(pin);
        const updated = await store.update<LocalConfig>('meta', CONFIG_KEY, (stored) => ({
          ...normalizeConfig(stored),
          pinHash,
          recoveredFromCorruption: false,
          uploadsDropped: false,
        }));
        void updated;
      });
    },

    async checkPin(pin) {
      return withPinLock(() => checkPinUnlocked(pin));
    },

    async saveOverlay(templateId, png) {
      if (!TEMPLATE_ID_PATTERN.test(templateId)) throw new Error('Invalid template id');
      const bytes = new Uint8Array(png);
      if (!validPng(bytes)) throw new Error('Overlay must be a PNG image under 10 MB');
      await store.put<StoredOverlay>('blobs', overlayKey(templateId), {
        blob: new Blob([bytes], { type: 'image/png' }),
        savedAt: now(),
      });
    },

    async readOverlay(templateId) {
      if (!TEMPLATE_ID_PATTERN.test(templateId)) throw new Error('Invalid template id');
      const stored = await store.get<StoredOverlay>('blobs', overlayKey(templateId));
      return stored ? stored.blob.arrayBuffer() : null;
    },

    async print(jpeg, _copies) {
      return printer.print(jpeg);
    },

    listPrinters() {
      return Promise.resolve(['AirPrint (choose the printer on the iPad)']);
    },

    async printTestPage() {
      return printer.print(await buildTestPageJpeg());
    },

    async savePhoto(sessionId, jpeg) {
      if (!UUID_PATTERN.test(sessionId)) throw new Error('Invalid session id');
      await store.put<StoredPhoto>('blobs', photoKey(sessionId), {
        blob: new Blob([jpeg], { type: 'image/jpeg' }),
        savedAt: now(),
      });
      return photoKey(sessionId);
    },

    async readPhoto(path) {
      const match = /^photos\/([0-9a-f-]{36})\.jpg$/i.exec(path);
      if (!match || !UUID_PATTERN.test(match[1])) throw new Error('Invalid photo path');
      const photo = await store.get<StoredPhoto>('blobs', photoKey(match[1]));
      if (!photo) throw new Error('Photo is no longer available on this iPad');
      return photo.blob.arrayBuffer();
    },

    async queueAdd(value) {
      const jobs = validateJobs(value);
      await saveQueue((queue) => {
        const known = new Set(queue.jobs.map((job) => job.id));
        return { ...queue, jobs: [...queue.jobs, ...jobs.filter((job) => !known.has(job.id))] };
      });
    },

    async queueList() {
      return (await readQueue()).jobs;
    },

    async queueApply(value) {
      const result = validateResult(value);
      const nowMs = now();
      await saveQueue((queue) => {
        const done = new Set(result.done);
        const failed = new Map(result.failed.map((item) => [item.id, item]));
        const completedUploads = [...queue.completedUploads];
        const jobs = queue.jobs.flatMap((job): QueueJob[] => {
          if (done.has(job.id)) {
            if (job.kind === 'upload_photo') completedUploads.push({ sessionId: job.sessionId, completedAt: nowMs });
            return [];
          }
          const failure = failed.get(job.id);
          if (!failure) return [job];
          return [{
            ...job,
            attempts: job.attempts + 1,
            nextAttemptAt: failure.nextAttemptAt,
            lastError: failure.error,
            firstFailedAt: job.firstFailedAt ?? nowMs,
          }];
        });
        return { jobs, completedUploads };
      });
    },

    async getHeldStrip() { return null; },
    async holdStrip() {},
    async claimHeldStrip() { return null; },
  };

  const cleanup = async (): Promise<void> => {
    const queue = await readQueue();
    if (queueUnavailable) return;
    const pendingUploads = new Set(queue.jobs.flatMap((job) => job.kind === 'upload_photo' ? [job.sessionId] : []));
    const completed = new Map(queue.completedUploads.map((upload) => [upload.sessionId, upload.completedAt]));
    for (const [key, record] of await store.entries<StoredPhoto>('blobs')) {
      if (!key.startsWith('photos/')) continue;
      const id = key.slice('photos/'.length, -'.jpg'.length);
      if (!UUID_PATTERN.test(id)) {
        await store.delete('blobs', key);
        continue;
      }
      if (pendingUploads.has(id)) continue;
      const completedAt = completed.get(id);
      const ageFrom = completedAt ?? record.savedAt;
      if (typeof ageFrom === 'number' && now() - ageFrom >= PHOTO_RETENTION_MS) await store.delete('blobs', key);
    }
    await saveQueue((current) => ({
      jobs: current.jobs,
      completedUploads: current.completedUploads.filter((upload) => now() - upload.completedAt < PHOTO_RETENTION_MS),
    }));
  };

  const ready = (async () => {
    await store.update('meta', CONFIG_KEY, (value) => normalizeConfig(value));
    await readQueue();
    await cleanup();
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.persist) await navigator.storage.persist();
    } catch {
      // Persistent storage is best-effort; the staff guide explains Safari site-data retention.
    }
  })();

  return { bridge, ready, cleanup: () => printer.cancel() };
}
