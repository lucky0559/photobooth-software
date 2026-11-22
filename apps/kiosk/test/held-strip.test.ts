import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  createHeldStripApi,
  EMPTY_HELD_STRIP,
  normalizeHeldStripFile,
  type HeldStripFile,
} from '../src/main/held-strip';
import { createJsonStore } from '../src/main/json-store';

const SID = '0b3f6a52-6c1e-4d5e-9a0b-1c2d3e4f5a6b';
const SID2 = '1b3f6a52-6c1e-4d5e-9a0b-1c2d3e4f5a6b';

describe('held strip store', () => {
  let dir: string;
  let consoleError: MockInstance<typeof console.error>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pb-held-strip-'));
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  const photosDir = (): string => join(dir, 'photos');
  const file = (): string => join(dir, 'held-strip.json');
  const rec = () => ({ sessionId: SID, filePath: join(photosDir(), SID + '.jpg'), heldAt: 1000 });
  const open = (fs?: Parameters<typeof createJsonStore>[2] extends infer O ? (O extends { fs?: infer F } ? F : never) : never) =>
    createHeldStripApi(
      createJsonStore<HeldStripFile>(file(), EMPTY_HELD_STRIP, {
        normalize: normalizeHeldStripFile(photosDir()),
        sleep: () => {},
        fs,
      }),
      photosDir(),
    );
  const onDisk = (): unknown => JSON.parse(readFileSync(file(), 'utf8'));

  it('is dormant: a fresh store reads null and writes nothing', () => {
    const api = open();
    expect(api.get()).toBeNull();
    expect(api.claim()).toBeNull();
    expect(existsSync(file())).toBe(false);
  });

  it('holds a strip and persists it', () => {
    const api = open();
    api.hold(rec());
    expect(api.get()).toEqual(rec());
    expect(onDisk()).toEqual({ held: rec() });
  });

  it('survives a restart', () => {
    open().hold(rec());
    expect(open().get()).toEqual(rec());
  });

  it('claims once and clears the file', () => {
    const api = open();
    api.hold(rec());
    expect(api.claim()).toEqual(rec());
    expect(api.claim()).toBeNull();
    expect(api.get()).toBeNull();
    expect(onDisk()).toEqual({ held: null });
  });

  it('rejects a different session while one is held', () => {
    const api = open();
    api.hold(rec());
    expect(() => api.hold({ ...rec(), sessionId: SID2, filePath: join(photosDir(), SID2 + '.jpg') })).toThrow(
      'A strip is already held',
    );
    expect(api.get()).toEqual(rec());
  });

  it('treats a repeat hold for the same session as a no-op', () => {
    const api = open();
    api.hold(rec());
    expect(() => api.hold({ ...rec(), heldAt: 5000 })).not.toThrow();
    expect(api.get()?.heldAt).toBe(1000);
  });

  it.each<[string, () => unknown]>([
    ['null', () => null],
    ['array', () => []],
    ['string', () => 'x'],
    ['bad session id', () => ({ ...rec(), sessionId: 'abc' })],
    ['path outside photos', () => ({ ...rec(), filePath: '/etc/passwd.jpg' })],
    ['relative path', () => ({ ...rec(), filePath: 'photos/a.jpg' })],
    ['dot-dot segment', () => ({ ...rec(), filePath: photosDir() + '/../x.jpg' })],
    ['NaN time', () => ({ ...rec(), heldAt: Number.NaN })],
    ['Infinity time', () => ({ ...rec(), heldAt: Infinity })],
    ['string time', () => ({ ...rec(), heldAt: '1000' })],
  ])('rejects invalid input (%s) without writing', (_n, make) => {
    const api = open();
    expect(() => api.hold(make())).toThrow('Invalid held strip');
    expect(existsSync(file())).toBe(false);
  });

  it('moves aside a tampered file and never returns its strip', () => {
    writeFileSync(file(), JSON.stringify({ held: { ...rec(), filePath: join(dir, 'elsewhere.jpg') } }));
    expect(open().get()).toBeNull();
  });

  it('hands nothing out when the clear could not be saved', () => {
    open().hold(rec());
    const failing = open({
      renameSync: () => {
        throw new Error('EPERM');
      },
    });
    expect(() => failing.claim()).toThrow();
    expect(open().get()).toEqual(rec());
  });
});
