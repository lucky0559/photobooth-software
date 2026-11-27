export type StoreName = 'meta' | 'blobs';

export interface KeyValueStore {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put<T>(store: StoreName, key: string, value: T): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  update<T>(store: StoreName, key: string, change: (current: T | undefined) => T): Promise<T>;
  entries<T>(store: StoreName): Promise<[string, T][]>;
}

interface ValueRecord {
  key: string;
  value: unknown;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser storage request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage transaction was aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser storage transaction failed'));
  });
}

export class IndexedDbStore implements KeyValueStore {
  private readonly dbPromise: Promise<IDBDatabase>;

  constructor(factory: IDBFactory, name = 'photobooth-kiosk-web', version = 1) {
    this.dbPromise = new Promise((resolve, reject) => {
      const request = factory.open(name, version);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not open browser storage'));
      request.onblocked = () => reject(new Error('Browser storage is busy in another tab; close other Photobooth tabs and reload'));
    });
  }

  async get<T>(storeName: StoreName, key: string): Promise<T | undefined> {
    const db = await this.dbPromise;
    const tx = db.transaction(storeName, 'readonly');
    const done = transactionDone(tx);
    const record = await requestValue(tx.objectStore(storeName).get(key)) as ValueRecord | undefined;
    await done;
    return record?.value as T | undefined;
  }

  async put<T>(storeName: StoreName, key: string, value: T): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(storeName, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(storeName).put({ key, value } satisfies ValueRecord);
    await done;
  }

  async delete(storeName: StoreName, key: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(storeName, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(storeName).delete(key);
    await done;
  }

  async update<T>(storeName: StoreName, key: string, change: (current: T | undefined) => T): Promise<T> {
    const db = await this.dbPromise;
    const tx = db.transaction(storeName, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(storeName);
    return new Promise<T>((resolve, reject) => {
      let next: T;
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const current = request.result as ValueRecord | undefined;
          next = change(current?.value as T | undefined);
          store.put({ key, value: next } satisfies ValueRecord);
        } catch (error) {
          reject(error);
          try { tx.abort(); } catch { /* transaction may already be inactive */ }
        }
      };
      request.onerror = () => reject(request.error ?? new Error('Browser storage request failed'));
      void done.then(() => resolve(next!), reject);
    });
  }

  async entries<T>(storeName: StoreName): Promise<[string, T][]> {
    const db = await this.dbPromise;
    const tx = db.transaction(storeName, 'readonly');
    const done = transactionDone(tx);
    const records = await requestValue(tx.objectStore(storeName).getAll()) as ValueRecord[];
    await done;
    return records.map((record) => [record.key, record.value as T]);
  }
}

export class MemoryStore implements KeyValueStore {
  private readonly values: Record<StoreName, Map<string, unknown>> = {
    meta: new Map(),
    blobs: new Map(),
  };

  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return this.values[store].get(key) as T | undefined;
  }

  async put<T>(store: StoreName, key: string, value: T): Promise<void> {
    this.values[store].set(key, value);
  }

  async delete(store: StoreName, key: string): Promise<void> {
    this.values[store].delete(key);
  }

  async update<T>(store: StoreName, key: string, change: (current: T | undefined) => T): Promise<T> {
    const next = change(this.values[store].get(key) as T | undefined);
    this.values[store].set(key, next);
    return next;
  }

  async entries<T>(store: StoreName): Promise<[string, T][]> {
    return [...this.values[store]].map(([key, value]) => [key, value as T]);
  }
}
