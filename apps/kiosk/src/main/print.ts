import type { WebContentsPrintOptions } from 'electron';

export type PrintResult = { ok: true } | { ok: false; reason: string };

export const PRINT_TIMEOUT_MS = 60_000;
export const MAX_JPEG_BYTES = 20 * 1024 * 1024;

/** The slice of a hidden BrowserWindow that `printSheet` uses (injectable for tests). */
export interface PrintWindow {
  loadFile(path: string): Promise<void>;
  webContents: {
    print(options: WebContentsPrintOptions, callback: (success: boolean, failureReason: string) => void): void;
  };
  close(): void;
}

export function printOptions(copies: number, deviceName: string | null): WebContentsPrintOptions {
  return {
    silent: true,
    printBackground: true,
    copies,
    margins: { marginType: 'none' },
    pageSize: { width: 101600, height: 152400 },
    landscape: false,
    ...(deviceName !== null ? { deviceName } : {}),
  };
}

export function buildPrintHtml(jpegDataUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 4in 6in; margin: 0 }
html,body{margin:0;padding:0;background:#fff}
img{width:4in;height:6in;display:block}
</style></head><body><img src="${jpegDataUrl}"></body></html>`;
}

/** Validates untrusted IPC input. Returns the JPEG bytes or throws a clear error (nothing is printed). */
export function validatePrintRequest(jpeg: unknown, copies: unknown): Buffer {
  if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > 4) {
    throw new Error('copies must be an integer from 1 to 4');
  }
  let bytes: Uint8Array;
  if (jpeg instanceof ArrayBuffer) bytes = new Uint8Array(jpeg);
  else if (jpeg instanceof Uint8Array) bytes = jpeg;
  else throw new Error('jpeg must be an ArrayBuffer');
  if (bytes.byteLength === 0) throw new Error('jpeg is empty');
  if (bytes.byteLength > MAX_JPEG_BYTES) throw new Error('jpeg is too large (max 20 MB)');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('jpeg is not a JPEG image');
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function createHiddenWindow(): Promise<PrintWindow> {
  const { BrowserWindow } = await import('electron');
  return new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
}

export interface PrintDeps {
  createWindow: () => PrintWindow | Promise<PrintWindow>;
  /** Writes the HTML to a unique temp file and returns its path. */
  writeTempHtml: (html: string) => Promise<string>;
  removeFile: (path: string) => Promise<void>;
}

const defaultDeps: PrintDeps = {
  createWindow: createHiddenWindow,
  async writeTempHtml(html) {
    const { writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { randomUUID } = await import('node:crypto');
    const path = join(tmpdir(), `pb-print-${randomUUID()}.html`);
    await writeFile(path, html);
    return path;
  },
  async removeFile(path) {
    const { rm } = await import('node:fs/promises');
    await rm(path, { force: true });
  },
};

/**
 * Prints a 4x6 JPEG silently. The HTML is loaded from a temp file (a data: URL would exceed Chromium's
 * ~2 MB navigation URL cap for real photo sheets). Always closes its window and removes the temp file;
 * resolves `reason: 'timeout'` after 60 s.
 */
export async function printSheet(
  jpeg: Buffer,
  copies: number,
  deviceName: string | null,
  deps: Partial<PrintDeps> = {},
): Promise<PrintResult> {
  const { createWindow, writeTempHtml, removeFile } = { ...defaultDeps, ...deps };
  const win = await createWindow();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let file: string | undefined;
  try {
    const html = buildPrintHtml(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
    const printed = (async (): Promise<PrintResult> => {
      file = await writeTempHtml(html);
      await win.loadFile(file);
      return new Promise<PrintResult>((resolve) => {
        win.webContents.print(printOptions(copies, deviceName), (success, failureReason) =>
          resolve(success ? { ok: true } : { ok: false, reason: failureReason || 'print failed' }),
        );
      });
    })();
    // After a timeout `printed` may still settle (e.g. reject once the window is closed).
    printed.catch(() => {});
    const timeout = new Promise<PrintResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), PRINT_TIMEOUT_MS);
    });
    return await Promise.race([printed, timeout]);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    try {
      win.close();
    } catch {
      // A failing close must not mask the print result.
    }
    if (file !== undefined) await removeFile(file).catch(() => {});
  }
}

/** Printer names as seen by the given window (the IPC sender). */
export async function listPrinters(wc: { getPrintersAsync(): Promise<{ name: string }[]> }): Promise<string[]> {
  return (await wc.getPrintersAsync()).map((p) => p.name);
}
