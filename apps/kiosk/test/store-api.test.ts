import * as realFs from 'node:fs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { normalizeLocalConfig } from '../src/main/config-validation';
import { createJsonStore } from '../src/main/json-store';
import { EMPTY_QUEUE, normalizeQueueFile, type QueueFile } from '../src/main/queue-store';
import { flagDroppedUploads } from '../src/main/startup';
import { createStoreApi } from '../src/main/store-api';
import { DEFAULT_LOCAL_CONFIG, type LocalConfig } from '../src/shared/bridge';

const SID = '0b3f6a52-6c1e-4d5e-9a0b-1c2d3e4f5a6b';
const SID2 = '1b3f6a52-6c1e-4d5e-9a0b-1c2d3e4f5a6b';
const J1 = '11111111-1111-4111-8111-111111111111';
const J2 = '22222222-2222-4222-8222-222222222222';

describe('createStoreApi: queue.json health', () => {
  let dir: string;
  let consoleError: MockInstance<typeof console.error>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pb-store-api-'));
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  const photosDir = (): string => join(dir, 'photos');
  const queueFile = (): string => join(dir, 'queue.json');
  const job = (id: string, sessionId: string) => ({
    id,
    kind: 'upload_photo' as const,
    sessionId,
    filePath: join(photosDir(), `${sessionId}.jpg`),
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
  });

  /** queue.json reads fail with EBUSY while `lock.on` (an antivirus or backup lock). */
  function open() {
    const lock = { on: true };
    const readFileSync = ((p: string, enc: BufferEncoding) => {
      if (lock.on && p === queueFile()) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return realFs.readFileSync(p, enc);
    }) as typeof realFs.readFileSync;
    const config = createJsonStore<LocalConfig>(join(dir, 'config.json'), DEFAULT_LOCAL_CONFIG, { normalize: normalizeLocalConfig });
    const queue = createJsonStore<QueueFile>(queueFile(), EMPTY_QUEUE, {
      normalize: normalizeQueueFile(photosDir()),
      sleep: () => {},
      fs: { readFileSync },
      onRecovered: () => flagDroppedUploads(config, queue),
    });
    return { lock, config, queue, api: createStoreApi(config, queue, photosDir()) };
  }

  it('still unreadable: queueAdd throws and getConfig reports queueUnavailable', () => {
    writeFileSync(queueFile(), JSON.stringify({ jobs: [job(J1, SID)], completedUploads: [] }));
    const { api } = open();
    expect(() => api.queueAdd([job(J2, SID2)])).toThrow('not saving');
    expect(api.getConfig().queueUnavailable).toBe(true);
    expect(api.queueList()).toEqual([]);
    expect(JSON.parse(readFileSync(queueFile(), 'utf8')).jobs).toHaveLength(1);
  });

  it('queueList self-heals once the file is readable, and the kiosk is back in service', () => {
    writeFileSync(queueFile(), JSON.stringify({ jobs: [job(J1, SID)], completedUploads: [] }));
    const { api, lock } = open();
    expect(api.getConfig().queueUnavailable).toBe(true);
    lock.on = false;
    expect(api.queueList()).toEqual([job(J1, SID)]);
    expect(api.getConfig().queueUnavailable).toBe(false);
  });

  it('the next queueAdd heals and appends to the file that was there (nothing lost)', () => {
    writeFileSync(queueFile(), JSON.stringify({ jobs: [job(J1, SID)], completedUploads: [] }));
    const { api, lock } = open();
    lock.on = false;
    api.queueAdd([job(J2, SID2)]);
    expect(JSON.parse(readFileSync(queueFile(), 'utf8')).jobs.map((j: { id: string }) => j.id)).toEqual([J1, J2]);
  });

  it('entries dropped when healing raise the Setup notice', () => {
    writeFileSync(queueFile(), JSON.stringify({ jobs: [job(J1, SID), { id: 'broken' }], completedUploads: [] }));
    const { api, lock, config } = open();
    lock.on = false;
    expect(api.queueList()).toEqual([job(J1, SID)]);
    expect(config.get().uploadsDropped).toBe(true);
  });

  it('queueUnavailable is never written to config.json', () => {
    writeFileSync(queueFile(), JSON.stringify(EMPTY_QUEUE));
    const { api } = open();
    expect(api.setConfig({ printerName: 'P' })).toMatchObject({ printerName: 'P', queueUnavailable: true });
    const onDisk = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as Record<string, unknown>;
    expect(onDisk.printerName).toBe('P');
    expect(onDisk).not.toHaveProperty('queueUnavailable');
    expect(onDisk).not.toHaveProperty('settingsUnreadable');
    expect(onDisk).not.toHaveProperty('pinSet');
  });
});
