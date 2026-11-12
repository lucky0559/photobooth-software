import { describe, expect, it } from 'vitest';
import { focusExistingWindow, shouldTakeSingleInstanceLock } from '../src/main/single-instance';

describe('shouldTakeSingleInstanceLock', () => {
  it('locks only in a packaged app (unpackaged dev and e2e runs may start several instances)', () => {
    expect(shouldTakeSingleInstanceLock(true)).toBe(true);
    expect(shouldTakeSingleInstanceLock(false)).toBe(false);
  });
});

function fakeWindow(minimized: boolean) {
  const calls: string[] = [];
  return {
    calls,
    win: {
      isDestroyed: () => false,
      isMinimized: () => minimized,
      restore: () => calls.push('restore'),
      show: () => calls.push('show'),
      focus: () => calls.push('focus'),
    },
  };
}

describe('focusExistingWindow', () => {
  it('restores a minimized window, then shows and focuses it', () => {
    const { win, calls } = fakeWindow(true);
    focusExistingWindow(win);
    expect(calls).toEqual(['restore', 'show', 'focus']);
  });

  it('shows and focuses a window that is not minimized', () => {
    const { win, calls } = fakeWindow(false);
    focusExistingWindow(win);
    expect(calls).toEqual(['show', 'focus']);
  });

  it('does nothing without a live window (second launch before the first window exists, or after it closed)', () => {
    expect(() => focusExistingWindow(null)).not.toThrow();
    const { win, calls } = fakeWindow(false);
    focusExistingWindow({ ...win, isDestroyed: () => true });
    expect(calls).toEqual([]);
  });
});
