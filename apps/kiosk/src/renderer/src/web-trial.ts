import {
  evaluateTrial,
  parseTrialState,
  TRIAL_HEARTBEAT_MS,
  type TrialState,
  type TrialStatus,
} from '../../shared/trial-clock';

export interface TrialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const WEB_TRIAL_KEY = 'photobooth-trial-v1';

export function createWebTrial(
  storage: TrialStorage,
  now: () => number = Date.now,
): { check(): TrialStatus } {
  let memory: TrialState | null = null;
  let onDisk: TrialState | null = null;
  let unavailable = false;

  return {
    check(): TrialStatus {
      if (unavailable) return { state: 'ended', reason: 'unavailable' };

      let raw: string | null;
      try {
        raw = storage.getItem(WEB_TRIAL_KEY);
      } catch {
        raw = null;
        if (memory === null) {
          unavailable = true;
          return { state: 'ended', reason: 'unavailable' };
        }
      }

      let state: TrialState | null;
      if (raw === null) {
        state = memory;
        onDisk = null;
      } else {
        const parsed = parseTrialState(raw);
        if (!parsed) {
          unavailable = true;
          return { state: 'ended', reason: 'unavailable' };
        }
        state = parsed;
        onDisk = parsed;
        if (memory?.expired && !state.expired) state = memory;
        else if (memory && memory.lastSeenAt > state.lastSeenAt) state = { ...state, lastSeenAt: memory.lastSeenAt };
      }

      const { status, next } = evaluateTrial(state, now());
      memory = next;
      const persist = onDisk === null || next.expired !== onDisk.expired ||
        next.lastSeenAt - onDisk.lastSeenAt >= TRIAL_HEARTBEAT_MS;
      if (persist) {
        try {
          storage.setItem(WEB_TRIAL_KEY, JSON.stringify(next));
          onDisk = next;
        } catch {
          if (state === null) {
            unavailable = true;
            return { state: 'ended', reason: 'unavailable' };
          }
        }
      }
      return status;
    },
  };
}
