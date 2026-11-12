import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createJsonStore, MAX_CORRUPT_BACKUPS } from '../src/main/json-store';

interface Doc {
  a: number;
  b: string | null;
}

const isDoc = (v: unknown): v is Doc =>
  typeof v === 'object' && v !== null && typeof (v as Doc).a === 'number' && ((v as Doc).b === null || typeof (v as Doc).b === 'string');

describe('createJsonStore', () => {
  let dir: string;
  let file: string;
  let consoleError: MockInstance<typeof console.error>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pb-store-'));
    file = join(dir, 'nested', 'config.json');
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  const backups = (): string[] => readdirSync(join(dir, 'nested')).filter((f) => f.startsWith('config.json.corrupt-')).sort();

  it('returns defaults, persists updates, survives reopen', () => {
    const store = createJsonStore<Doc>(file, { a: 1, b: null });
    expect(store.get()).toEqual({ a: 1, b: null });
    expect(store.recoveredFromCorruption).toBe(false);
    expect(store.update((d) => ({ ...d, a: 2 }))).toEqual({ a: 2, b: null });
    expect(store.get()).toEqual({ a: 2, b: null });

    const reopened = createJsonStore<Doc>(file, { a: 1, b: null });
    expect(reopened.get()).toEqual({ a: 2, b: null });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 2, b: null });
    expect(readdirSync(join(dir, 'nested'))).toEqual(['config.json']);
  });

  it('fills fields missing from an older file with defaults', () => {
    createJsonStore<{ a: number }>(file, { a: 5 }).update(() => ({ a: 6 }));
    expect(createJsonStore<Doc>(file, { a: 1, b: 'x' }).get()).toEqual({ a: 6, b: 'x' });
  });

  it('ignores a leftover .tmp file and keeps last good data', () => {
    createJsonStore<Doc>(file, { a: 1, b: null }).update((d) => ({ ...d, b: 'good' }));
    writeFileSync(`${file}.tmp`, '{ garbage');
    const reopened = createJsonStore<Doc>(file, { a: 1, b: null });
    expect(reopened.get()).toEqual({ a: 1, b: 'good' });
    expect(reopened.recoveredFromCorruption).toBe(false);
    reopened.update((d) => ({ ...d, a: 3 }));
    expect(createJsonStore<Doc>(file, { a: 1, b: null }).get()).toEqual({ a: 3, b: 'good' });
    expect(backups()).toEqual([]);
  });

  it('a missing file is not corruption', () => {
    const store = createJsonStore<Doc>(file, { a: 1, b: null });
    expect(store.recoveredFromCorruption).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('moves a corrupt file aside, logs, and falls back to defaults', () => {
    createJsonStore<Doc>(file, { a: 1, b: null }).update((d) => ({ ...d, a: 9 }));
    writeFileSync(file, 'not json');
    const store = createJsonStore<Doc>(file, { a: 1, b: null }, { now: () => 1234 });
    expect(store.get()).toEqual({ a: 1, b: null });
    expect(store.recoveredFromCorruption).toBe(true);
    expect(backups()).toEqual(['config.json.corrupt-1234']);
    expect(readFileSync(join(dir, 'nested', 'config.json.corrupt-1234'), 'utf8')).toBe('not json');
    expect(consoleError).toHaveBeenCalledWith('json-store: config.json is unreadable or invalid; moved it aside and reset to defaults');
    // The evidence survives the next write.
    store.update((d) => ({ ...d, a: 2 }));
    expect(readFileSync(join(dir, 'nested', 'config.json.corrupt-1234'), 'utf8')).toBe('not json');
  });

  it('treats non-object JSON as corrupt', () => {
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(file, '[1,2]');
    const store = createJsonStore<Doc>(file, { a: 1, b: null }, { now: () => 5 });
    expect(store.get()).toEqual({ a: 1, b: null });
    expect(backups()).toEqual(['config.json.corrupt-5']);
  });

  it('treats a file that fails validation as corrupt', () => {
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(file, JSON.stringify({ a: 'wrong', b: null }));
    const store = createJsonStore<Doc>(file, { a: 1, b: null }, { validate: isDoc, now: () => 7 });
    expect(store.get()).toEqual({ a: 1, b: null });
    expect(store.recoveredFromCorruption).toBe(true);
    expect(backups()).toEqual(['config.json.corrupt-7']);
  });

  it('validates the file merged over defaults (older partial files still load)', () => {
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(file, JSON.stringify({ a: 4 }));
    const store = createJsonStore<Doc>(file, { a: 1, b: null }, { validate: isDoc });
    expect(store.get()).toEqual({ a: 4, b: null });
    expect(store.recoveredFromCorruption).toBe(false);
  });

  it(`keeps at most ${MAX_CORRUPT_BACKUPS} backups, dropping the oldest`, () => {
    mkdirSync(join(dir, 'nested'), { recursive: true });
    for (const t of [100, 200, 300, 400, 500]) {
      writeFileSync(file, `bad ${t}`);
      createJsonStore<Doc>(file, { a: 1, b: null }, { now: () => t });
    }
    expect(MAX_CORRUPT_BACKUPS).toBe(3);
    expect(backups()).toEqual(['config.json.corrupt-300', 'config.json.corrupt-400', 'config.json.corrupt-500']);
    expect(readFileSync(join(dir, 'nested', 'config.json.corrupt-500'), 'utf8')).toBe('bad 500');
  });

  it('a directory in place of the file is moved aside too', () => {
    mkdirSync(file, { recursive: true });
    const store = createJsonStore<Doc>(file, { a: 1, b: null }, { now: () => 9 });
    expect(store.get()).toEqual({ a: 1, b: null });
    expect(backups()).toEqual(['config.json.corrupt-9']);
    store.update((d) => ({ ...d, a: 2 }));
    expect(createJsonStore<Doc>(file, { a: 1, b: null }).get()).toEqual({ a: 2, b: null });
  });
});
