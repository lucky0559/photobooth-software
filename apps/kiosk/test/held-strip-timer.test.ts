import { PAIR_WAIT_MS } from '@pb/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flushDueHeldStrip,
  HELD_PRINT_FAILED_LOG,
  heldStripTimerActive,
  type HeldStripTimerDeps,
} from '../src/renderer/src/output/held-strip-timer';

const NOW = 10_000_000;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);

function setup(heldAt: number | null, over: { readPhoto?: () => Promise<ArrayBuffer>; print?: () => Promise<unknown> } = {}) {
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  const held = heldAt === null ? null : { sessionId: 'a', filePath: '/photos/a.jpg', heldAt };
  const bridge = {
    getHeldStrip: vi.fn(async () => held),
    claimHeldStrip: vi.fn(async () => held),
    readPhoto: vi.fn(over.readPhoto ?? (async () => JPEG.buffer.slice(0) as ArrayBuffer)),
    print: vi.fn(over.print ?? (async () => ({ ok: true }))),
  };
  const composePair = vi.fn(async () => new Blob([JPEG], { type: 'image/jpeg' }));
  const d = {
    bridge,
    decode: vi.fn(async () => bitmap),
    composePair,
    now: () => NOW,
    waitMs: PAIR_WAIT_MS,
  } as unknown as HeldStripTimerDeps;
  return { d, bridge, bitmap, composePair };
}

afterEach(() => vi.restoreAllMocks());

describe('flushDueHeldStrip', () => {
  it('does nothing when no strip is held', async () => {
    const { d, bridge } = setup(null);
    expect(await flushDueHeldStrip(d)).toBe('none');
    expect(bridge.claimHeldStrip).not.toHaveBeenCalled();
  });

  it('waits until the strip is old enough', async () => {
    const { d, bridge } = setup(NOW - PAIR_WAIT_MS + 1);
    expect(await flushDueHeldStrip(d)).toBe('waiting');
    expect(bridge.claimHeldStrip).not.toHaveBeenCalled();
  });

  it('prints a due strip alone, once, and closes the bitmap', async () => {
    const { d, bridge, bitmap, composePair } = setup(NOW - PAIR_WAIT_MS);
    expect(await flushDueHeldStrip(d)).toBe('printed');
    expect(bridge.readPhoto).toHaveBeenCalledWith('/photos/a.jpg');
    expect(composePair).toHaveBeenCalledWith(bitmap, null);
    expect(bridge.print).toHaveBeenCalledWith(expect.any(ArrayBuffer), 1);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('prints a strip left over from before a restart', async () => {
    const { d } = setup(NOW - 3 * 24 * 3600_000);
    expect(await flushDueHeldStrip(d)).toBe('printed');
  });

  it('does not print when a guest claimed the strip first', async () => {
    const { d, bridge } = setup(NOW - PAIR_WAIT_MS);
    bridge.claimHeldStrip.mockResolvedValue(null);
    expect(await flushDueHeldStrip(d)).toBe('none');
    expect(bridge.print).not.toHaveBeenCalled();
  });

  it('logs once and fails when the held photo is missing, without re-holding', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { d, bridge } = setup(NOW - PAIR_WAIT_MS, {
      readPhoto: () => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    });
    expect(await flushDueHeldStrip(d)).toBe('failed');
    expect(err).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith(HELD_PRINT_FAILED_LOG);
    expect(bridge.print).not.toHaveBeenCalled();
    expect('holdStrip' in d.bridge).toBe(false);
  });

  it('fails with one log line when the print is refused', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { d } = setup(NOW - PAIR_WAIT_MS, { print: async () => ({ ok: false, reason: 'jam' }) });
    expect(await flushDueHeldStrip(d)).toBe('failed');
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('fails with one log line when the print rejects', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { d } = setup(NOW - PAIR_WAIT_MS, { print: () => Promise.reject(new Error('boom')) });
    expect(await flushDueHeldStrip(d)).toBe('failed');
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('never rejects when reading the held strip fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { d, bridge } = setup(NOW - PAIR_WAIT_MS);
    bridge.getHeldStrip.mockRejectedValue(new Error('disk'));
    await expect(flushDueHeldStrip(d)).resolves.toBe('failed');
  });
});

describe('heldStripTimerActive', () => {
  it('is on only for paired print on the attract screen', () => {
    expect(heldStripTimerActive({ pairedPrint: true }, 'attract')).toBe(true);
    for (const name of ['payment', 'capture', 'review', 'output', 'delivery'] as const) {
      expect(heldStripTimerActive({ pairedPrint: true }, name)).toBe(false);
    }
    expect(heldStripTimerActive({}, 'attract')).toBe(false);
    expect(heldStripTimerActive({ pairedPrint: false }, 'attract')).toBe(false);
  });
});
