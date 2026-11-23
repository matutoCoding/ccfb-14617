// IndexedDB 持久化：管线数据、开挖方案、姿态录制

const DB_NAME = 'ug-pipe-xray';
const DB_VERSION = 1;

export const STORES = {
  points: 'points',
  segments: 'segments',
  plans: 'plans',
  recordings: 'recordings',
  meta: 'meta',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORES.points)) db.createObjectStore(STORES.points, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.segments)) db.createObjectStore(STORES.segments, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.plans)) db.createObjectStore(STORES.plans, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.recordings)) db.createObjectStore(STORES.recordings, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export async function idbPutAll<T>(store: string, items: T[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const it of items) s.put(it);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function idbClear(store: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export function idbGetAll<T>(store: string): Promise<T[]> {
  return tx(store, 'readonly', s => s.getAll() as IDBRequest<T[]>);
}

export function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return tx(store, 'readonly', s => s.get(key) as IDBRequest<T | undefined>);
}

export function idbPut<T>(store: string, value: T, key?: IDBValidKey): Promise<IDBValidKey> {
  return tx(store, 'readwrite', s => (key === undefined ? s.put(value) : s.put(value, key)));
}

export function idbDelete(store: string, key: IDBValidKey): Promise<undefined> {
  return tx(store, 'readwrite', s => s.delete(key));
}
