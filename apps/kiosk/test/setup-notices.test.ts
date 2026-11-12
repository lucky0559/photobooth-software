import { describe, expect, it } from 'vitest';
import {
  DAMAGED_SETTINGS_NOTICE,
  QUEUE_UNAVAILABLE_NOTICE,
  SETTINGS_UNREADABLE_NOTICE,
  setupNotices,
  UPLOADS_DROPPED_NOTICE,
} from '../src/renderer/src/screens/setup-notices';

const none = { recoveredFromCorruption: false, uploadsDropped: false, settingsUnreadable: false, queueUnavailable: false };

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
    expect(setupNotices({ recoveredFromCorruption: true, uploadsDropped: true, settingsUnreadable: true, queueUnavailable: true })).toEqual([
      QUEUE_UNAVAILABLE_NOTICE,
      SETTINGS_UNREADABLE_NOTICE,
      DAMAGED_SETTINGS_NOTICE,
      UPLOADS_DROPPED_NOTICE,
    ]);
  });
});
