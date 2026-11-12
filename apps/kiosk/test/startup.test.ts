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
    // Persisted: still flagged after a restart.
    expect(open().config.get().uploadsDropped).toBe(true);
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
