import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export interface JsonStore<T> {
  get(): T;
  update(fn: (t: T) => T): T;
  /** The file existed but was unreadable/invalid; defaults were loaded and the file moved to `<file>.corrupt-<ms>` (best effort). */
  readonly recoveredFromCorruption: boolean;
}

export interface JsonStoreOptions<T> {
  /** Shape check of the loaded value (merged over defaults). Failing counts as a corrupt file. */
  validate?: (value: unknown) => value is T;
  /** Clock for backup names (tests). */
  now?: () => number;
}

/** Corrupt-file backups kept per store; older ones are deleted. */
export const MAX_CORRUPT_BACKUPS = 3;

type Loaded<T> = { kind: 'ok'; value: T } | { kind: 'missing' } | { kind: 'corrupt' };

function read<T extends object>(filePath: string, defaults: T, validate?: (v: unknown) => v is T): Loaded<T> {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'missing' } : { kind: 'corrupt' };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'corrupt' };
    const merged = { ...defaults, ...(parsed as Partial<T>) };
    if (validate && !validate(merged)) return { kind: 'corrupt' };
    return { kind: 'ok', value: merged };
  } catch {
    return { kind: 'corrupt' };
  }
}

/** Moves a corrupt file aside (never overwriting the evidence) and keeps only the newest backups. */
function backUpCorrupt(filePath: string, now: number): boolean {
  const dir = dirname(filePath);
  const prefix = `${basename(filePath)}.corrupt-`;
  let moved = false;
  try {
    renameSync(filePath, `${filePath}.corrupt-${now}`);
    moved = true;
  } catch {
    // Could not move it; defaults are still used, and the next write replaces it.
  }
  try {
    const stamp = (name: string): number => Number(name.slice(prefix.length)) || 0;
    const old = readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .sort((a, b) => stamp(a) - stamp(b));
    for (const name of old.slice(0, Math.max(0, old.length - MAX_CORRUPT_BACKUPS))) {
      rmSync(join(dir, name), { recursive: true, force: true });
    }
  } catch {
    // Pruning is best effort.
  }
  return moved;
}

/** Writes `data` to `path` and flushes it to disk before returning. */
function writeDurably(path: string, data: string): void {
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Flushes a directory entry (the rename) to disk where the platform supports it (not on Windows). */
function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch {
    // Unsupported here; the file itself is already flushed.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Small synchronous JSON file store. Writes go to `<file>.tmp`, are fsynced, then renamed over `<file>`,
 * so a power cut leaves either the old or the new file, never an empty one. A leftover `.tmp` is never read.
 * A file that exists but cannot be read, parsed or validated is moved to `<file>.corrupt-<ms>` (newest
 * 3 kept) and the store starts from defaults.
 */
export function createJsonStore<T extends object>(filePath: string, defaults: T, options: JsonStoreOptions<T> = {}): JsonStore<T> {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const loaded = read(filePath, defaults, options.validate);
  let current = loaded.kind === 'ok' ? loaded.value : defaults;
  // Set even if the backup could not be made: a reset must never go unnoticed.
  const recovered = loaded.kind === 'corrupt';
  if (recovered) {
    console.error(`json-store: ${basename(filePath)} is unreadable or invalid; moved it aside and reset to defaults`);
    if (!backUpCorrupt(filePath, (options.now ?? Date.now)())) console.error(`json-store: could not back up ${basename(filePath)}`);
  }
  return {
    get: () => current,
    update(fn) {
      const next = fn(current);
      const tmp = `${filePath}.tmp`;
      writeDurably(tmp, JSON.stringify(next, null, 2));
      renameSync(tmp, filePath);
      fsyncDir(dir);
      current = next;
      return next;
    },
    recoveredFromCorruption: recovered,
  };
}
