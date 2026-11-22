import * as nodeFs from 'node:fs';
import { basename, dirname, join } from 'node:path';

export interface JsonStore<T> {
  get(): T;
  /** Throws (without touching the file) when `writeBlocked`. */
  update(fn: (t: T) => T): T;
  /** The file could not be parsed/normalized; it was backed up to `<file>.corrupt-<ms>` and defaults loaded. */
  readonly recoveredFromCorruption: boolean;
  /** Entries the normalizer dropped on load (the original was copied to `<file>.dropped-<ms>`). */
  readonly droppedEntries: number;
  /**
   * The file exists but could not be read, or was corrupt and could not be backed up: defaults are used
   * for this run and nothing is ever written over it.
   */
  readonly writeBlocked: boolean;
  /**
   * While write-blocked, re-attempts the read (and normalize/backup); returns true once usable. `update`
   * does this itself. No-op (true) when not blocked.
   */
  recheck(): boolean;
}

/** Result of a load-time normalizer: the value to use, and how many invalid entries it dropped. */
export interface Normalized<T> {
  value: T;
  dropped: number;
}

type StoreFs = Pick<
  typeof nodeFs,
  'readFileSync' | 'writeFileSync' | 'renameSync' | 'readdirSync' | 'rmSync' | 'mkdirSync' | 'openSync' | 'writeSync' | 'fsyncSync' | 'closeSync'
>;

export interface JsonStoreOptions<T> {
  /**
   * Checks and repairs the loaded value (already merged over defaults). Return `null` when the file
   * as a whole is unusable (counts as corrupt); otherwise drop invalid entries and report how many.
   */
  normalize?: (value: unknown) => Normalized<T> | null;
  /** Clock for backup names (tests). */
  now?: () => number;
  /** Blocking pause before retrying a failed read (tests). */
  sleep?: (ms: number) => void;
  /** File system overrides (tests). */
  fs?: Partial<StoreFs>;
  /** Called after a write-blocked store became usable again (not on the initial load). */
  onRecovered?: () => void;
}

/** Corrupt-file backups (and dropped-entry copies) kept per store; older ones are deleted. */
export const MAX_CORRUPT_BACKUPS = 3;
const READ_RETRY_MS = 50;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

type WriteFn = (fd: number, buf: Buffer, offset: number, length: number) => number;

/** Writes all of `buf` to `fd`, looping over partial writes. */
export function writeAll(fd: number, buf: Buffer, write: WriteFn): void {
  let off = 0;
  while (off < buf.length) {
    const n = write(fd, buf, off, buf.length - off);
    if (!(n > 0)) throw new Error('write made no progress');
    off += n;
  }
}

type Loaded<T> =
  | { kind: 'ok'; value: T; dropped: number; text: string }
  | { kind: 'missing' }
  | { kind: 'read-error' }
  | { kind: 'corrupt'; text: string | null };

/**
 * Small synchronous JSON file store. Writes go to `<file>.tmp` (all bytes, fsynced), are renamed over
 * `<file>`, then the directory is fsynced where supported, so a power cut leaves either the old or the
 * new file, never an empty one. A leftover `.tmp` is never read.
 *
 * Loading: a missing file means defaults. A read error is retried once after 50 ms; if it persists the
 * store uses defaults and refuses to write (the original is never overwritten) until a later `update` or
 * `recheck` finds the file readable again (self-heal: it then loads it and carries on). A file that
 * cannot be parsed or normalized is backed up to `<file>.corrupt-<ms>` (renamed, or copied if the rename
 * fails) and defaults are used; if no backup can be made, writes are refused. Newest 3 backups are kept.
 */
