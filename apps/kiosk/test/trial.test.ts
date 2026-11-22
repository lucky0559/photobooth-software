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
        writeFileSync: () => {
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
        writeFileSync: ((...a: Parameters<typeof writeFileSync>) => {
          writes++
          return writeFileSync(...a)
        }) as typeof writeFileSync,
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
})
