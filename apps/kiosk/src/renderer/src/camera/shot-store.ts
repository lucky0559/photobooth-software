export interface ShotStore {
  put(blob: Blob): string;
  get(id: string): Blob | undefined;
  clear(): void;
  size(): number;
}

/** In-memory store for the current session's captured frames. Shot ids go into `KioskState.shots`. */
export function createShotStore(): ShotStore {
  const shots = new Map<string, Blob>();
  return {
    put(blob) {
      const id = crypto.randomUUID();
      shots.set(id, blob);
      return id;
    },
    get: (id) => shots.get(id),
    clear: () => shots.clear(),
    size: () => shots.size,
  };
}

export const shotStore: ShotStore = createShotStore();
