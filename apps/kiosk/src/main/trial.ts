import * as nodeFs from 'node:fs'
import { dirname } from 'node:path'
import { writeAll } from './json-store'
import {
  CLOCK_ROLLBACK_TOLERANCE_MS,
  evaluateTrial,
  parseTrialState as parseState,
  TRIAL_DURATION_MS,
  TRIAL_HEARTBEAT_MS,
  type TrialReason,
  type TrialState,
  type TrialStatus,
} from '../shared/trial-clock'

export {
  CLOCK_ROLLBACK_TOLERANCE_MS,
  evaluateTrial,
  TRIAL_DURATION_MS,
  TRIAL_HEARTBEAT_MS,
  type TrialReason,
  type TrialState,
  type TrialStatus,
} from '../shared/trial-clock'

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
