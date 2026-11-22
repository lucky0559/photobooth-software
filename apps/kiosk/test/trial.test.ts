import * as nodeFs from 'node:fs'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CLOCK_ROLLBACK_TOLERANCE_MS,
  TRIAL_DURATION_MS,
  TRIAL_HEARTBEAT_MS,
  createTrialGuard,
  evaluateTrial,
  type TrialState,
} from '../src/main/trial'

const D = TRIAL_DURATION_MS
const T = 1_000_000
const MIN = 60_000
const DAY = 24 * 3600_000

const fresh = (over: Partial<TrialState> = {}): TrialState => ({
  firstLaunchAt: T,
  lastSeenAt: T,
  expired: false,
  reason: null,
  ...over,
})

describe('evaluateTrial', () => {
  it('starts a trial on first launch', () => {
    const { status, next } = evaluateTrial(null, T)
    expect(status).toEqual({ state: 'active', remainingMs: D })
    expect(next).toEqual({ firstLaunchAt: T, lastSeenAt: T, expired: false, reason: null })
  })

  it('expires exactly at the duration', () => {
    expect(evaluateTrial(fresh(), T + D - 1).status).toEqual({ state: 'active', remainingMs: 1 })
    const ended = evaluateTrial(fresh(), T + D)
    expect(ended.status).toEqual({ state: 'ended', reason: 'time' })
    expect(ended.next.expired).toBe(true)
  })

  it('keeps an expired state ended even when the clock is earlier', () => {
    const s = fresh({ expired: true, reason: 'clock' })
    expect(evaluateTrial(s, T - 100 * DAY).status).toEqual({ state: 'ended', reason: 'clock' })
  })

  it('gives no time back for a small backwards jump', () => {
    const r = evaluateTrial(fresh(), T - 5 * MIN)
    expect(r.status).toEqual({ state: 'active', remainingMs: D })
    expect(r.next.lastSeenAt).toBe(T)
  })

  it('locks on a backwards jump beyond the tolerance', () => {
    expect(CLOCK_ROLLBACK_TOLERANCE_MS).toBe(10 * MIN)
    const r = evaluateTrial(fresh(), T - 11 * MIN)
    expect(r.status).toEqual({ state: 'ended', reason: 'clock' })
    expect(r.next.expired).toBe(true)
  })

  it('expires by time even when lastSeenAt is ahead of firstLaunchAt', () => {
    const r = evaluateTrial(fresh({ lastSeenAt: T + MIN }), T + 5 * DAY)
    expect(r.status).toEqual({ state: 'ended', reason: 'time' })
  })
})

