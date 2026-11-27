export const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
export const CLOCK_ROLLBACK_TOLERANCE_MS = 10 * 60 * 1000;
export const TRIAL_HEARTBEAT_MS = 60_000;

export type TrialReason = 'time' | 'clock' | 'unavailable';

export interface TrialState {
  firstLaunchAt: number;
  lastSeenAt: number;
  expired: boolean;
  reason: TrialReason | null;
}

export type TrialStatus =
  | { state: 'active'; remainingMs: number }
  | { state: 'ended'; reason: TrialReason };

const REASONS: readonly string[] = ['time', 'clock', 'unavailable'];

export function evaluateTrial(state: TrialState | null, now: number): { status: TrialStatus; next: TrialState } {
  if (!state) {
    return {
      status: { state: 'active', remainingMs: TRIAL_DURATION_MS },
      next: { firstLaunchAt: now, lastSeenAt: now, expired: false, reason: null },
    };
  }
  if (state.expired) return { status: { state: 'ended', reason: state.reason ?? 'time' }, next: state };
  if (now < state.lastSeenAt - CLOCK_ROLLBACK_TOLERANCE_MS) {
    return {
      status: { state: 'ended', reason: 'clock' },
      next: { ...state, expired: true, reason: 'clock' },
    };
  }
  const effective = Math.max(now, state.lastSeenAt);
  const elapsed = effective - state.firstLaunchAt;
  if (elapsed >= TRIAL_DURATION_MS) {
    return {
      status: { state: 'ended', reason: 'time' },
      next: { ...state, lastSeenAt: effective, expired: true, reason: 'time' },
    };
  }
  return {
    status: { state: 'active', remainingMs: TRIAL_DURATION_MS - elapsed },
    next: { ...state, lastSeenAt: effective },
  };
}

export function parseTrialState(raw: string): TrialState | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.firstLaunchAt !== 'number' || !Number.isFinite(record.firstLaunchAt)) return null;
  if (typeof record.lastSeenAt !== 'number' || !Number.isFinite(record.lastSeenAt)) return null;
  if (typeof record.expired !== 'boolean') return null;
  if (record.reason !== null && !(typeof record.reason === 'string' && REASONS.includes(record.reason))) return null;
  return {
    firstLaunchAt: record.firstLaunchAt,
    lastSeenAt: record.lastSeenAt,
    expired: record.expired,
    reason: record.reason as TrialReason | null,
  };
}
