import { describe, expect, it, vi } from 'vitest';
import { HELD_UNREADABLE_LOG, REHOLD_FAILED_LOG, runOutput, type OutputDeps, type PairedDeps } from '../src/renderer/src/output/run-output';
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

  it('truncates a very long print error on the queued row but still returns it whole', async () => {
    const d = deps();
    d.bridge.print.mockResolvedValue({ ok: false, reason: 'z'.repeat(2000) } as never);
    const r = await runOutput(d);
    expect(r.printError).toHaveLength(2000);
    const last = added(d).slice(-1)[0] as Extract<QueueJob, { kind: 'upsert_session' }>;
    expect(last.row.printError!.length).toBeLessThanOrEqual(500);
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

  it('retry after a queue failure reuses the first print outcome instead of printing again', async () => {
    const d = deps();
    d.bridge.print.mockResolvedValue({ ok: false, reason: 'jam' } as never);
    d.bridge.queueAdd.mockRejectedValueOnce(new Error('disk full'));
    let printed: { printError: string | null } | undefined;
    const onPrinted = vi.fn((printError: string | null) => (printed = { printError }));

    await expect(runOutput({ ...d, onPrinted })).rejects.toThrow('disk full');
    expect(onPrinted).toHaveBeenCalledWith('jam');

    const r = await runOutput({ ...d, onPrinted, priorPrint: printed });
    expect(d.bridge.print).toHaveBeenCalledTimes(1);
    expect(r.printError).toBe('jam');
    expect(added(d).slice(-1)[0]).toMatchObject({ kind: 'upsert_session', row: { printError: 'jam' } });
  });

  it('retry after a failed follow-up enqueue does not print again', async () => {
    const d = deps();
    d.bridge.print.mockResolvedValue({ ok: false, reason: 'jam' } as never);
    d.bridge.queueAdd.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk full'));
    let printed: { printError: string | null } | undefined;
    const onPrinted = (printError: string | null) => (printed = { printError });
    await expect(runOutput({ ...d, onPrinted })).rejects.toThrow('disk full');
    expect((await runOutput({ ...d, onPrinted, priorPrint: printed })).printError).toBe('jam');
    expect(d.bridge.print).toHaveBeenCalledTimes(1);
  });

  it('a successful prior print is reused as null', async () => {
    const d = deps();
    const r = await runOutput({ ...d, priorPrint: { printError: null } });
    expect(d.bridge.print).not.toHaveBeenCalled();
    expect(r.printError).toBeNull();
    expect(added(d)).toHaveLength(2);
  });

  it('rejects when the photo cannot be saved', async () => {
    const d = deps();
    d.bridge.savePhoto.mockRejectedValue(new Error('EACCES'));
    await expect(runOutput(d)).rejects.toThrow('EACCES');
    expect(d.bridge.queueAdd).not.toHaveBeenCalled();
  });
});

const HELD = { sessionId: 'held-1', filePath: '/photos/held-1.jpg', heldAt: 1 };
const HELD_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4]);

function pairedDeps(over: Partial<PairedDeps> = {}) {
  const base = {
    bridge: {
      claimHeldStrip: vi.fn(async () => null as typeof HELD | null),
      holdStrip: vi.fn(async (_h: typeof HELD) => {}),
      readPhoto: vi.fn(async (_p: string) => HELD_JPEG.buffer as ArrayBuffer),
    },
    decode: vi.fn(async (b: Blob) => ({ size: b.size, close: vi.fn() }) as unknown as ImageBitmap),
    composePair: vi.fn(async (_l: ImageBitmap, _r: ImageBitmap | null) => new Blob([JPEG], { type: 'image/jpeg' })),
    onOutcome: vi.fn(),
  };
  return { ...base, ...over } as typeof base & PairedDeps;
}

const withPaired = (over: Partial<PairedDeps> = {}) => {
  const p = pairedDeps(over);
  const d = deps({ paired: p });
  return { d, p };
};

