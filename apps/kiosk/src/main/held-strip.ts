import { UUID_PATTERN } from '../shared/queue';
import type { HeldStrip } from '../shared/bridge';
import type { JsonStore, Normalized } from './json-store';
import { resolvePhotoReadPath } from './photos';

export const HELD_STRIP_FILE = 'held-strip.json';

export interface HeldStripFile {
  held: HeldStrip | null;
}

export const EMPTY_HELD_STRIP: HeldStripFile = { held: null };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates an untrusted held strip; the result carries only the three fields, with a resolved photo path. */
export function validateHeldStrip(v: unknown, photosDir: string): HeldStrip {
  if (
    !isObject(v) ||
    typeof v.sessionId !== 'string' ||
    !UUID_PATTERN.test(v.sessionId) ||
    typeof v.heldAt !== 'number' ||
    !Number.isFinite(v.heldAt)
  ) {
    throw new Error('Invalid held strip');
  }
  let filePath: string;
  try {
    filePath = resolvePhotoReadPath(photosDir, v.filePath);
  } catch {
    throw new Error('Invalid held strip');
  }
  return { sessionId: v.sessionId, filePath, heldAt: v.heldAt };
}

/** A file whose `held` is neither `null` nor valid is unusable as a whole (the store treats it as corrupt). */
export function normalizeHeldStripFile(photosDir: string): (v: unknown) => Normalized<HeldStripFile> | null {
  return (v) => {
    if (!isObject(v) || !('held' in v)) return null;
    if (v.held === null) return { value: { held: null }, dropped: 0 };
    try {
      return { value: { held: validateHeldStrip(v.held, photosDir) }, dropped: 0 };
    } catch {
      return null;
    }
  };
}

export function createHeldStripApi(store: JsonStore<HeldStripFile>, photosDir: string) {
  return {
    get(): HeldStrip | null {
      // A store that was write-blocked at startup may have recovered; re-read before answering.
      store.recheck();
      return store.get().held;
    },
    hold(h: unknown): void {
      const valid = validateHeldStrip(h, photosDir);
      // Checked inside update so they run against the freshly re-read file; a throw happens before any write.
      store.update((cur) => {
        if (cur.held?.sessionId === valid.sessionId) return cur;
        if (cur.held) throw new Error('A strip is already held');
        return { held: valid };
      });
    },
    /** Read-and-clear. Synchronous in the main process, so atomic; a failed write throws before anything is handed out. */
    claim(): HeldStrip | null {
      store.recheck();
      const held = store.get().held;
      if (!held) return null;
      store.update(() => ({ held: null }));
      return held;
    },
  };
}
