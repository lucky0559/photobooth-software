import type { SessionSync } from '@pb/core';
import { describe, expect, it, vi } from 'vitest';
import type { KioskApi } from '../src/renderer/src/api/kiosk-api';
import { nextAttemptAt, processQueue, startQueueRunner, type QueueJob } from '../src/renderer/src/sync/queue';

const row: SessionSync = {
  id: 's1',
  downloadToken: 'AAAAAAAAAAAAAAAAAAAAAA',
  templateId: 'fake-strip',
  amountCentavos: 0,
  status: 'free',
  printError: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:01:00.000Z',
};

const upsert = (over: Partial<QueueJob> = {}): QueueJob =>
  ({ id: 'j1', kind: 'upsert_session', row, attempts: 0, nextAttemptAt: 0, lastError: null, ...over }) as QueueJob;
const upload = (over: Partial<QueueJob> = {}): QueueJob =>
  ({
    id: 'j2',
    kind: 'upload_photo',
    sessionId: 's1',
    filePath: '/photos/s1.jpg',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    ...over,
  }) as QueueJob;

function fakeApi(over: Partial<Pick<KioskApi, 'upsertSession' | 'uploadPhoto'>> = {}) {
  return {
    upsertSession: vi.fn(async () => {}),
    uploadPhoto: vi.fn(async (id: string) => `${id}.jpg`),
    ...over,
  } as unknown as KioskApi & { upsertSession: ReturnType<typeof vi.fn>; uploadPhoto: ReturnType<typeof vi.fn> };
}

const readPhoto = vi.fn(async () => new ArrayBuffer(4));

describe('startQueueRunner', () => {
  it('a stopped runner does not apply the result of a run in flight', async () => {
    let release!: (jobs: QueueJob[]) => void;
    const bridge = {
      queueList: vi.fn(() => new Promise<QueueJob[]>((res) => (release = res))),
      queueApply: vi.fn(async () => {}),
      readPhoto,
    };
    const runner = startQueueRunner(fakeApi(), bridge, 60_000);
    runner.stop();
    release([upsert()]);
    await new Promise((r) => setTimeout(r, 10));
    expect(bridge.queueApply).not.toHaveBeenCalled();
    runner.kick();
    await new Promise((r) => setTimeout(r, 10));
    expect(bridge.queueList).toHaveBeenCalledTimes(1);
  });

  it('calls onListed after every queueList, even when it rejects (queue health re-check)', async () => {
    const onListed = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bridge = {
      queueList: vi.fn<() => Promise<QueueJob[]>>().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('ipc down')),
      queueApply: vi.fn(async () => {}),
      readPhoto,
    };
    const runner = startQueueRunner(fakeApi(), bridge, 60_000, onListed);
    await new Promise((r) => setTimeout(r, 10));
    expect(onListed).toHaveBeenCalledTimes(1);
    runner.kick();
    await new Promise((r) => setTimeout(r, 10));
    expect(onListed).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith('Sync queue run failed', expect.any(Error));
    runner.stop();
    consoleError.mockRestore();
  });
});

describe('nextAttemptAt', () => {
  it('backoff doubles from 5s and caps at 5 minutes', () => {
    expect(nextAttemptAt(0, 0)).toBe(5000);
    expect(nextAttemptAt(1, 0)).toBe(10_000);
    expect(nextAttemptAt(3, 0)).toBe(40_000);
    expect(nextAttemptAt(6, 0)).toBe(300_000);
    expect(nextAttemptAt(10, 0)).toBe(300_000);
    expect(nextAttemptAt(2, 1000)).toBe(21_000);
  });
});

