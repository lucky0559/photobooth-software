import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { normalizeLocalConfig } from '../src/main/config-validation';
import { createJsonStore } from '../src/main/json-store';
import { EMPTY_QUEUE, normalizeQueueFile, type QueueFile } from '../src/main/queue-store';
import { applyStartupNotices } from '../src/main/startup';
import { DEFAULT_LOCAL_CONFIG, type LocalConfig } from '../src/shared/bridge';

const SID = '0b3f6a52-6c1e-4d5e-9a0b-1c2d3e4f5a6b';
const J1 = '11111111-1111-4111-8111-111111111111';

describe('queue.json + config.json on startup', () => {
  let dir: string;
  let consoleError: MockInstance<typeof console.error>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pb-startup-'));
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  const photosDir = (): string => join(dir, 'photos');
  const open = () => {
    const config = createJsonStore<LocalConfig>(join(dir, 'config.json'), DEFAULT_LOCAL_CONFIG, { normalize: normalizeLocalConfig });
    const queue = createJsonStore<QueueFile>(join(dir, 'queue.json'), EMPTY_QUEUE, { normalize: normalizeQueueFile(photosDir()) });
    applyStartupNotices(config, queue);
    return { config, queue };
  };
  const uploadJob = { id: J1, kind: 'upload_photo', sessionId: SID, filePath: '/old/place.jpg', attempts: 1, nextAttemptAt: 0, lastError: null };

  it('one malformed job: only it is dropped, the notice flag is set and the original is kept', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ pinHash: 'scrypt$a$b' }));
    const original = JSON.stringify({ jobs: [uploadJob, { id: 'bad' }], completedUploads: [] });
    writeFileSync(join(dir, 'queue.json'), original);
    const { config, queue } = open();
    expect(queue.get().jobs).toEqual([{ ...uploadJob, filePath: join(photosDir(), `${SID}.jpg`) }]);
    expect(config.get()).toMatchObject({ pinHash: 'scrypt$a$b', uploadsDropped: true });
    const copies = readdirSync(dir).filter((f) => f.startsWith('queue.json.dropped-'));
    expect(copies).toHaveLength(1);
    expect(readFileSync(join(dir, copies[0]), 'utf8')).toBe(original);
    // A queue write rewrites queue.json without the bad entry ...
    queue.update((q) => q);
    expect(JSON.parse(readFileSync(join(dir, 'queue.json'), 'utf8')).jobs).toHaveLength(1);
    // ... and the flag still survives the restart (it lives in config.json, not in the queue file).
    const reopened = open();
    expect(reopened.queue.droppedEntries).toBe(0);
    expect(reopened.config.get().uploadsDropped).toBe(true);
  });

  it('a queue.json from the previous build loads with everything kept (print error cut, paths re-derived)', () => {
    const DONE_SID = '2b3f6a52-6c1e-4d5e-9a0b-1c2d3e4f5a6b';
    const row = {
      id: SID,
      downloadToken: 'AbCdEfGhIjKlMnOpQrSt_-',
      templateId: 'fake-strip',
      amountCentavos: 15000,
      status: 'completed',
      printError: 'p'.repeat(800),
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:01:00.000Z',
    };
    const old = {
      jobs: [
        { id: J1, kind: 'upsert_session', row, attempts: 4, nextAttemptAt: 123, lastError: 'offline' },
        { ...uploadJob, id: '22222222-2222-4222-8222-222222222222', filePath: `C:\\Users\\booth\\AppData\\photos\\${SID}.jpg` },
      ],
      completedUploads: [{ sessionId: DONE_SID, filePath: `C:\\Users\\booth\\AppData\\photos\\${DONE_SID}.jpg`, completedAt: 99 }],
    };
    writeFileSync(join(dir, 'queue.json'), JSON.stringify(old));
    const { queue, config } = open();
    expect(queue.droppedEntries).toBe(0);
    const [upsert, upload] = queue.get().jobs;
    expect(upsert).toMatchObject({ id: J1, attempts: 4, nextAttemptAt: 123, lastError: 'offline' });
    const printError = (upsert as { row: { printError: string } }).row.printError;
    expect(printError.length).toBeLessThanOrEqual(500);
    expect(printError.endsWith('…')).toBe(true);
    expect(upload).toMatchObject({ kind: 'upload_photo', sessionId: SID, filePath: join(photosDir(), `${SID}.jpg`), attempts: 1 });
    expect(queue.get().completedUploads).toEqual([{ sessionId: DONE_SID, filePath: join(photosDir(), `${DONE_SID}.jpg`), completedAt: 99 }]);
    expect(config.get().uploadsDropped).toBe(false);
  });

  it('unparsable queue.json still takes the corrupt-backup path (no dropped notice)', () => {
    writeFileSync(join(dir, 'queue.json'), '{ "jobs": [');
    const { config, queue } = open();
    expect(queue.get()).toEqual(EMPTY_QUEUE);
    expect(queue.recoveredFromCorruption).toBe(true);
    expect(readdirSync(dir).filter((f) => f.startsWith('queue.json.corrupt-'))).toHaveLength(1);
    expect(config.get().uploadsDropped).toBe(false);
  });

  it('queue.json without the arrays is corrupt', () => {
    writeFileSync(join(dir, 'queue.json'), JSON.stringify({ jobs: 'nope' }));
    expect(open().queue.recoveredFromCorruption).toBe(true);
  });

  it('a too-long cached template name resets only the cache, keeping PIN, printer and camera', () => {
    const cfg = {
      pinHash: 'scrypt$a$b',
      printerName: 'DNP',
      cameraDeviceId: 'cam',
      cachedTemplate: { id: 't1', name: 'n'.repeat(61), layout: 'strip_2x6', overlayPath: 't1.png' },
    };
    writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
    const { config } = open();
    expect(config.get()).toMatchObject({ pinHash: 'scrypt$a$b', printerName: 'DNP', cameraDeviceId: 'cam', cachedTemplate: null });
    expect(config.recoveredFromCorruption).toBe(false);
    expect(config.get().recoveredFromCorruption).toBe(false);
  });

  it('a corrupt config sets the damaged-settings flag', () => {
    writeFileSync(join(dir, 'config.json'), '{ "pinHash": "scrypt$');
    expect(open().config.get()).toMatchObject({ pinHash: null, recoveredFromCorruption: true });
  });

  it('never throws when the flag cannot be saved', () => {
    const config = {
      ...createJsonStore<LocalConfig>(join(dir, 'config.json'), DEFAULT_LOCAL_CONFIG),
      recoveredFromCorruption: true,
      update: () => {
        throw new Error('ENOSPC');
      },
    };
    expect(() => applyStartupNotices(config, { droppedEntries: 1 })).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith('Saving startup notices failed', expect.any(Error));
  });
});
