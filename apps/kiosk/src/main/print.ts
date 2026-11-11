import type { WebContentsPrintOptions } from 'electron';

export type PrintResult = { ok: true } | { ok: false; reason: string };

export const PRINT_TIMEOUT_MS = 60_000;
export const MAX_JPEG_BYTES = 20 * 1024 * 1024;

/** The slice of a hidden BrowserWindow that `printSheet` uses (injectable for tests). */
export interface PrintWindow {
  loadURL(url: string): Promise<void>;
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

/** Prints a 4x6 JPEG silently. Always closes its window; resolves `reason: 'timeout'` after 60 s. */
export async function printSheet(
  jpeg: Buffer,
  copies: number,
  deviceName: string | null,
  createWindow: () => PrintWindow | Promise<PrintWindow> = createHiddenWindow,
): Promise<PrintResult> {
  const win = await createWindow();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const html = buildPrintHtml(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
    const printed = (async (): Promise<PrintResult> => {
      await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
      return new Promise<PrintResult>((resolve) => {
        win.webContents.print(printOptions(copies, deviceName), (success, failureReason) =>
          resolve(success ? { ok: true } : { ok: false, reason: failureReason || 'print failed' }),
        );
      });
    })();
    const timeout = new Promise<PrintResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), PRINT_TIMEOUT_MS);
    });
    return await Promise.race([printed, timeout]);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    win.close();
  }
}

export async function listPrinters(): Promise<string[]> {
  const { BrowserWindow } = await import('electron');
  const wc = BrowserWindow.getAllWindows()[0]?.webContents;
  if (!wc) return [];
  return (await wc.getPrintersAsync()).map((p) => p.name);
}
