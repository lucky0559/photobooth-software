import { describe, expect, it, vi } from 'vitest';
import { runOutput, type OutputDeps } from '../src/renderer/src/output/run-output';
import type { QueueJob } from '../src/shared/queue';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);

function deps(over: Partial<OutputDeps> = {}) {
  let n = 0;
  const base = {
    compose: vi.fn(async () => new Blob([JPEG], { type: 'image/jpeg' })),
    bridge: {
      savePhoto: vi.fn(async (id: string, _jpeg: ArrayBuffer) => `/photos/${id}.jpg`),
      print: vi.fn(async () => ({ ok: true }) as const),
      queueAdd: vi.fn(async () => {}),
    },
    onEnqueued: vi.fn(),
    copies: 2,
    session: {
      sessionId: 's1',
      downloadToken: 'tok',
      templateId: 'fake-strip',
      amountCentavos: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    now: () => Date.parse('2026-01-01T00:02:00.000Z'),
    newId: () => `job-${++n}`,
  };
  return { ...base, ...over } as typeof base;
}

const added = (d: ReturnType<typeof deps>): QueueJob[] =>
  d.bridge.queueAdd.mock.calls.flatMap((c) => (c as unknown as [QueueJob[]])[0]);

describe('runOutput', () => {
  it('saves, prints and queues the session row then the upload', async () => {
    const d = deps();
    const r = await runOutput(d);
    expect(r.printError).toBeNull();
    expect(r.sheet.type).toBe('image/jpeg');
    expect(d.bridge.savePhoto).toHaveBeenCalledWith('s1', expect.any(ArrayBuffer));
    expect(new Uint8Array(d.bridge.savePhoto.mock.calls[0]![1] as ArrayBuffer)).toEqual(JPEG);
    expect(d.bridge.print).toHaveBeenCalledWith(expect.any(ArrayBuffer), 2);
    expect(added(d)).toEqual([
      {
        id: 'job-1',
        kind: 'upsert_session',
        row: {
          id: 's1',
          downloadToken: 'tok',
          templateId: 'fake-strip',
          amountCentavos: 0,
          status: 'free',
          printError: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:02:00.000Z',
        },
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
      },
      { id: 'job-2', kind: 'upload_photo', sessionId: 's1', filePath: '/photos/s1.jpg', attempts: 0, nextAttemptAt: 0, lastError: null },
    ]);
    expect(d.onEnqueued).toHaveBeenCalled();
  });

  it('marks paid sessions completed', async () => {
    const d = deps();
    d.session.amountCentavos = 15000;
    await runOutput(d);
    expect(added(d)[0]).toMatchObject({ row: { status: 'completed', amountCentavos: 15000 } });
  });

  it('print failure does not block queueing and records the reason on the row', async () => {
    const d = deps();
    d.bridge.print.mockResolvedValue({ ok: false, reason: 'out of paper' } as never);
    const r = await runOutput(d);
    expect(r.printError).toBe('out of paper');
    const jobs = added(d);
    expect(jobs.map((j) => j.kind)).toEqual(['upsert_session', 'upload_photo', 'upsert_session']);
    expect(jobs[2]).toMatchObject({ row: { printError: 'out of paper' } });
  });

  it('a rejected print call counts as a print failure', async () => {
    const d = deps();
    d.bridge.print.mockRejectedValue(new Error('ipc broke'));
    expect((await runOutput(d)).printError).toBe('ipc broke');
    expect(added(d).length).toBe(3);
  });

  it('rejects when composing fails, without saving or printing', async () => {
    const d = deps({ compose: vi.fn(async () => Promise.reject(new Error('Shot x is missing'))) } as never);
    await expect(runOutput(d)).rejects.toThrow('Shot x is missing');
    expect(d.bridge.savePhoto).not.toHaveBeenCalled();
    expect(d.bridge.print).not.toHaveBeenCalled();
  });

  it('rejects when the queue cannot persist the jobs', async () => {
    const d = deps();
    d.bridge.queueAdd.mockRejectedValue(new Error('disk full'));
    await expect(runOutput(d)).rejects.toThrow('disk full');
  });

  it('rejects when the photo cannot be saved', async () => {
    const d = deps();
    d.bridge.savePhoto.mockRejectedValue(new Error('EACCES'));
    await expect(runOutput(d)).rejects.toThrow('EACCES');
    expect(d.bridge.queueAdd).not.toHaveBeenCalled();
  });
});
