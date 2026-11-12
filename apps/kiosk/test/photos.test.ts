import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findOrphanPhotos,
  listPhotoFiles,
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

describe('findOrphanPhotos', () => {
  const HOUR = 60 * 60 * 1000;
  const now = 10 * HOUR;
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';
  const C = '00000000-0000-4000-8000-00000000000c';
  const D = '00000000-0000-4000-8000-00000000000d';
  const job = (sessionId: string) => ({
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'upload_photo' as const,
    sessionId,
    filePath: join(dir, `${sessionId}.jpg`),
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
  });

  it('counts old photos with no pending upload job and no completed upload', () => {
    const files = [
      { name: `${A}.jpg`, mtimeMs: now - 2 * HOUR }, // pending upload job
      { name: `${B}.jpg`, mtimeMs: now - 2 * HOUR }, // already uploaded
      { name: `${C}.jpg`, mtimeMs: now - 2 * HOUR }, // orphan
      { name: `${D}.jpg`, mtimeMs: now - HOUR + 1 }, // too recent: a session may still be in flight
      { name: `${D}.jpg.tmp`, mtimeMs: 0 }, // not a photo
      { name: 'notes.txt', mtimeMs: 0 },
    ];
    const queue = {
      jobs: [job(A)],
      completedUploads: [{ sessionId: B, filePath: join(dir, `${B}.jpg`), completedAt: now }],
    };
    expect(findOrphanPhotos(files, queue, now)).toEqual([`${C}.jpg`]);
  });

  it('treats a photo exactly 1 hour old as old enough', () => {
    expect(findOrphanPhotos([{ name: `${C}.jpg`, mtimeMs: now - HOUR }], { jobs: [], completedUploads: [] }, now)).toEqual([
      `${C}.jpg`,
    ]);
  });
});

describe('listPhotoFiles', () => {
  it('skips a file that vanishes between readdir and stat instead of failing the sweep', () => {
    const fs = {
      readdirSync: () => ['a.jpg', 'gone.jpg', 'b.jpg'],
      statSync: (p: string) => {
        if (p.endsWith('gone.jpg')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return { mtimeMs: p.endsWith('a.jpg') ? 1 : 2 };
      },
    };
    expect(listPhotoFiles(dir, fs)).toEqual([
      { name: 'a.jpg', mtimeMs: 1 },
      { name: 'b.jpg', mtimeMs: 2 },
    ]);
  });

  it('returns nothing when the directory cannot be read', () => {
    const fs = {
      readdirSync: (): string[] => {
        throw new Error('ENOENT');
      },
      statSync: () => ({ mtimeMs: 0 }),
    };
    expect(listPhotoFiles(dir, fs)).toEqual([]);
  });
});