describe('runOutput paired', () => {
  it('first guest holds and does not print', async () => {
    const { d, p } = withPaired();
    const r = await runOutput(d);
    expect(p.bridge.holdStrip).toHaveBeenCalledTimes(1);
    expect(p.bridge.holdStrip).toHaveBeenCalledWith({
      sessionId: 's1',
      filePath: '/photos/s1.jpg',
      heldAt: Date.parse('2026-01-01T00:02:00.000Z'),
    });
    expect(d.bridge.print).not.toHaveBeenCalled();
    expect(r).toMatchObject({ held: true, printError: null });
    expect(p.onOutcome).toHaveBeenCalledWith({ held: true });
    expect(added(d).map((j) => j.kind)).toEqual(['upsert_session', 'upload_photo']);
    expect(d.bridge.queueAdd.mock.invocationCallOrder[0]!).toBeLessThan(p.bridge.claimHeldStrip.mock.invocationCallOrder[0]!);
  });

  it('second guest prints one sheet with the held strip on the left', async () => {
    const { d, p } = withPaired();
    p.bridge.claimHeldStrip.mockResolvedValue(HELD);
    d.copies = 2;
    const decoded: { close: ReturnType<typeof vi.fn> }[] = [];
    p.decode.mockImplementation(async (b: Blob) => {
      const bm = { size: b.size, close: vi.fn() };
      decoded.push(bm);
      return bm as unknown as ImageBitmap;
    });
    const r = await runOutput(d);
    expect(p.bridge.readPhoto).toHaveBeenCalledWith('/photos/held-1.jpg');
    const [left, right] = p.composePair.mock.calls[0]! as unknown as [{ size: number }, { size: number }];
    expect(left.size).toBe(7);
    expect(right.size).toBe(5);
    expect(d.bridge.print).toHaveBeenCalledTimes(1);
    expect(d.bridge.print).toHaveBeenCalledWith(expect.any(ArrayBuffer), 1);
    expect(p.bridge.holdStrip).not.toHaveBeenCalled();
    expect(r).toMatchObject({ held: false, printError: null });
    expect(decoded).toHaveLength(2);
    for (const bm of decoded) expect(bm.close).toHaveBeenCalled();
  });

  it('a pair-sheet print failure is recorded on the second guest only', async () => {
    const { d, p } = withPaired();
    p.bridge.claimHeldStrip.mockResolvedValue(HELD);
    d.bridge.print.mockResolvedValue({ ok: false, reason: 'out of paper' } as never);
    await runOutput(d);
    const jobs = added(d);
    expect(jobs.map((j) => j.kind)).toEqual(['upsert_session', 'upload_photo', 'upsert_session']);
    for (const j of jobs) expect(j).toMatchObject(j.kind === 'upsert_session' ? { row: { id: 's1' } } : { sessionId: 's1' });
    expect(jobs[2]).toMatchObject({ row: { printError: 'out of paper' } });
    expect(JSON.stringify(jobs)).not.toContain('held-1');
  });

  it('held photo unreadable prints this strip alone', async () => {
    const { d, p } = withPaired();
    p.bridge.claimHeldStrip.mockResolvedValue(HELD);
    p.bridge.readPhoto.mockRejectedValue(new Error('ENOENT'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await runOutput(d);
      expect(err).toHaveBeenCalledTimes(1);
      expect(err).toHaveBeenCalledWith(HELD_UNREADABLE_LOG);
      const [left, right] = p.composePair.mock.calls[0]! as unknown as [{ size: number }, unknown];
      expect(left.size).toBe(5);
      expect(right).toBeNull();
      expect(d.bridge.print).toHaveBeenCalledTimes(1);
      expect(p.bridge.holdStrip).not.toHaveBeenCalled();
      expect(r.held).toBe(false);
    } finally {
      err.mockRestore();
    }
  });

  it('held photo that cannot be decoded prints this strip alone', async () => {
    const { d, p } = withPaired();
    p.bridge.claimHeldStrip.mockResolvedValue(HELD);
    p.decode.mockImplementation(async (b: Blob) => {
      if (b.size === 7) throw new Error('bad jpeg');
      return { size: b.size, close: vi.fn() } as unknown as ImageBitmap;
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await runOutput(d);
      expect(err).toHaveBeenCalledTimes(1);
      expect(err).toHaveBeenCalledWith(HELD_UNREADABLE_LOG);
      const [left, right] = p.composePair.mock.calls[0]! as unknown as [{ size: number }, unknown];
      expect(left.size).toBe(5);
      expect(right).toBeNull();
      expect(d.bridge.print).toHaveBeenCalledTimes(1);
      expect(p.bridge.holdStrip).not.toHaveBeenCalled();
      expect(r.held).toBe(false);
    } finally {
      err.mockRestore();
    }
  });

  it('a compose failure after the claim puts the held strip back and rejects', async () => {
    const { d, p } = withPaired();
    p.bridge.claimHeldStrip.mockResolvedValue(HELD);
    p.composePair.mockRejectedValue(new Error('canvas failed'));
    await expect(runOutput(d)).rejects.toThrow('canvas failed');
    expect(p.bridge.holdStrip).toHaveBeenCalledWith(HELD);
    expect(d.bridge.print).not.toHaveBeenCalled();
    expect(p.onOutcome).not.toHaveBeenCalled();
  });

  it('keeps the original error when the put-back also fails', async () => {
    const { d, p } = withPaired();
    p.bridge.claimHeldStrip.mockResolvedValue(HELD);
    p.composePair.mockRejectedValue(new Error('canvas failed'));
    p.bridge.holdStrip.mockRejectedValue(new Error('held busy'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(runOutput(d)).rejects.toThrow('canvas failed');
      expect(err).toHaveBeenCalledTimes(1);
      expect(err.mock.calls[0]![0]).toBe(REHOLD_FAILED_LOG);
    } finally {
      err.mockRestore();
    }
  });

  it('retry after the pair printed and the follow-up enqueue failed does not claim or print again', async () => {
    const { d, p } = withPaired();
    p.bridge.claimHeldStrip.mockResolvedValue(HELD);
    d.bridge.print.mockResolvedValue({ ok: false, reason: 'jam' } as never);
    d.bridge.queueAdd.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk full'));
    await expect(runOutput(d)).rejects.toThrow('disk full');
    expect(p.onOutcome).toHaveBeenCalledWith({ held: false, printError: 'jam' });
    const prior = p.onOutcome.mock.calls[0]![0] as PairedDeps['prior'];
    const r = await runOutput({ ...d, paired: { ...p, prior } });
    expect(p.bridge.claimHeldStrip).toHaveBeenCalledTimes(1);
    expect(d.bridge.print).toHaveBeenCalledTimes(1);
    expect(added(d).slice(-1)[0]).toMatchObject({ row: { printError: 'jam' } });
    expect(r.held).toBe(false);
  });

  it('retry with a prior hold skips claim, hold and print', async () => {
    const { d, p } = withPaired({ prior: { held: true } });
    const r = await runOutput(d);
    expect(p.bridge.claimHeldStrip).not.toHaveBeenCalled();
    expect(p.bridge.holdStrip).not.toHaveBeenCalled();
    expect(d.bridge.print).not.toHaveBeenCalled();
    expect(r).toMatchObject({ held: true, printError: null });
  });

  it("a claim that returns this guest's own strip re-holds it instead of pairing", async () => {
    const own = { sessionId: 's1', filePath: '/photos/s1.jpg', heldAt: 5 };
    const { d, p } = withPaired();
    p.bridge.claimHeldStrip.mockResolvedValue(own);
    const r = await runOutput(d);
    expect(p.bridge.holdStrip).toHaveBeenCalledWith(own);
    expect(d.bridge.print).not.toHaveBeenCalled();
    expect(p.composePair).not.toHaveBeenCalled();
    expect(r.held).toBe(true);
  });

  it('a failed hold rejects so Try again runs', async () => {
    const { d, p } = withPaired();
    p.bridge.holdStrip.mockRejectedValue(new Error('disk full'));
    await expect(runOutput(d)).rejects.toThrow('disk full');
    expect(p.onOutcome).not.toHaveBeenCalled();
  });

  it('a failed claim rejects without printing or holding', async () => {
    const { d, p } = withPaired();
    p.bridge.claimHeldStrip.mockRejectedValue(new Error('ipc broke'));
    await expect(runOutput(d)).rejects.toThrow('ipc broke');
    expect(d.bridge.print).not.toHaveBeenCalled();
    expect(p.bridge.holdStrip).not.toHaveBeenCalled();
  });

  it('without paired deps the held strip is never touched', async () => {
    const d = deps();
    const spy = vi.fn();
    Object.assign(d.bridge, { claimHeldStrip: spy, holdStrip: spy });
    const r = await runOutput(d);
    expect(spy).not.toHaveBeenCalled();
    expect(d.bridge.print).toHaveBeenCalledWith(expect.any(ArrayBuffer), 2);
    expect(r.held).toBe(false);
  });
});
