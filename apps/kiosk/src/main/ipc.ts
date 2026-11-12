import { ipcMain } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC, PIN_PATTERN, TEMPLATE_ID_PATTERN, toConfigView, type LocalConfig, type PinCheckResult } from '../shared/bridge';
import type { TestSwitches } from '../shared/test-switches';
import { validateConfigPatch, validateOverlayPng } from './config-validation';
import type { JsonStore } from './json-store';
import { photoPath, resolvePhotoReadPath, validateJpeg } from './photos';
import { createPinThrottle } from './pin-throttle';
import { addJobs, applyResult, validateQueueJobs, validateQueueResult, type QueueFile } from './queue-store';
import { listPrinters, printSheet, validatePrintRequest } from './print';
import { hashPin, verifyPin } from './pin';

function overlayFile(overlayDir: string, templateId: unknown): string {
  if (typeof templateId !== 'string' || !TEMPLATE_ID_PATTERN.test(templateId)) {
    throw new Error('Invalid template id');
  }
  return join(overlayDir, `${templateId}.png`);
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Every handler treats its arguments as untrusted renderer input. */
export function registerIpc(
  store: JsonStore<LocalConfig>,
  overlayDir: string,
  photosDir: string,
  queue: JsonStore<QueueFile>,
  switches: TestSwitches,
): void {
  mkdirSync(overlayDir, { recursive: true });
  mkdirSync(photosDir, { recursive: true });

  // The renderer never receives the PIN hash; it only learns whether a PIN is set.
  ipcMain.handle(IPC.getConfig, () => toConfigView(store.get()));

  ipcMain.handle(IPC.setConfig, (_e, patch: unknown) => {
    const valid = validateConfigPatch(patch);
    return toConfigView(store.update((c) => ({ ...c, ...valid })));
  });

  ipcMain.handle(IPC.setPin, (_e, pin: unknown) => {
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) throw new Error('PIN must be 4 to 8 digits');
    // Finishing Setup (which always sets the PIN) clears the damaged-settings notice.
    store.update((c) => ({ ...c, pinHash: hashPin(pin), recoveredFromCorruption: false }));
  });

  const pinThrottle = createPinThrottle();
  ipcMain.handle(IPC.checkPin, (_e, pin: unknown): PinCheckResult => {
    const locked = pinThrottle.retryAfterMs();
    if (locked > 0) return { ok: false, retryAfterMs: locked };
    const stored = store.get().pinHash;
    if (typeof pin === 'string' && stored !== null && verifyPin(pin, stored)) {
      pinThrottle.recordSuccess();
      return { ok: true };
    }
    const lock = pinThrottle.recordFailure();
    return { ok: false, retryAfterMs: lock > 0 ? lock : null };
  });

  ipcMain.handle(IPC.saveOverlay, (_e, templateId: unknown, png: unknown) => {
    const file = overlayFile(overlayDir, templateId);
    writeFileSync(file, validateOverlayPng(png));
  });

  // Test switches are all off in a packaged app (see testSwitches).
  const { fakePrint, fakePrintFail } = switches;
  let fakePrintCalls = 0;

  ipcMain.handle(IPC.print, async (_e, jpeg: unknown, copies: unknown) => {
    const bytes = validatePrintRequest(jpeg, copies);
    if (fakePrint) {
      fakePrintCalls += 1;
      return fakePrintFail ? { ok: false, reason: fakePrintFail } : { ok: true };
    }
    return printSheet(bytes, copies as number, store.get().printerName);
  });

  ipcMain.handle(IPC.listPrinters, (e) => (fakePrint ? ['Fake Printer'] : listPrinters(e.sender)));

  if (fakePrint) ipcMain.handle(IPC.debugPrintCalls, () => fakePrintCalls);

  ipcMain.handle(IPC.savePhoto, (_e, sessionId: unknown, jpeg: unknown) => {
    const file = photoPath(photosDir, sessionId);
    const bytes = validateJpeg(jpeg);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, file);
    return file;
  });

  ipcMain.handle(IPC.readPhoto, (_e, path: unknown) => toArrayBuffer(readFileSync(resolvePhotoReadPath(photosDir, path))));

  ipcMain.handle(IPC.queueAdd, (_e, jobs: unknown) => {
    const valid = validateQueueJobs(jobs, photosDir);
    queue.update((q) => addJobs(q, valid));
  });

  ipcMain.handle(IPC.queueList, () => queue.get().jobs);

  ipcMain.handle(IPC.queueApply, (_e, result: unknown) => {
    const valid = validateQueueResult(result);
    queue.update((q) => applyResult(q, valid, Date.now()));
  });

  ipcMain.handle(IPC.readOverlay, (_e, templateId: unknown) => {
    try {
      return toArrayBuffer(readFileSync(overlayFile(overlayDir, templateId)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  });
}
