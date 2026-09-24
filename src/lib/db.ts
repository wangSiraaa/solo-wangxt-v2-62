// ───────────────────────────────────────────────────────────────────────────
// IndexedDB 持久化（完全离线，无服务端）
//
// store 设计：
//   projects  —— 工程（场地、桌子、宾客、关系、偏好、座位分配）
//   dietary   —— 忌口记录独立存储，按 guestId 建索引。
//                 换座只改 assignments，永远不会动到 dietary；
//                 即使座位分配被重置/重新自动排座，导出桌卡仍能取到忌口。
// ───────────────────────────────────────────────────────────────────────────

import type { DietaryRestriction, WeddingProject } from '../types';

const DB_NAME = 'wedding-seating-planner';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_DIETARY = 'dietary';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_DIETARY)) {
        const store = db.createObjectStore(STORE_DIETARY, { keyPath: 'id' });
        store.createIndex('byGuest', 'guestId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const req = fn(t.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const db = {
  async saveProject(project: WeddingProject): Promise<void> {
    const record = { ...project, updatedAt: Date.now() };
    // 项目记录里保留一份 dietary 仅作内存视图便利；权威副本在独立 store。
    // 写 projects 时不覆盖 dietary store，避免换座保存意外牵连忌口。
    await tx(STORE_PROJECTS, 'readwrite', (s) => s.put(record));
  },

  async loadProject(id: string): Promise<WeddingProject | undefined> {
    return tx<WeddingProject | undefined>(STORE_PROJECTS, 'readonly', (s) =>
      s.get(id),
    );
  },

  async listProjects(): Promise<WeddingProject[]> {
    return tx<WeddingProject[]>(STORE_PROJECTS, 'readonly', (s) =>
      s.getAll() as IDBRequest<WeddingProject[]>,
    );
  },

  async deleteProject(id: string): Promise<void> {
    await tx(STORE_PROJECTS, 'readwrite', (s) => s.delete(id));
  },

  // ── 忌口：独立 CRUD ──────────────────────────────────────────────────────
  async saveDietary(records: DietaryRestriction[]): Promise<void> {
    const database = await openDB();
    await new Promise<void>((resolve, reject) => {
      const t = database.transaction(STORE_DIETARY, 'readwrite');
      const store = t.objectStore(STORE_DIETARY);
      for (const r of records) store.put(r);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  async upsertDietary(record: DietaryRestriction): Promise<void> {
    await tx(STORE_DIETARY, 'readwrite', (s) => s.put(record));
  },

  async deleteDietary(id: string): Promise<void> {
    await tx(STORE_DIETARY, 'readwrite', (s) => s.delete(id));
  },

  async loadAllDietary(): Promise<DietaryRestriction[]> {
    return tx<DietaryRestriction[]>(STORE_DIETARY, 'readonly', (s) =>
      s.getAll() as IDBRequest<DietaryRestriction[]>,
    );
  },

  async loadDietaryFor(guestId: string): Promise<DietaryRestriction[]> {
    const database = await openDB();
    return new Promise<DietaryRestriction[]>((resolve, reject) => {
      const t = database.transaction(STORE_DIETARY, 'readonly');
      const idx = t.objectStore(STORE_DIETARY).index('byGuest');
      const req = idx.getAll(guestId) as IDBRequest<DietaryRestriction[]>;
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
};
