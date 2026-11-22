// IndexedDB 封装: 管线数据 / 开挖方案 / 姿态录像
import type { ExcavationPlan, PipePoint, PipeSegment, PoseRecording } from '../domain/types';

const DB_NAME = 'pipe-xray-db';
const DB_VERSION = 2;
const STORES = ['points', 'segments', 'plans', 'recordings', 'meta', 'issues'] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

async function clear(store: StoreName): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

async function putAll<T extends { id: string }>(store: StoreName, rows: T[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const row of rows) s.put(row);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

async function getAll<T>(store: StoreName): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

export const db = {
  async savePipeline(points: PipePoint[], segments: PipeSegment[]): Promise<void> {
    await clear('points');
    await clear('segments');
    await putAll('points', points);
    await putAll('segments', segments);
    await tx('meta', 'readwrite', (s) =>
      s.put({ id: 'pipeline', updatedAt: Date.now(), pointCount: points.length, segmentCount: segments.length })
    );
  },

  loadPoints: () => getAll<PipePoint>('points'),
  loadSegments: () => getAll<PipeSegment>('segments'),

  async hasData(): Promise<boolean> {
    const count = await tx<number>('points', 'readonly', (s) => s.count());
    return count > 0;
  },

  listPlans: () => getAll<ExcavationPlan>('plans'),
  savePlan: (plan: ExcavationPlan) =>
    tx<IDBValidKey>('plans', 'readwrite', (s) => s.put(plan)).then(() => undefined),
  deletePlan: (id: string) =>
    tx<undefined>('plans', 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>),

  listRecordings: () => getAll<PoseRecording>('recordings'),
  saveRecording: (r: PoseRecording) =>
    tx<IDBValidKey>('recordings', 'readwrite', (s) => s.put(r)).then(() => undefined),
  deleteRecording: (id: string) =>
    tx<undefined>('recordings', 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>),

  saveIssues: (rows: import('../domain/types').ValidationIssue[], inferredCount: number) =>
    new Promise<void>((resolve, reject) => {
      openDb().then((db) => {
        const t = db.transaction('issues', 'readwrite');
        const s = t.objectStore('issues');
        s.clear();
        rows.forEach((row, i) => s.put({ id: `ISS-${i}`, ...row }));
        s.put({ id: '__inferredCount', value: inferredCount });
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    }),
  loadIssues: async (): Promise<{ issues: import('../domain/types').ValidationIssue[]; inferredCount: number }> => {
    const rows = await getAll<{ id: string; value?: number } & import('../domain/types').ValidationIssue>('issues');
    const inferred = rows.find((r) => r.id === '__inferredCount')?.value ?? 0;
    return {
      issues: rows.filter((r) => r.id !== '__inferredCount').map(({ id: _id, ...rest }) => rest),
      inferredCount: inferred
    };
  }
};
