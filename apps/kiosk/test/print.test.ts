import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPrintHtml, printOptions, printSheet, validatePrintRequest, type PrintWindow } from '../src/main/print';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('printOptions / buildPrintHtml', () => {
  it('printOptions is borderless 4x6 with copies and printer', () => {
    expect(printOptions(2, 'DNP DS-RX1')).toEqual({
      silent: true,
      printBackground: true,
      copies: 2,
      deviceName: 'DNP DS-RX1',
      margins: { marginType: 'none' },
      pageSize: { width: 101600, height: 152400 },
      landscape: false,
    });
    expect(printOptions(1, null)).not.toHaveProperty('deviceName');
  });

  it('buildPrintHtml sizes the page and image to 4x6', () => {
    const html = buildPrintHtml('data:image/jpeg;base64,AAA');
    expect(html).toContain('@page { size: 4in 6in; margin: 0 }');
    expect(html).toContain('src="data:image/jpeg;base64,AAA"');
    expect(html).toContain('width:4in;height:6in;display:block');
  });
});

describe('validatePrintRequest', () => {
  it('accepts a JPEG ArrayBuffer or Uint8Array and 1..4 copies', () => {
    expect(validatePrintRequest(JPEG.buffer.slice(0), 1).byteLength).toBe(JPEG.byteLength);
    expect(validatePrintRequest(JPEG, 4).byteLength).toBe(JPEG.byteLength);
  });
  it.each([0, 5, 1.5, -1, NaN, '2' as unknown as number])('rejects copies %s', (c) => {
    expect(() => validatePrintRequest(JPEG, c)).toThrow(/copies/);
  });
  it('rejects non-buffers, empty, non-JPEG and oversize data', () => {
    expect(() => validatePrintRequest('x', 1)).toThrow(/jpeg/i);
    expect(() => validatePrintRequest(null, 1)).toThrow(/jpeg/i);
    expect(() => validatePrintRequest(new Uint8Array(0), 1)).toThrow(/jpeg/i);
    expect(() => validatePrintRequest(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 1)).toThrow(/jpeg/i);
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(() => validatePrintRequest(big, 1)).toThrow(/large|size/i);
  });
});

describe('printSheet', () => {
  afterEach(() => vi.useRealTimers());

  function setup(behavior: 'ok' | 'fail' | 'hang', loadError?: Error) {
    const close = vi.fn();
    const print = vi.fn((_o: unknown, cb: (ok: boolean, reason: string) => void) => {
      if (behavior === 'ok') cb(true, '');
      if (behavior === 'fail') cb(false, 'Printer offline');
    });
    const loadFile = vi.fn(async (_p: string) => {
      if (loadError) throw loadError;
    });
    const win: PrintWindow = { loadFile, webContents: { print }, close };
    const written: { path: string; html: string }[] = [];
    const removeFile = vi.fn(async (_p: string) => {});
    const deps = {
      createWindow: () => win,
      writeTempHtml: async (html: string) => {
        const path = `/tmp/pb-print-${written.length}.html`;
        written.push({ path, html });
        return path;
      },
      removeFile,
    };
    return { deps, close, print, loadFile, written, removeFile };
  }

  it('prints with the options, closes the window and removes the temp file on success', async () => {
    const s = setup('ok');
    await expect(printSheet(Buffer.from(JPEG), 2, 'P1', s.deps)).resolves.toEqual({ ok: true });
    expect(s.print.mock.calls[0]?.[0]).toEqual(printOptions(2, 'P1'));
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(s.removeFile).toHaveBeenCalledWith(s.written[0]?.path);
  });

  it('maps a print failure to its reason, closes and removes the temp file', async () => {
    const s = setup('fail');
    await expect(printSheet(Buffer.from(JPEG), 1, null, s.deps)).resolves.toEqual({
      ok: false,
      reason: 'Printer offline',
    });
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(s.removeFile).toHaveBeenCalledWith(s.written[0]?.path);
  });

  it('times out after 60 s, closes and removes the temp file', async () => {
    vi.useFakeTimers();
    const s = setup('hang');
    const p = printSheet(Buffer.from(JPEG), 1, null, s.deps);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(s.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(p).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(s.removeFile).toHaveBeenCalledWith(s.written[0]?.path);
  });

  it('maps a load error to a failure, closes and removes the temp file', async () => {
    const s = setup('ok', new Error('load failed'));
    await expect(printSheet(Buffer.from(JPEG), 1, null, s.deps)).resolves.toEqual({
      ok: false,
      reason: 'load failed',
    });
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(s.removeFile).toHaveBeenCalledWith(s.written[0]?.path);
  });

  it('does not mask the result when close throws', async () => {
    const s = setup('ok');
    s.close.mockImplementation(() => {
      throw new Error('already destroyed');
    });
    await expect(printSheet(Buffer.from(JPEG), 1, null, s.deps)).resolves.toEqual({ ok: true });
    expect(s.removeFile).toHaveBeenCalled();
  });

  it('loads a ~3 MB sheet from a temp file, never a data: URL', async () => {
    const s = setup('ok');
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    big.set([0xff, 0xd8, 0xff]);
    await printSheet(big, 1, null, s.deps);
    expect(s.loadFile).toHaveBeenCalledWith(s.written[0]?.path);
    expect(s.loadFile.mock.calls[0]?.[0]).not.toMatch(/^data:/);
    expect(s.written[0]?.html).toContain(`src="data:image/jpeg;base64,${big.toString('base64').slice(0, 16)}`);
  });
});
