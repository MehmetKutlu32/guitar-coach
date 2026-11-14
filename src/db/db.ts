/** IndexedDB üzerinde ince bir Promise katmanı. Sunucu yok; tüm veri cihazda kalır. */
export const DB_NAME = 'gitar-app';
const DB_VERSION = 1;

/**
 * Depolar:
 *  - kv:       anahtar/değer (ayarlar vb.)
 *  - sessions: pratik günlüğü kayıtları
 *  - results:  egzersiz sonuçları (`type` alanıyla ayrılır)
 *  - items:    kullanıcının içerikleri — kalıplar, akor dizileri, şarkılar, tablar (`type` alanıyla)
 *  - blobs:    ses kayıtları
 */
export const DATA_STORES = ['kv', 'sessions', 'results', 'items', 'blobs'] as const;
export type StoreName = (typeof DATA_STORES)[number];

export interface DbRecord {
  id: string;
  type?: string;
  /** Epoch ms. */
  date?: number;
  [key: string]: unknown;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      for (const name of DATA_STORES) {
        if (name === 'kv' || db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: 'id' });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('date', 'date', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await wrap((await store('kv', 'readonly')).get(key));
  return row ? (row.value as T) : undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await wrap((await store('kv', 'readwrite')).put({ key, value }));
}

export async function dbPut<T extends DbRecord>(name: Exclude<StoreName, 'kv'>, record: T): Promise<T> {
  await wrap((await store(name, 'readwrite')).put(record));
  return record;
}

export async function dbGet<T extends DbRecord>(name: Exclude<StoreName, 'kv'>, id: string): Promise<T | undefined> {
  return (await wrap((await store(name, 'readonly')).get(id))) as T | undefined;
}

export async function dbAll<T extends DbRecord>(name: Exclude<StoreName, 'kv'>, type?: string): Promise<T[]> {
  const s = await store(name, 'readonly');
  const rows = type === undefined ? await wrap(s.getAll()) : await wrap(s.index('type').getAll(type));
  return rows as T[];
}

export async function dbDelete(name: Exclude<StoreName, 'kv'>, id: string): Promise<void> {
  await wrap((await store(name, 'readwrite')).delete(id));
}

export async function dbClear(name: StoreName): Promise<void> {
  await wrap((await store(name, 'readwrite')).clear());
}

export interface ExportFile {
  app: 'gitar-app';
  format: 1;
  exportedAt: string;
  stores: Record<string, unknown[]>;
}

/** Tüm veriyi tek bir JSON nesnesi olarak döndürür. */
export async function exportAll(): Promise<ExportFile> {
  const stores: Record<string, unknown[]> = {};
  for (const name of DATA_STORES) {
    stores[name] = await wrap((await store(name, 'readonly')).getAll());
  }
  return { app: 'gitar-app', format: 1, exportedAt: new Date().toISOString(), stores };
}

export function isExportFile(data: unknown): data is ExportFile {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<ExportFile>;
  return d.app === 'gitar-app' && d.format === 1 && !!d.stores && typeof d.stores === 'object';
}

/** Dışa aktarılmış veriyi geri yükler; mevcut verinin yerine geçer. */
export async function importAll(data: unknown): Promise<void> {
  if (!isExportFile(data)) throw new Error('invalid-file');
  const db = await openDb();
  const names = DATA_STORES.filter((n) => Array.isArray(data.stores[n]));
  if (names.length === 0) throw new Error('invalid-file');
  const tx = db.transaction(names, 'readwrite');
  for (const name of names) {
    const s = tx.objectStore(name);
    s.clear();
    for (const row of data.stores[name]) {
      if (row && typeof row === 'object') s.put(row);
    }
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Yalnızca testler için: bağlantıyı kapatıp önbelleği sıfırlar. */
export async function closeDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}
