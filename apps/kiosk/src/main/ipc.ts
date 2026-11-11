import { ipcMain } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC, PIN_PATTERN, TEMPLATE_ID_PATTERN, type LocalConfig } from '../shared/bridge';
import type { JsonStore } from './json-store';
import { photoPath, resolvePhotoReadPath, validateJpeg } from './photos';
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

export function registerIpc(
  store: JsonStore<LocalConfig>,
  overlayDir: string,
  photosDir: string,
  queue: JsonStore<QueueFile>,
): void {
  mkdirSync(overlayDir, { recursive: true });
  mkdirSync(photosDir, { recursive: true });

  ipcMain.handle(IPC.getConfig, () => store.get());

  ipcMain.handle(IPC.setConfig, (_e, patch: Partial<LocalConfig>) => {
    // The PIN hash can only change through setPin.
    const { pinHash: _ignored, ...rest } = patch ?? {};
    return store.update((c) => ({ ...c, ...rest }));
  });

  ipcMain.handle(IPC.setPin, (_e, pin: unknown) => {
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) throw new Error('PIN must be 4 to 8 digits');
    store.update((c) => ({ ...c, pinHash: hashPin(pin) }));
  });

  ipcMain.handle(IPC.checkPin, (_e, pin: unknown) => {
    const stored = store.get().pinHash;
    return typeof pin === 'string' && stored !== null && verifyPin(pin, stored);
  });

  ipcMain.handle(IPC.saveOverlay, (_e, templateId: unknown, png: ArrayBuffer) => {
    writeFileSync(overlayFile(overlayDir, templateId), Buffer.from(png));
  });

  // PB_FAKE_PRINT=1 (e2e): never touch a real printer; just count the calls.
  const fakePrint = process.env.PB_FAKE_PRINT === '1';
  let fakePrintCalls = 0;

  ipcMain.handle(IPC.print, async (_e, jpeg: unknown, copies: unknown) => {
    const bytes = validatePrintRequest(jpeg, copies);
    if (fakePrint) {
      fakePrintCalls += 1;
      // PB_FAKE_PRINT_FAIL=<reason> (e2e) simulates a printer failure.
      const failReason = process.env.PB_FAKE_PRINT_FAIL;
      return failReason ? { ok: false, reason: failReason } : { ok: true };
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
