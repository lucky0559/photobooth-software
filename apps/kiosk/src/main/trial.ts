import * as nodeFs from 'node:fs'

export const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000
export const CLOCK_ROLLBACK_TOLERANCE_MS = 10 * 60 * 1000
export const TRIAL_HEARTBEAT_MS = 60_000

export type TrialReason = 'time' | 'clock' | 'unavailable'

export interface TrialState {
  firstLaunchAt: number
  lastSeenAt: number
  expired: boolean
  reason: TrialReason | null
}

export type TrialStatus =
  | { state: 'active'; remainingMs: number }
  | { state: 'ended'; reason: TrialReason }

const REASONS: readonly string[] = ['time', 'clock', 'unavailable']

export function evaluateTrial(
  state: TrialState | null,
  now: number,
): { status: TrialStatus; next: TrialState } {
  if (!state) {
    return {
      status: { state: 'active', remainingMs: TRIAL_DURATION_MS },
      next: { firstLaunchAt: now, lastSeenAt: now, expired: false, reason: null },
    }
  }
  if (state.expired) {
    return { status: { state: 'ended', reason: state.reason ?? 'time' }, next: state }
  }
  if (now < state.lastSeenAt - CLOCK_ROLLBACK_TOLERANCE_MS) {
    return {
      status: { state: 'ended', reason: 'clock' },
      next: { ...state, expired: true, reason: 'clock' },
    }
  }
  const effective = Math.max(now, state.lastSeenAt)
  const elapsed = effective - state.firstLaunchAt
  if (elapsed >= TRIAL_DURATION_MS) {
    return {
      status: { state: 'ended', reason: 'time' },
      next: { ...state, lastSeenAt: effective, expired: true, reason: 'time' },
    }
  }
  return {
    status: { state: 'active', remainingMs: TRIAL_DURATION_MS - elapsed },
    next: { ...state, lastSeenAt: effective },
  }
}

function parseState(raw: string): TrialState | null {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (typeof o.firstLaunchAt !== 'number' || !Number.isFinite(o.firstLaunchAt)) return null
  if (typeof o.lastSeenAt !== 'number' || !Number.isFinite(o.lastSeenAt)) return null
  if (typeof o.expired !== 'boolean') return null
  if (o.reason !== null && !(typeof o.reason === 'string' && REASONS.includes(o.reason))) return null
  return {
    firstLaunchAt: o.firstLaunchAt,
    lastSeenAt: o.lastSeenAt,
    expired: o.expired,
    reason: o.reason as TrialReason | null,
  }
}

type TrialFs = Pick<typeof nodeFs, 'readFileSync' | 'writeFileSync' | 'renameSync'>

/**
 * Own tiny store (not createJsonStore: that resets a corrupt file to defaults, which would
 * restart the trial). Any unreadable, invalid or unwritable state fails closed.
 */
export function createTrialGuard(
  file: string,
  opts: { now?: () => number; fs?: Partial<TrialFs> } = {},
): { check(): TrialStatus } {
  const now = opts.now ?? Date.now
  const fs: TrialFs = { ...nodeFs, ...opts.fs }
  const unavailable: TrialStatus = { state: 'ended', reason: 'unavailable' }
  let failed = false

  const read = (): TrialState | null | 'bad' => {
    let raw: string
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch (e) {
      return (e as NodeJS.ErrnoException)?.code === 'ENOENT' ? null : 'bad'
    }
    return parseState(raw) ?? 'bad'
  }

  const write = (s: TrialState): void => {
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(s))
    fs.renameSync(tmp, file)
  }

  return {
    check() {
      if (failed) return unavailable
      try {
        const state = read()
        if (state === 'bad') {
          failed = true
          return unavailable
        }
        const { status, next } = evaluateTrial(state, now())
        const persist =
          state === null ||
          next.expired !== state.expired ||
          next.lastSeenAt - state.lastSeenAt >= TRIAL_HEARTBEAT_MS
        if (persist) write(next)
        return status
      } catch {
        failed = true
        return unavailable
      }
    },
  }
}
