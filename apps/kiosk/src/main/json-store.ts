import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface JsonStore<T> {
  get(): T;
  update(fn: (t: T) => T): T;
}

function load<T extends object>(filePath: string, defaults: T): T {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return defaults;
    return { ...defaults, ...(parsed as Partial<T>) };
  } catch {
    // Missing or unreadable file: start from defaults. A leftover `<file>.tmp`
    // from an interrupted write is never read; the next update overwrites it.
    return defaults;
  }
}

/** Small synchronous JSON file store. Writes go to `<file>.tmp` and are then renamed over `<file>`. */
export function createJsonStore<T extends object>(filePath: string, defaults: T): JsonStore<T> {
  mkdirSync(dirname(filePath), { recursive: true });
  let current = load(filePath, defaults);
  return {
    get: () => current,
    update(fn) {
      const next = fn(current);
      const tmp = `${filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(next, null, 2));
      renameSync(tmp, filePath);
      current = next;
      return next;
    },
  };
}
