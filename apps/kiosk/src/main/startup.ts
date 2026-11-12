import type { LocalConfig } from '../shared/bridge';
import type { JsonStore } from './json-store';
import type { QueueFile } from './queue-store';

/**
 * Persists the staff notices raised while loading the stores (shown on Setup until Setup completes).
 * Never throws: a full disk or an unwritable config must not stop the kiosk window from opening.
 */
export function applyStartupNotices(config: JsonStore<LocalConfig>, queue: Pick<JsonStore<QueueFile>, 'droppedEntries'>): void {
  const patch: Partial<LocalConfig> = {};
  if (config.recoveredFromCorruption) patch.recoveredFromCorruption = true;
  if (queue.droppedEntries > 0) patch.uploadsDropped = true;
  if (Object.keys(patch).length === 0 || config.writeBlocked) return;
  try {
    config.update((c) => ({ ...c, ...patch }));
  } catch (err) {
    console.error('Saving startup notices failed', err);
  }
}

/** After `queue.json` became readable mid-run: flag dropped entries for the Setup notice. Never throws. */
export function flagDroppedUploads(config: JsonStore<LocalConfig>, queue: Pick<JsonStore<QueueFile>, 'droppedEntries'>): void {
  if (queue.droppedEntries === 0 || config.get().uploadsDropped) return;
  try {
    config.update((c) => ({ ...c, uploadsDropped: true }));
  } catch (err) {
    console.error('Saving startup notices failed', err);
  }
}
