import { describe, expect, it } from 'vitest';
import {
  DAMAGED_SETTINGS_NOTICE,
  QUEUE_UNAVAILABLE_NOTICE,
  SETTINGS_UNREADABLE_NOTICE,
  setupNotices,
  syncFailureNotice,
  UPLOADS_DROPPED_NOTICE,
} from '../src/renderer/src/screens/setup-notices';

const none = {
  recoveredFromCorruption: false,
  uploadsDropped: false,
  settingsUnreadable: false,
  queueUnavailable: false,
  syncFailures: { failingCount: 0, oldestFailingSince: null, lastError: null },
};

describe('setupNotices', () => {
  it('is empty when nothing happened', () => {
    expect(setupNotices(none)).toEqual([]);
  });

  it('shows each flagged notice with the pinned copy', () => {
    expect(setupNotices({ ...none, recoveredFromCorruption: true })).toEqual([
      'Settings file was damaged and reset. Check the printer and camera.',
    ]);
    expect(setupNotices({ ...none, uploadsDropped: true })).toEqual([
      'Some saved photo uploads could not be restored. A copy of the damaged file was kept in the kiosk data folder.',
    ]);
    expect(setupNotices({ ...none, queueUnavailable: true })).toEqual([
      'Saved sessions file could not be read. The kiosk is out of service until it is fixed or the kiosk is restarted.',
    ]);
    expect(setupNotices({ ...none, recoveredFromCorruption: true, uploadsDropped: true, settingsUnreadable: true, queueUnavailable: true })).toEqual([
      QUEUE_UNAVAILABLE_NOTICE,
      SETTINGS_UNREADABLE_NOTICE,
      DAMAGED_SETTINGS_NOTICE,
      UPLOADS_DROPPED_NOTICE,
    ]);
  });
});

describe('syncFailureNotice (R22)', () => {
  // 2026-11-12 14:05 in Manila
  const since = Date.parse('2026-11-12T06:05:00.000Z');

  it('is null while nothing keeps failing', () => {
    expect(syncFailureNotice({ failingCount: 0, oldestFailingSince: null, lastError: null })).toBeNull();
  });

  it('says how many, since when, and the last error', () => {
    expect(syncFailureNotice({ failingCount: 3, oldestFailingSince: since, lastError: 'new row violates row-level security' })).toBe(
      '3 saved uploads are failing since Nov 12, 2:05 PM: new row violates row-level security',
    );
    expect(syncFailureNotice({ failingCount: 1, oldestFailingSince: since, lastError: null })).toBe(
      '1 saved upload is failing since Nov 12, 2:05 PM',
    );
  });

  it('leaves out the time when it is unknown (older queue file)', () => {
    expect(syncFailureNotice({ failingCount: 2, oldestFailingSince: null, lastError: 'x' })).toBe('2 saved uploads are failing: x');
  });

  it('truncates the error to 120 characters and keeps it on one plain line', () => {
    const notice = syncFailureNotice({ failingCount: 1, oldestFailingSince: null, lastError: `line1\n${'e'.repeat(300)}` })!;
    const error = notice.slice('1 saved upload is failing: '.length);
    expect(error.length).toBe(120);
    expect(error.endsWith('…')).toBe(true);
    expect(notice).not.toContain('\n');
  });

  it('is part of setupNotices', () => {
    expect(setupNotices({ ...none, syncFailures: { failingCount: 2, oldestFailingSince: null, lastError: 'x' } })).toEqual([
      '2 saved uploads are failing: x',
    ]);
  });
});
