import { ipcMain } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC, PIN_PATTERN, TEMPLATE_ID_PATTERN, type LocalConfig } from '../shared/bridge';
import type { JsonStore } from './json-store';
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

export function registerIpc(store: JsonStore<LocalConfig>, overlayDir: string): void {
  mkdirSync(overlayDir, { recursive: true });

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

  ipcMain.handle(IPC.readOverlay, (_e, templateId: unknown) => {
    try {
      return toArrayBuffer(readFileSync(overlayFile(overlayDir, templateId)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  });
}
