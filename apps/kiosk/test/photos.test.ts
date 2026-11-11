import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PHOTO_RETENTION_MS,
  photoPath,
  resolvePhotoReadPath,
  selectPhotosToDelete,
  validateJpeg,
} from '../src/main/photos';

const dir = resolve('/data/photos');
const ID = '0b3f6a52-6c1e-4d5e-9a0b-1c2d3e4f5a6b';

describe('photoPath', () => {
  it('maps a UUID session id to <dir>/<id>.jpg', () => {
    expect(photoPath(dir, ID)).toBe(join(dir, `${ID}.jpg`));
  });
  it.each(['', '../evil', '..', 'a/b', 'x'.repeat(37), `${ID}/..`, 'not-a-uuid', 7, null, undefined])(
    'rejects session id %s',
    (id) => {
      expect(() => photoPath(dir, id)).toThrow(/session id/i);
    },
  );
});

describe('resolvePhotoReadPath', () => {
  it('accepts a jpg directly inside the photos dir', () => {
    expect(resolvePhotoReadPath(dir, join(dir, `${ID}.jpg`))).toBe(join(dir, `${ID}.jpg`));
  });
  it.each([
    join(dir, '..', 'config.json'),
    `${dir}/../photos/${ID}.jpg`,
    join(dir, 'sub', `${ID}.jpg`),
    join(dir, `${ID}.png`),
    `${dir}-other/${ID}.jpg`,
    dir,
    '/etc/passwd',
    `${ID}.jpg`,
    '',
    42,
    null,
  ])('rejects %s', (p) => {
    expect(() => resolvePhotoReadPath(dir, p)).toThrow(/photo path/i);
  });
});

describe('validateJpeg', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
  it('accepts JPEG ArrayBuffer and Uint8Array', () => {
    expect(validateJpeg(jpeg.buffer.slice(0)).byteLength).toBe(5);
    expect(validateJpeg(jpeg).byteLength).toBe(5);
  });
  it('rejects non-buffers, empty, non-JPEG and > 20 MB', () => {
    expect(() => validateJpeg('x')).toThrow(/jpeg/i);
    expect(() => validateJpeg(new Uint8Array(0))).toThrow(/jpeg/i);
    expect(() => validateJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(/jpeg/i);
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(() => validateJpeg(big)).toThrow(/too large/);
  });
});

describe('selectPhotosToDelete', () => {
  const DAY = 24 * 60 * 60 * 1000;
  it('retention is 7 days', () => expect(PHOTO_RETENTION_MS).toBe(7 * DAY));
  it('selects uploads completed 7 or more days ago', () => {
    const now = 100 * DAY;
    const old = { sessionId: 'a', filePath: '/p/a.jpg', completedAt: now - 7 * DAY };
    const older = { sessionId: 'b', filePath: '/p/b.jpg', completedAt: now - 30 * DAY };
    const fresh = { sessionId: 'c', filePath: '/p/c.jpg', completedAt: now - 7 * DAY + 1 };
    expect(selectPhotosToDelete(now, [old, fresh, older])).toEqual([old, older]);
    expect(selectPhotosToDelete(now, [])).toEqual([]);
  });
});
