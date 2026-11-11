import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonStore } from '../src/main/json-store';

interface Doc {
  a: number;
  b: string | null;
}

describe('createJsonStore', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pb-store-'));
    file = join(dir, 'nested', 'config.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns defaults, persists updates, survives reopen', () => {
    const store = createJsonStore<Doc>(file, { a: 1, b: null });
    expect(store.get()).toEqual({ a: 1, b: null });
    expect(store.update((d) => ({ ...d, a: 2 }))).toEqual({ a: 2, b: null });
    expect(store.get()).toEqual({ a: 2, b: null });

    const reopened = createJsonStore<Doc>(file, { a: 1, b: null });
    expect(reopened.get()).toEqual({ a: 2, b: null });
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
    reopened.update((d) => ({ ...d, a: 3 }));
    expect(createJsonStore<Doc>(file, { a: 1, b: null }).get()).toEqual({ a: 3, b: 'good' });
  });

  it('falls back to defaults when the main file is unreadable', () => {
    createJsonStore<Doc>(file, { a: 1, b: null }).update((d) => ({ ...d, a: 9 }));
    writeFileSync(file, 'not json');
    expect(createJsonStore<Doc>(file, { a: 1, b: null }).get()).toEqual({ a: 1, b: null });
  });
});
