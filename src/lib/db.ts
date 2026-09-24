// IndexedDB 持久化（通过 idb）。无服务端，工程全部存本地。

import { openDB, type IDBPDatabase } from 'idb';
import type { SeatingProject } from '../types';

const DB_NAME = 'wedding-seating-offline';
const STORE = 'projects';
const VERSION = 1;

let dbp: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbp;
}

export async function saveProject(p: SeatingProject): Promise<void> {
  const d = await db();
  await d.put(STORE, { ...p, updatedAt: Date.now() });
}

export async function loadProject(id: string): Promise<SeatingProject | undefined> {
  const d = await db();
  return d.get(STORE, id);
}

export async function listProjects(): Promise<SeatingProject[]> {
  const d = await db();
  const all = await d.getAll(STORE);
  return (all as SeatingProject[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  await d.delete(STORE, id);
}

/** 导出为 JSON 文件（离线，不经过网络） */
export function downloadJson(p: SeatingProject): void {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${p.name || 'project'}-${new Date().toISOString().slice(0, 10)}.json`);
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
