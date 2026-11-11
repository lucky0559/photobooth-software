import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addJobs, applyResult, EMPTY_QUEUE, validateQueueJobs, validateQueueResult } from '../src/main/queue-store';
import type { QueueJob } from '../src/shared/queue';

const dir = resolve('/data/photos');
const SID = '0b3f6a52-6c1e-4d5e-9a0b-1c2d3e4f5a6b';
const J1 = '11111111-1111-4111-8111-111111111111';
const J2 = '22222222-2222-4222-8222-222222222222';

const row = {
  id: SID,
  downloadToken: 'AbCdEfGhIjKlMnOpQrSt_-',
  templateId: 'fake-strip',
  amountCentavos: 15000,
  status: 'completed',
  printError: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:01:00.000Z',
};
const upsertJob = { id: J1, kind: 'upsert_session', row, attempts: 9, nextAttemptAt: 999, lastError: 'x' };
const uploadJob = { id: J2, kind: 'upload_photo', sessionId: SID, filePath: join(dir, `${SID}.jpg`), attempts: 0, nextAttemptAt: 0, lastError: null };

describe('validateQueueJobs', () => {
  it('accepts both kinds and resets attempts/backoff', () => {
    expect(validateQueueJobs([upsertJob, uploadJob], dir)).toEqual([
      { id: J1, kind: 'upsert_session', row, attempts: 0, nextAttemptAt: 0, lastError: null },
      { ...uploadJob },
    ]);
  });
  it('accepts a print error string and a free session', () => {
    const r = { ...row, status: 'free', amountCentavos: 0, printError: 'out of paper' };
    expect(validateQueueJobs([{ ...upsertJob, row: r }], dir)[0]).toMatchObject({ row: r });
  });
  it('drops unknown extra row fields', () => {
    const [job] = validateQueueJobs([{ ...upsertJob, row: { ...row, evil: 1 } }], dir);
    expect((job as Extract<QueueJob, { kind: 'upsert_session' }>).row).toEqual(row);
  });
  it.each<[string, unknown]>([
    ['not an array', { ...upsertJob }],
    ['empty', []],
    ['too many', Array.from({ length: 11 }, () => upsertJob)],
    ['unknown kind', [{ ...upsertJob, kind: 'delete_everything' }]],
    ['bad job id', [{ ...upsertJob, id: '../x' }]],
    ['bad session id', [{ ...upsertJob, row: { ...row, id: '../../etc' } }]],
    ['bad token', [{ ...upsertJob, row: { ...row, downloadToken: 'short' } }]],
    ['bad template', [{ ...upsertJob, row: { ...row, templateId: 'a/b' } }]],
    ['negative amount', [{ ...upsertJob, row: { ...row, amountCentavos: -1 } }]],
    ['fractional amount', [{ ...upsertJob, row: { ...row, amountCentavos: 1.5 } }]],
    ['huge amount', [{ ...upsertJob, row: { ...row, amountCentavos: 100_001 } }]],
    ['bad status', [{ ...upsertJob, row: { ...row, status: 'paid' } }]],
    ['long print error', [{ ...upsertJob, row: { ...row, printError: 'x'.repeat(501) } }]],
    ['bad createdAt', [{ ...upsertJob, row: { ...row, createdAt: 'yesterday' } }]],
    ['bad completedAt', [{ ...upsertJob, row: { ...row, completedAt: 5 } }]],
    ['upload outside photos dir', [{ ...uploadJob, filePath: '/etc/passwd' }]],
    ['upload path for another session', [{ ...uploadJob, filePath: join(dir, `${J1}.jpg`) }]],
    ['upload bad session', [{ ...uploadJob, sessionId: '..' }]],
    ['null job', [null]],
  ])('rejects %s', (_label, input) => {
    expect(() => validateQueueJobs(input, dir)).toThrow(/queue/i);
  });
});

describe('validateQueueResult', () => {
  it('accepts done ids and failures, trimming long errors', () => {
    const r = validateQueueResult({ done: [J1], failed: [{ id: J2, error: 'e'.repeat(900), nextAttemptAt: 5 }] });
    expect(r.done).toEqual([J1]);
    expect(r.failed[0]!.error).toHaveLength(500);
  });
  it.each<unknown>([
    null,
    { done: 'x', failed: [] },
    { done: [5], failed: [] },
    { done: [], failed: [{ id: J1, error: 'x', nextAttemptAt: Number.NaN }] },
    { done: [], failed: [{ id: J1, error: 3, nextAttemptAt: 1 }] },
  ])('rejects %j', (input) => {
    expect(() => validateQueueResult(input)).toThrow(/queue/i);
  });
});

describe('addJobs / applyResult', () => {
  const [a, b] = validateQueueJobs([upsertJob, uploadJob], dir) as [QueueJob, QueueJob];

  it('appends jobs and ignores duplicate ids', () => {
    const q = addJobs(addJobs(EMPTY_QUEUE, [a, b]), [a]);
    expect(q.jobs.map((j) => j.id)).toEqual([J1, J2]);
  });

  it('removes done jobs, records completed uploads, bumps failed attempts', () => {
    const q = addJobs(EMPTY_QUEUE, [a, b]);
    const failed = applyResult(q, { done: [], failed: [{ id: J2, error: 'offline', nextAttemptAt: 5000 }] }, 1);
    expect(failed.jobs[1]).toMatchObject({ attempts: 1, nextAttemptAt: 5000, lastError: 'offline' });
    const again = applyResult(failed, { done: [], failed: [{ id: J2, error: 'still', nextAttemptAt: 9 }] }, 2);
    expect(again.jobs[1]).toMatchObject({ attempts: 2, lastError: 'still' });

    const done = applyResult(again, { done: [J1, J2], failed: [] }, 777);
    expect(done.jobs).toEqual([]);
    expect(done.completedUploads).toEqual([{ sessionId: SID, filePath: join(dir, `${SID}.jpg`), completedAt: 777 }]);
  });

  it('ignores ids it does not know', () => {
    const q = addJobs(EMPTY_QUEUE, [a]);
    expect(applyResult(q, { done: [J2], failed: [{ id: J2, error: 'x', nextAttemptAt: 1 }] }, 0)).toEqual(q);
  });
});