describe('createTrialGuard', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'trial-test-'))
    file = join(dir, 'trial.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('persists across guard instances and stays ended', () => {
    let now = T
    const g1 = createTrialGuard(file, { now: () => now })
    expect(g1.check()).toEqual({ state: 'active', remainingMs: D })
    expect(existsSync(file)).toBe(true)

    now = T + 2 * DAY
    expect(createTrialGuard(file, { now: () => now }).check()).toEqual({
      state: 'active',
      remainingMs: D - 2 * DAY,
    })

    now = T + 3 * DAY + MIN
    expect(createTrialGuard(file, { now: () => now }).check()).toEqual({ state: 'ended', reason: 'time' })

    now = T
    expect(createTrialGuard(file, { now: () => now }).check()).toEqual({ state: 'ended', reason: 'time' })
  })

  it.each(['not json', '{}', '[]', '{"firstLaunchAt":"x"}'])(
    'fails closed on an unusable file %s without overwriting it',
    (content) => {
      writeFileSync(file, content)
      const g = createTrialGuard(file, { now: () => T })
      expect(g.check()).toEqual({ state: 'ended', reason: 'unavailable' })
      expect(g.check()).toEqual({ state: 'ended', reason: 'unavailable' })
      expect(readFileSync(file, 'utf8')).toBe(content)
    },
  )

  it('fails closed when the first launch cannot be written', () => {
    const g = createTrialGuard(file, {
      now: () => T,
      fs: {
        openSync: () => {
          throw new Error('disk full')
        },
      },
    })
    expect(g.check()).toEqual({ state: 'ended', reason: 'unavailable' })
    expect(existsSync(file)).toBe(false)
  })

  it('writes the heartbeat at most once a minute', () => {
    let writes = 0
    let now = T
    const g = createTrialGuard(file, {
      now: () => now,
      fs: {
        renameSync: ((...a: Parameters<typeof nodeFs.renameSync>) => {
          writes++
          return nodeFs.renameSync(...a)
        }) as typeof nodeFs.renameSync,
      },
    })
    g.check()
    expect(writes).toBe(1)
    now = T + 10_000
    g.check()
    expect(writes).toBe(1)
    now = T + 10_000 + TRIAL_HEARTBEAT_MS + 1_000
    g.check()
    expect(writes).toBe(2)
  })

  it('fsyncs the temp file before renaming it', () => {
    const calls: string[] = []
    const g = createTrialGuard(file, {
      now: () => T,
      fs: {
        fsyncSync: ((fd: number) => {
          calls.push('fsync')
          return nodeFs.fsyncSync(fd)
        }) as typeof nodeFs.fsyncSync,
        renameSync: ((a: nodeFs.PathLike, b: nodeFs.PathLike) => {
          calls.push('rename')
          return nodeFs.renameSync(a, b)
        }) as typeof nodeFs.renameSync,
      },
    })
    g.check()
    expect(calls.indexOf('fsync')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('fsync')).toBeLessThan(calls.indexOf('rename'))
    expect(JSON.parse(readFileSync(file, 'utf8')).firstLaunchAt).toBe(T)
  })

  it('fails closed on an empty existing file without overwriting it', () => {
    writeFileSync(file, '')
    const g = createTrialGuard(file, { now: () => T })
    expect(g.check()).toEqual({ state: 'ended', reason: 'unavailable' })
    expect(readFileSync(file, 'utf8')).toBe('')
  })

  it('does not lock at exactly 10 minutes back, locks 1 ms beyond, and persists the lock', () => {
    writeFileSync(file, JSON.stringify(fresh()))
    expect(createTrialGuard(file, { now: () => T - 10 * MIN }).check().state).toBe('active')
    const g = createTrialGuard(file, { now: () => T - 10 * MIN - 1 })
    expect(g.check()).toEqual({ state: 'ended', reason: 'clock' })
    expect(createTrialGuard(file, { now: () => T }).check()).toEqual({ state: 'ended', reason: 'clock' })
  })

  describe('transient I/O errors after a good first load', () => {
    const eperm = () => Object.assign(new Error('EPERM'), { code: 'EPERM' })

    it('keeps the trial active when a heartbeat rename fails, and writes on a later tick', () => {
      let now = T
      let failRename = false
      const g = createTrialGuard(file, {
        now: () => now,
        fs: {
          renameSync: ((a: nodeFs.PathLike, b: nodeFs.PathLike) => {
            if (failRename) throw eperm()
            return nodeFs.renameSync(a, b)
          }) as typeof nodeFs.renameSync,
        },
      })
      expect(g.check().state).toBe('active')
      failRename = true
      now = T + 2 * MIN
      expect(g.check().state).toBe('active')
      expect(JSON.parse(readFileSync(file, 'utf8')).lastSeenAt).toBe(T)
      failRename = false
      now = T + 3 * MIN
      expect(g.check().state).toBe('active')
      expect(JSON.parse(readFileSync(file, 'utf8')).lastSeenAt).toBe(T + 3 * MIN)
    })

    it('keeps the trial active when a heartbeat read fails', () => {
      let failRead = false
      const g = createTrialGuard(file, {
        now: () => T,
        fs: {
          readFileSync: ((...a: Parameters<typeof nodeFs.readFileSync>) => {
            if (failRead) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
            return nodeFs.readFileSync(...a)
          }) as typeof nodeFs.readFileSync,
        },
      })
      expect(g.check().state).toBe('active')
      failRead = true
      expect(g.check().state).toBe('active')
    })

    it('uses the in-memory state and rewrites the file when it vanishes mid-run', () => {
      let now = T
      const g = createTrialGuard(file, { now: () => now })
      g.check()
      rmSync(file)
      now = T + MIN / 2
      const s = g.check()
      expect(s.state).toBe('active')
      if (s.state === 'active') expect(s.remainingMs).toBe(D - MIN / 2)
      expect(JSON.parse(readFileSync(file, 'utf8')).firstLaunchAt).toBe(T)
    })

    it('reports time when the expiry cannot be persisted', () => {
      let now = T
      let failRename = false
      const g = createTrialGuard(file, {
        now: () => now,
        fs: {
          renameSync: ((a: nodeFs.PathLike, b: nodeFs.PathLike) => {
            if (failRename) throw eperm()
            return nodeFs.renameSync(a, b)
          }) as typeof nodeFs.renameSync,
        },
      })
      g.check()
      failRename = true
      now = T + D
      expect(g.check()).toEqual({ state: 'ended', reason: 'time' })
      expect(g.check()).toEqual({ state: 'ended', reason: 'time' })
    })

    it('still fails closed when the file turns corrupt mid-run', () => {
      const g = createTrialGuard(file, { now: () => T })
      g.check()
      writeFileSync(file, 'garbage')
      expect(g.check()).toEqual({ state: 'ended', reason: 'unavailable' })
    })
  })
})