describe('processQueue', () => {
  it('runs due jobs in order: upsert, then upload with the photo bytes', async () => {
    const api = fakeApi();
    const calls: string[] = [];
    api.upsertSession.mockImplementation(async () => void calls.push('upsert'));
    api.uploadPhoto.mockImplementation(async () => (calls.push('upload'), 's1.jpg'));
    const r = await processQueue([upsert(), upload()], { api, readPhoto, now: 100 });
    expect(r).toEqual({ done: ['j1', 'j2'], failed: [] });
    expect(calls).toEqual(['upsert', 'upload']);
    expect(api.upsertSession).toHaveBeenCalledWith(row);
    expect(readPhoto).toHaveBeenCalledWith('/photos/s1.jpg');
    expect(api.uploadPhoto).toHaveBeenCalledWith('s1', expect.any(ArrayBuffer));
  });

  it('uploads only after the session row synced', async () => {
    const api = fakeApi({ upsertSession: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const r = await processQueue([upsert(), upload()], { api, readPhoto, now: 100 });
    expect(api.uploadPhoto).not.toHaveBeenCalled();
    expect(r.done).toEqual([]);
    expect(r.failed.map((f) => f.id)).toEqual(['j1']);
  });

  it('does not upload while a not-yet-due upsert for the session is pending', async () => {
    const api = fakeApi();
    const r = await processQueue([upsert({ nextAttemptAt: 5000 }), upload()], { api, readPhoto, now: 100 });
    expect(api.upsertSession).not.toHaveBeenCalled();
    expect(api.uploadPhoto).not.toHaveBeenCalled();
    expect(r).toEqual({ done: [], failed: [] });
  });

  it('does not upload while a later upsert for the session is still queued', async () => {
    const api = fakeApi();
    const r = await processQueue([upload(), upsert({ id: 'j3' })], { api, readPhoto, now: 100 });
    // The upload is listed first, but its session row has not synced yet at that point.
    expect(api.uploadPhoto).not.toHaveBeenCalled();
    expect(r).toEqual({ done: ['j3'], failed: [] });
  });

  it('uploads for other sessions are not blocked', async () => {
    const api = fakeApi({ upsertSession: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const other = upload({ id: 'j9', sessionId: 's2', filePath: '/photos/s2.jpg' } as Partial<QueueJob>);
    const r = await processQueue([upsert(), other], { api, readPhoto, now: 100 });
    expect(r.done).toEqual(['j9']);
  });

  it('skips jobs not yet due', async () => {
    const api = fakeApi();
    const r = await processQueue([upload({ nextAttemptAt: 101 })], { api, readPhoto, now: 100 });
    expect(api.uploadPhoto).not.toHaveBeenCalled();
    expect(r).toEqual({ done: [], failed: [] });
    const due = await processQueue([upload({ nextAttemptAt: 100 })], { api, readPhoto, now: 100 });
    expect(due.done).toEqual(['j2']);
  });

  it('reports failures with incremented backoff', async () => {
    const api = fakeApi({ uploadPhoto: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const r = await processQueue([upload({ attempts: 2 })], { api, readPhoto, now: 1000 });
    expect(r.done).toEqual([]);
    expect(r.failed).toEqual([{ id: 'j2', error: 'offline', nextAttemptAt: nextAttemptAt(2, 1000) }]);
    expect(r.failed[0]!.nextAttemptAt).toBe(21_000);
  });

  it('runs upserts for a session FIFO: a later upsert waits behind an earlier pending one', async () => {
    const first = upsert({ id: 'u1', nextAttemptAt: 5000, attempts: 1, lastError: 'offline' });
    const second = upsert({ id: 'u2', row: { ...row, printError: 'out of paper' } } as Partial<QueueJob>);
    const synced: SessionSync[] = [];
    const api = fakeApi({ upsertSession: vi.fn(async (r: SessionSync) => void synced.push(r)) });

    // u1 is not due yet: u2 (and the upload) must wait.
    let r = await processQueue([first, second, upload()], { api, readPhoto, now: 100 });
    expect(r).toEqual({ done: [], failed: [] });

    // u1 due but failing again: u2 still waits.
    const failing = fakeApi({ upsertSession: vi.fn(async () => Promise.reject(new Error('offline'))) });
    r = await processQueue([{ ...first, nextAttemptAt: 0 }, second, upload()], { api: failing, readPhoto, now: 100 });
    expect(r.done).toEqual([]);
    expect(r.failed.map((f) => f.id)).toEqual(['u1']);
    expect(failing.upsertSession).toHaveBeenCalledTimes(1);

    // Once u1 is due and succeeds, u2 runs after it, so the last synced row carries the print error.
    r = await processQueue([{ ...first, nextAttemptAt: 0 }, second, upload()], { api, readPhoto, now: 100 });
    expect(r.done).toEqual(['u1', 'u2', 'j2']);
    expect(synced.map((s) => s.printError)).toEqual([null, 'out of paper']);
  });

  it('upserts of other sessions are not blocked', async () => {
    const api = fakeApi();
    const other = upsert({ id: 'o1', row: { ...row, id: 's2' } } as Partial<QueueJob>);
    const r = await processQueue([upsert({ nextAttemptAt: 5000 }), other], { api, readPhoto, now: 100 });
    expect(r.done).toEqual(['o1']);
  });

  it('keeps a readable message for non-Error failures', async () => {
    const throwing = (value: unknown) =>
      fakeApi({ upsertSession: vi.fn(async () => Promise.reject(value)) });
    const run = async (value: unknown) =>
      (await processQueue([upsert()], { api: throwing(value), readPhoto, now: 0 })).failed[0]!.error;
    expect(await run({ message: 'JWT expired', code: 'PGRST301' })).toBe('JWT expired');
    expect(await run({ code: 42 })).toBe('{"code":42}');
    expect(await run('plain')).toBe('plain');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(await run(cyclic)).toBe('[object Object]');
  });

  it('reports a failed photo read as a job failure', async () => {
    const api = fakeApi();
    const r = await processQueue([upload()], {
      api,
      readPhoto: async () => Promise.reject(new Error('ENOENT')),
      now: 0,
    });
    expect(api.uploadPhoto).not.toHaveBeenCalled();
    expect(r.failed).toEqual([{ id: 'j2', error: 'ENOENT', nextAttemptAt: 5000 }]);
  });
});
