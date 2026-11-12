import * as realFs from 'node:fs';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createJsonStore, MAX_CORRUPT_BACKUPS, writeAll, type Normalized } from '../src/main/json-store';

interface Doc {
  a: number;
  b: string | null;
  list: number[];
}

const DEFAULTS: Doc = { a: 1, b: null, list: [] };

/** Rejects a non-number `a`; drops non-number list entries. */
function normalizeDoc(v: unknown): Normalized<Doc> | null {
  const d = v as Doc;
  if (typeof d.a !== 'number' || !Array.isArray(d.list)) return null;
  const list = d.list.filter((n) => typeof n === 'number');
  return { value: { ...d, list }, dropped: d.list.length - list.length };
}

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('createJsonStore', () => {
  let dir: string;
  let file: string;
  let consoleError: MockInstance<typeof console.error>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pb-store-'));
    mkdirSync(join(dir, 'nested'));
    file = join(dir, 'nested', 'config.json');
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  const files = (prefix: string): string[] => readdirSync(join(dir, 'nested')).filter((f) => f.startsWith(prefix)).sort();
  const backups = (): string[] => files('config.json.corrupt-');

  it('returns defaults, persists updates, survives reopen', () => {
    const store = createJsonStore<Doc>(file, DEFAULTS);
    expect(store.get()).toEqual(DEFAULTS);
    expect(store).toMatchObject({ recoveredFromCorruption: false, droppedEntries: 0, writeBlocked: false });
    expect(store.update((d) => ({ ...d, a: 2 }))).toEqual({ ...DEFAULTS, a: 2 });
    expect(createJsonStore<Doc>(file, DEFAULTS).get()).toEqual({ ...DEFAULTS, a: 2 });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...DEFAULTS, a: 2 });
    expect(readdirSync(join(dir, 'nested'))).toEqual(['config.json']);
  });

  it('creates a missing directory', () => {
    const deep = join(dir, 'x', 'y', 'q.json');
    createJsonStore<Doc>(deep, DEFAULTS).update((d) => ({ ...d, a: 5 }));
    expect(createJsonStore<Doc>(deep, DEFAULTS).get().a).toBe(5);
  });

  it('fills fields missing from an older file with defaults', () => {
    writeFileSync(file, JSON.stringify({ a: 6 }));
    expect(createJsonStore<Doc>(file, { ...DEFAULTS, b: 'x' }, { normalize: normalizeDoc }).get()).toEqual({ a: 6, b: 'x', list: [] });
  });

  it('ignores a leftover .tmp file and keeps last good data', () => {
    createJsonStore<Doc>(file, DEFAULTS).update((d) => ({ ...d, b: 'good' }));
    writeFileSync(`${file}.tmp`, '{ garbage');
    const reopened = createJsonStore<Doc>(file, DEFAULTS);
    expect(reopened.get()).toEqual({ ...DEFAULTS, b: 'good' });
    expect(reopened.recoveredFromCorruption).toBe(false);
    reopened.update((d) => ({ ...d, a: 3 }));
    expect(createJsonStore<Doc>(file, DEFAULTS).get()).toEqual({ ...DEFAULTS, a: 3, b: 'good' });
    expect(backups()).toEqual([]);
  });

  it('a missing file is not corruption', () => {
    const store = createJsonStore<Doc>(file, DEFAULTS);
    expect(store.recoveredFromCorruption).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('moves an unparsable file aside, logs, and falls back to defaults', () => {
    writeFileSync(file, 'not json');
    const store = createJsonStore<Doc>(file, DEFAULTS, { now: () => 1234 });
    expect(store.get()).toEqual(DEFAULTS);
    expect(store.recoveredFromCorruption).toBe(true);
    expect(store.writeBlocked).toBe(false);
    expect(backups()).toEqual(['config.json.corrupt-1234']);
    expect(readFileSync(join(dir, 'nested', 'config.json.corrupt-1234'), 'utf8')).toBe('not json');
    expect(consoleError).toHaveBeenCalledWith('json-store: config.json is unreadable or invalid; moved it aside and reset to defaults');
    store.update((d) => ({ ...d, a: 2 }));
    expect(readFileSync(join(dir, 'nested', 'config.json.corrupt-1234'), 'utf8')).toBe('not json');
  });

  it('treats non-object JSON as corrupt', () => {
    writeFileSync(file, '[1,2]');
    const store = createJsonStore<Doc>(file, DEFAULTS, { now: () => 5 });
    expect(store.get()).toEqual(DEFAULTS);
    expect(backups()).toEqual(['config.json.corrupt-5']);
  });

  it('treats a file the normalizer rejects as corrupt', () => {
    writeFileSync(file, JSON.stringify({ a: 'wrong', b: null, list: [] }));
    const store = createJsonStore<Doc>(file, DEFAULTS, { normalize: normalizeDoc, now: () => 7 });
    expect(store.get()).toEqual(DEFAULTS);
    expect(store.recoveredFromCorruption).toBe(true);
    expect(backups()).toEqual(['config.json.corrupt-7']);
  });

  it('keeps valid entries, drops invalid ones, and keeps a .dropped copy of the original', () => {
    const original = JSON.stringify({ a: 4, b: null, list: [1, 'x', 2, null] });
    writeFileSync(file, original);
    const store = createJsonStore<Doc>(file, DEFAULTS, { normalize: normalizeDoc, now: () => 11 });
    expect(store.get()).toEqual({ a: 4, b: null, list: [1, 2] });
    expect(store).toMatchObject({ droppedEntries: 2, recoveredFromCorruption: false, writeBlocked: false });
    expect(files('config.json.dropped-')).toEqual(['config.json.dropped-11']);
    expect(readFileSync(join(dir, 'nested', 'config.json.dropped-11'), 'utf8')).toBe(original);
    expect(consoleError).toHaveBeenCalledWith('json-store: config.json: dropped 2 invalid entries (original kept as a .dropped copy)');
    expect(backups()).toEqual([]);
  });

  it(`keeps at most ${MAX_CORRUPT_BACKUPS} corrupt and ${MAX_CORRUPT_BACKUPS} dropped copies, dropping the oldest`, () => {
    for (const t of [100, 200, 300, 400, 500]) {
      writeFileSync(file, `bad ${t}`);
      createJsonStore<Doc>(file, DEFAULTS, { now: () => t });
      writeFileSync(file, JSON.stringify({ a: 1, list: ['x'] }));
      createJsonStore<Doc>(file, DEFAULTS, { normalize: normalizeDoc, now: () => t + 1 });
    }
    expect(MAX_CORRUPT_BACKUPS).toBe(3);
    expect(backups()).toEqual(['config.json.corrupt-300', 'config.json.corrupt-400', 'config.json.corrupt-500']);
    expect(files('config.json.dropped-')).toEqual(['config.json.dropped-301', 'config.json.dropped-401', 'config.json.dropped-501']);
  });

  it('a directory in place of the file is corrupt and moved aside', () => {
    rmSync(join(dir, 'nested'), { recursive: true });
    mkdirSync(file, { recursive: true });
    const store = createJsonStore<Doc>(file, DEFAULTS, { now: () => 9 });
    expect(store.get()).toEqual(DEFAULTS);
    expect(backups()).toEqual(['config.json.corrupt-9']);
    store.update((d) => ({ ...d, a: 2 }));
    expect(createJsonStore<Doc>(file, DEFAULTS).get()).toEqual({ ...DEFAULTS, a: 2 });
  });

  it('retries a transient read error once after 50 ms', () => {
    writeFileSync(file, JSON.stringify({ ...DEFAULTS, a: 8 }));
    let calls = 0;
    const sleep = vi.fn();
    const store = createJsonStore<Doc>(file, DEFAULTS, {
      sleep,
      fs: {
        readFileSync: ((p: string, enc: BufferEncoding) => {
          calls += 1;
          if (calls === 1) throw errnoError('EBUSY');
          return realFs.readFileSync(p, enc);
        }) as typeof realFs.readFileSync,
      },
    });
    expect(sleep).toHaveBeenCalledWith(50);
    expect(store.get().a).toBe(8);
    expect(store.writeBlocked).toBe(false);
  });

  it('on a persistent read error uses defaults for this run and never writes over the file', () => {
    writeFileSync(file, JSON.stringify({ ...DEFAULTS, a: 8, b: 'pin' }));
    const store = createJsonStore<Doc>(file, DEFAULTS, {
      sleep: () => {},
      fs: {
        readFileSync: (() => {
          throw errnoError('EPERM');
        }) as unknown as typeof realFs.readFileSync,
      },
    });
    expect(store.get()).toEqual(DEFAULTS);
    expect(store).toMatchObject({ writeBlocked: true, recoveredFromCorruption: false });
    expect(() => store.update((d) => ({ ...d, a: 2 }))).toThrow('not saving');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...DEFAULTS, a: 8, b: 'pin' });
    expect(backups()).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith('json-store: config.json could not be read; using defaults for this run without saving');
  });

  it('copies the bytes to the backup name when the rename fails', () => {
    writeFileSync(file, 'not json');
    const store = createJsonStore<Doc>(file, DEFAULTS, {
      now: () => 3,
      fs: {
        renameSync: ((from: string, to: string) => {
          if (to.includes('.corrupt-')) throw errnoError('EPERM');
          realFs.renameSync(from, to);
        }) as typeof realFs.renameSync,
      },
    });
    expect(store).toMatchObject({ recoveredFromCorruption: true, writeBlocked: false });
    expect(readFileSync(join(dir, 'nested', 'config.json.corrupt-3'), 'utf8')).toBe('not json');
  });

  it('never writes over a corrupt file it could not back up', () => {
    writeFileSync(file, 'not json');
    const store = createJsonStore<Doc>(file, DEFAULTS, {
      fs: {
        renameSync: ((from: string, to: string) => {
          if (to.includes('.corrupt-')) throw errnoError('EPERM');
          realFs.renameSync(from, to);
        }) as typeof realFs.renameSync,
        writeFileSync: ((p: string, data: string) => {
          if (p.includes('.corrupt-')) throw errnoError('ENOSPC');
          realFs.writeFileSync(p, data);
        }) as typeof realFs.writeFileSync,
      },
    });
    expect(store).toMatchObject({ writeBlocked: true, recoveredFromCorruption: false });
    expect(() => store.update((d) => d)).toThrow('not saving');
    expect(readFileSync(file, 'utf8')).toBe('not json');
  });
});

describe('writeAll', () => {
  it('loops until every byte is written (partial writes)', () => {
    const data = Buffer.from('0123456789');
    const chunks: string[] = [];
    const write = (_fd: number, buf: Buffer, off: number, len: number): number => {
      const n = Math.min(3, len);
      chunks.push(buf.subarray(off, off + n).toString());
      return n;
    };
    writeAll(7, data, write);
    expect(chunks).toEqual(['012', '345', '678', '9']);
  });

  it('fails instead of spinning when a write makes no progress', () => {
    expect(() => writeAll(7, Buffer.from('abc'), () => 0)).toThrow();
  });
});
