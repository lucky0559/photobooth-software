import * as nodeFs from 'node:fs'
import { dirname } from 'node:path'
import { writeAll } from './json-store'

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

type TrialFs = Pick<
  typeof nodeFs,
  'readFileSync' | 'renameSync' | 'openSync' | 'writeSync' | 'fsyncSync' | 'closeSync'
>

type ReadResult =
  | { kind: 'ok'; state: TrialState }
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'io-error' }

/**
 * Own tiny store (not createJsonStore: that resets a corrupt file to defaults, which would
 * restart the trial). Fails closed where it matters: a first launch that cannot be persisted, or an
 * existing file that is empty, corrupt or of the wrong shape. After one good evaluation the last state
 * is kept in memory, so a transient read/write error (antivirus, indexer) never ends a running trial.
 */
export function createTrialGuard(
  file: string,
  opts: { now?: () => number; fs?: Partial<TrialFs> } = {},
): { check(): TrialStatus } {
  const now = opts.now ?? Date.now
  const fs: TrialFs = { ...nodeFs, ...opts.fs }
  const unavailable: TrialStatus = { state: 'ended', reason: 'unavailable' }
  let failed = false
  // Last evaluated state (in memory) and what is known to be on disk (null: nothing yet).
  let memory: TrialState | null = null
  let onDisk: TrialState | null = null

  const read = (): ReadResult => {
    let raw: string
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch (e) {
      return (e as NodeJS.ErrnoException)?.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'io-error' }
    }
    const state = parseState(raw)
    return state ? { kind: 'ok', state } : { kind: 'invalid' }
  }

  const writeDurably = (path: string, data: string): void => {
    const fd = fs.openSync(path, 'w')
    try {
      writeAll(fd, Buffer.from(data, 'utf8'), (f, b, o, l) => fs.writeSync(f, b, o, l))
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  }

  /** Flushes the rename where the platform supports directory fsync (not on Windows). */
  const fsyncDir = (): void => {
    let fd: number | undefined
    try {
      fd = fs.openSync(dirname(file), 'r')
      fs.fsyncSync(fd)
    } catch {
      // Unsupported here; the file itself is already flushed.
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd)
        } catch {
          // Nothing more to do.
        }
      }
    }
  }

  const write = (s: TrialState): void => {
    const tmp = `${file}.tmp`
    writeDurably(tmp, JSON.stringify(s))
    fs.renameSync(tmp, file)
    fsyncDir()
  }

  return {
    check() {
      if (failed) return unavailable
      try {
        const r = read()
        if (r.kind === 'invalid' || (r.kind === 'io-error' && memory === null)) {
          failed = true
          return unavailable
        }
        let state: TrialState | null
        if (r.kind === 'ok') {
          state = r.state
          onDisk = r.state
          if (memory?.expired && !state.expired) state = memory
          else if (memory && memory.lastSeenAt > state.lastSeenAt) state = { ...state, lastSeenAt: memory.lastSeenAt }
        } else {
          // Read failed transiently or the file vanished mid-run: carry on from memory.
          state = memory
          if (r.kind === 'missing') onDisk = null
        }
        const { status, next } = evaluateTrial(state, now())
        memory = next
        const persist =
          onDisk === null ||
          next.expired !== onDisk.expired ||
          next.lastSeenAt - onDisk.lastSeenAt >= TRIAL_HEARTBEAT_MS
        if (persist) {
          try {
            write(next)
            onDisk = next
          } catch {
            // A first launch that cannot be saved must not run; later write failures are retried next tick.
            if (state === null) {
              failed = true
              return unavailable
            }
          }
        }
        return status
      } catch {
        failed = true
        return unavailable
      }
    },
  }
}
