import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composePairSheet, composeStrip } from '../src/renderer/src/compose/compose';

class FakeCanvas {
  static instances: FakeCanvas[] = [];
  ops: string[] = [];
  fillStyles: unknown[] = [];
  fillRects: number[][] = [];
  draws: unknown[][] = [];
  blobOpts: unknown[] = [];
  filter = 'none';
  constructor(
    public width: number,
    public height: number,
  ) {
    FakeCanvas.instances.push(this);
  }
  getContext() {
    const self = this;
    return {
      set fillStyle(v: unknown) {
        self.fillStyles.push(v);
      },
      set filter(v: string) {
        self.filter = v;
      },
      fillRect: (...a: number[]) => {
        self.ops.push('fillRect');
        self.fillRects.push(a);
      },
      drawImage: (...a: unknown[]) => {
        self.ops.push('drawImage');
        self.draws.push(a);
      },
    };
  }
  async convertToBlob(o: { type: string }) {
    this.blobOpts.push(o);
    return new Blob([], { type: o.type });
  }
}

const bmp = (width: number, height: number) => ({ width, height }) as unknown as ImageBitmap;

beforeEach(() => {
  FakeCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
});
afterEach(() => vi.unstubAllGlobals());

describe('composePairSheet', () => {
  it('draws both strips on a white 1200x1800 sheet', async () => {
    const L = bmp(600, 1800);
    const R = bmp(600, 1800);
    const blob = await composePairSheet(L, R);
    expect(FakeCanvas.instances).toHaveLength(1);
    const c = FakeCanvas.instances[0]!;
    expect([c.width, c.height]).toEqual([1200, 1800]);
    expect(c.fillStyles).toEqual(['#ffffff']);
    expect(c.fillRects).toEqual([[0, 0, 1200, 1800]]);
    expect(c.ops[0]).toBe('fillRect');
    expect(c.draws).toEqual([
      [L, 0, 0, 600, 1800],
      [R, 600, 0, 600, 1800],
    ]);
    expect(c.blobOpts).toEqual([{ type: 'image/jpeg', quality: 0.92 }]);
    expect(blob.type).toBe('image/jpeg');
  });

  it('leaves the right half white when there is no second strip', async () => {
    const L = bmp(600, 1800);
    await composePairSheet(L, null);
    expect(FakeCanvas.instances[0]!.draws).toEqual([[L, 0, 0, 600, 1800]]);
  });
});

describe('composeStrip', () => {
  it('renders one 600x1800 strip as JPEG with the overlay last', async () => {
    const S = bmp(800, 600);
    const O = bmp(600, 1800);
    await composeStrip({ layout: 'strip_2x6', shots: [S], overlay: O, filter: 'none' });
    expect(FakeCanvas.instances).toHaveLength(1);
    const c = FakeCanvas.instances[0]!;
    expect([c.width, c.height]).toEqual([600, 1800]);
    expect(c.blobOpts).toEqual([{ type: 'image/jpeg', quality: 0.92 }]);
    expect(c.draws.at(-1)).toEqual([O, 0, 0, 600, 1800]);
  });
});
