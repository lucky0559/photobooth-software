import { describe, expect, it } from 'vitest';
import {
  DAMAGED_SETTINGS_NOTICE,
  SETTINGS_UNREADABLE_NOTICE,
  setupNotices,
  UPLOADS_DROPPED_NOTICE,
} from '../src/renderer/src/screens/setup-notices';

const none = { recoveredFromCorruption: false, uploadsDropped: false, settingsUnreadable: false };

describe('setupNotices', () => {
  it('is empty when nothing happened', () => {
    expect(setupNotices(none)).toEqual([]);
  });

  it('shows each flagged notice with the pinned copy', () => {
    expect(setupNotices({ ...none, recoveredFromCorruption: true })).toEqual([
      'Settings file was damaged and reset. Check the printer and camera.',
    ]);
    expect(setupNotices({ ...none, uploadsDropped: true })).toEqual([
      'Some saved photo uploads could not be restored. Check the photos folder backup.',
    ]);
    expect(setupNotices({ recoveredFromCorruption: true, uploadsDropped: true, settingsUnreadable: true })).toEqual([
      SETTINGS_UNREADABLE_NOTICE,
      DAMAGED_SETTINGS_NOTICE,
      UPLOADS_DROPPED_NOTICE,
    ]);
  });
});
