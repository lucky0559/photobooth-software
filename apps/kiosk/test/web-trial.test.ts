import { describe, expect, it } from 'vitest';
import { TRIAL_DURATION_MS } from '../src/shared/trial-clock';
import { createWebTrial, WEB_TRIAL_KEY, type TrialStorage } from '../src/renderer/src/web-trial';

function storage(initial: Record<string, string> = {}): TrialStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('createWebTrial', () => {
  it('starts a 72-hour trial and persists its first launch', () => {
    const local = storage();
    const trial = createWebTrial(local, () => 1_000);

    expect(trial.check()).toEqual({ state: 'active', remainingMs: TRIAL_DURATION_MS });
    expect(JSON.parse(local.values.get(WEB_TRIAL_KEY)!)).toEqual({
      firstLaunchAt: 1_000,
      lastSeenAt: 1_000,
      expired: false,
      reason: null,
    });
  });

  it('persists expiry so a reload stays ended', () => {
    const local = storage();
    let now = 1_000;
    const first = createWebTrial(local, () => now);
    first.check();

    now += TRIAL_DURATION_MS;
    expect(first.check()).toEqual({ state: 'ended', reason: 'time' });
    expect(createWebTrial(local, () => now).check()).toEqual({ state: 'ended', reason: 'time' });
  });

  it('fails closed on corrupt storage without replacing it', () => {
    const local = storage({ [WEB_TRIAL_KEY]: 'not-json' });
    const trial = createWebTrial(local, () => 1_000);

    expect(trial.check()).toEqual({ state: 'ended', reason: 'unavailable' });
    expect(local.values.get(WEB_TRIAL_KEY)).toBe('not-json');
  });

  it('locks on a large clock rollback and keeps the lock after restoring the clock', () => {
    const local = storage();
    let now = 1_000_000;
    const trial = createWebTrial(local, () => now);
    trial.check();

    now -= 11 * 60_000;
    expect(trial.check()).toEqual({ state: 'ended', reason: 'clock' });
    now = 1_000_000;
    expect(trial.check()).toEqual({ state: 'ended', reason: 'clock' });
  });

  it('keeps the in-memory clock if site data is cleared during this run', () => {
    const local = storage();
    let now = 10_000;
    const trial = createWebTrial(local, () => now);
    trial.check();

    local.values.clear();
    now += 5 * 60_000;
    const status = trial.check();

    expect(status).toEqual({ state: 'active', remainingMs: TRIAL_DURATION_MS - 5 * 60_000 });
    expect(JSON.parse(local.values.get(WEB_TRIAL_KEY)!).firstLaunchAt).toBe(10_000);
  });
});
