import { ipcMain } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC, TEMPLATE_ID_PATTERN, type LocalConfig } from '../shared/bridge';
import type { TestSwitches } from '../shared/test-switches';
import { validateOverlayPng } from './config-validation';
import type { JsonStore } from './json-store';
import { photoPath, resolvePhotoReadPath, validateJpeg } from './photos';
import { createPinService } from './pin-service';
import type { QueueFile } from './queue-store';
import { listPrinters, printSheet, validatePrintRequest } from './print';
import { createStoreApi } from './store-api';

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

  const stores = createStoreApi(store, queue, photosDir);
  ipcMain.handle(IPC.getConfig, () => stores.getConfig());
  ipcMain.handle(IPC.setConfig, (_e, patch: unknown) => stores.setConfig(patch));

  const pins = createPinService(store);
  ipcMain.handle(IPC.setPin, (_e, pin: unknown, currentPin: unknown) => pins.set(pin, currentPin));
  ipcMain.handle(IPC.checkPin, (_e, pin: unknown) => pins.check(pin));

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

  ipcMain.handle(IPC.queueAdd, (_e, jobs: unknown) => stores.queueAdd(jobs));
  ipcMain.handle(IPC.queueList, () => stores.queueList());
  ipcMain.handle(IPC.queueApply, (_e, result: unknown) => stores.queueApply(result));

  ipcMain.handle(IPC.readOverlay, (_e, templateId: unknown) => {
    try {
      return toArrayBuffer(readFileSync(overlayFile(overlayDir, templateId)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  });
}