export function createJsonStore<T extends object>(filePath: string, defaults: T, options: JsonStoreOptions<T> = {}): JsonStore<T> {
  const fs: StoreFs = { ...nodeFs, ...options.fs };
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepSync;
  const dir = dirname(filePath);
  const name = basename(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const readText = (): { text: string } | { code: string | undefined } => {
    try {
      return { text: fs.readFileSync(filePath, 'utf8') };
    } catch (err) {
      return { code: (err as NodeJS.ErrnoException).code };
    }
  };

  const load = (): Loaded<T> => {
    let r = readText();
    if ('code' in r && r.code === 'EISDIR') return { kind: 'corrupt', text: null };
    if ('code' in r && r.code !== 'ENOENT') {
      sleep(READ_RETRY_MS);
      r = readText();
    }
    if ('code' in r) {
      if (r.code === 'ENOENT') return { kind: 'missing' };
      if (r.code === 'EISDIR') return { kind: 'corrupt', text: null };
      return { kind: 'read-error' };
    }
    const { text } = r;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { kind: 'corrupt', text };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'corrupt', text };
    const merged = { ...defaults, ...(parsed as Partial<T>) };
    if (!options.normalize) return { kind: 'ok', value: merged, dropped: 0, text };
    const n = options.normalize(merged);
    return n ? { kind: 'ok', value: n.value, dropped: n.dropped, text } : { kind: 'corrupt', text };
  };

  const prune = (prefix: string): void => {
    try {
      const stamp = (f: string): number => Number(f.slice(prefix.length)) || 0;
      const old = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(prefix))
        .sort((a, b) => stamp(a) - stamp(b));
      for (const f of old.slice(0, Math.max(0, old.length - MAX_CORRUPT_BACKUPS))) fs.rmSync(join(dir, f), { recursive: true, force: true });
    } catch {
      // Pruning is best effort.
    }
  };

  /** Backs up a corrupt file without ever losing it; returns false if no backup could be made. */
  const backUpCorrupt = (text: string | null): boolean => {
    const backup = `${filePath}.corrupt-${now()}`;
    let ok = false;
    try {
      fs.renameSync(filePath, backup);
      ok = true;
    } catch {
      if (text !== null) {
        try {
          fs.writeFileSync(backup, text);
          ok = true;
        } catch {
          // No backup possible.
        }
      }
    }
    prune(`${name}.corrupt-`);
    return ok;
  };

  let current = defaults;
  let recovered = false;
  let dropped = 0;
  let blocked = false;

  /** (Re)loads the file into the store state. Logs only when the state changes (no log spam while retrying). */
  const loadInto = (): void => {
    const wasBlocked = blocked;
    const loaded = load();
    blocked = false;
    switch (loaded.kind) {
      case 'ok':
        current = loaded.value;
        dropped = loaded.dropped;
        if (dropped > 0) {
          console.error(`json-store: ${name}: dropped ${dropped} invalid entries (original kept as a .dropped copy)`);
          try {
            fs.writeFileSync(`${filePath}.dropped-${now()}`, loaded.text);
          } catch {
            console.error(`json-store: ${name}: could not keep a copy of the dropped entries`);
          }
          prune(`${name}.dropped-`);
        }
        break;
      case 'read-error':
        if (!wasBlocked) console.error(`json-store: ${name} could not be read; using defaults for this run without saving`);
        current = defaults;
        blocked = true;
        break;
      case 'corrupt':
        if (!wasBlocked) console.error(`json-store: ${name} is unreadable or invalid; moved it aside and reset to defaults`);
        current = defaults;
        if (backUpCorrupt(loaded.text)) recovered = true;
        else {
          if (!wasBlocked) console.error(`json-store: could not back up ${name}; using defaults for this run without saving`);
          blocked = true;
        }
        break;
      case 'missing':
        current = defaults;
        break;
    }
    if (wasBlocked && !blocked) console.error(`json-store: ${name} is usable again`);
  };
  loadInto();

  /** While write-blocked, tries the read (and normalize/backup) again; returns true once the store is usable. */
  const recheck = (): boolean => {
    if (!blocked) return true;
    loadInto();
    if (blocked) return false;
    options.onRecovered?.();
    return true;
  };

  const writeDurably = (path: string, data: string): void => {
    const fd = fs.openSync(path, 'w');
    try {
      writeAll(fd, Buffer.from(data, 'utf8'), (f, b, o, l) => fs.writeSync(f, b, o, l));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  };

  /** Flushes the rename to disk where the platform supports directory fsync (not on Windows). */
  const fsyncDir = (): void => {
    let fd: number | undefined;
    try {
      fd = fs.openSync(dir, 'r');
      fs.fsyncSync(fd);
    } catch {
      // Unsupported here; the file itself is already flushed.
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  };

  return {
    get: () => current,
    update(fn) {
      // Self-heal: a lock that outlasted the startup retry may be gone by now.
      if (!recheck()) throw new Error(`${name} could not be read; not saving so it is not overwritten. Restart the kiosk.`);
      const next = fn(current);
      const tmp = `${filePath}.tmp`;
      writeDurably(tmp, JSON.stringify(next, null, 2));
      fs.renameSync(tmp, filePath);
      fsyncDir();
      current = next;
      return next;
    },
    recheck,
    get recoveredFromCorruption() {
      return recovered;
    },
    get droppedEntries() {
      return dropped;
    },
    get writeBlocked() {
      return blocked;
    },
  };
}
