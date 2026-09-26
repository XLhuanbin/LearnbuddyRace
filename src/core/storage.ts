/**
 * 持久化层（浏览器 IndexedDB）。
 *
 * 选择理由：部署目标（CloudStudio 静态站点）只支持纯前端，无后端与数据库；
 * IndexedDB 容量足够存全文与抽取结果，刷新后可恢复，满足交接文档 §4「保存」要求。
 * 存储层被隔离在此文件，若将来接入服务端，只需替换本模块实现。
 */

import type { Method, Paper, ReadingPlan, Relation } from './types';

const DB_NAME = 'researchpilot';
const DB_VERSION = 1;
const STORES = ['papers', 'methods', 'relations', 'plans', 'meta'] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 在同一事务里批量写同一个 store。
 *
 * 用途：关系「按范围原子替换」时先整批写新关系，再整批删旧关系。
 * 任一条写入失败 → 事务 abort → 整批回滚，不会留下半套数据（原数据仍然是原样）。
 */
async function txBatch(store: StoreName, ops: { kind: 'put' | 'delete'; value?: { id: string }; key?: string }[]): Promise<void> {
  if (!ops.length) return;
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const os = t.objectStore(store);
    for (const op of ops) {
      if (op.kind === 'put' && op.value) os.put(op.value);
      else if (op.kind === 'delete' && op.key) os.delete(op.key);
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('事务被中断'));
  });
}

export const db = {
  put: <T extends { id: string }>(store: StoreName, value: T) => tx<IDBValidKey>(store, 'readwrite', (s) => s.put(value)),
  get: <T>(store: StoreName, id: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(id)),
  delete: (store: StoreName, id: string) => tx<undefined>(store, 'readwrite', (s) => s.delete(id)),
  all: <T>(store: StoreName) => tx<T[]>(store, 'readonly', (s) => s.getAll()),
  clear: (store: StoreName) => tx<undefined>(store, 'readwrite', (s) => s.clear()),
  /** 批量写入（单事务，失败整批回滚） */
  putMany: <T extends { id: string }>(store: StoreName, values: T[]) =>
    txBatch(store, values.map((value) => ({ kind: 'put' as const, value }))),
  /** 批量删除（单事务，失败整批回滚） */
  deleteMany: (store: StoreName, keys: string[]) =>
    txBatch(store, keys.map((key) => ({ kind: 'delete' as const, key }))),
};

export const repo = {
  delete: (store: 'papers' | 'methods' | 'relations', id: string) => db.delete(store, id),
  async listPapers(): Promise<Paper[]> {
    const rows = await db.all<Paper>('papers');
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  },
  savePaper: (p: Paper) => db.put('papers', p),
  /** 批量删论文（单事务）：语料集幂等替换时移除被替换掉的旧论文 */
  deletePapers: (ids: string[]) => db.deleteMany('papers', ids),
  listMethods: () => db.all<Method>('methods'),
  saveMethod: (m: Method) => db.put('methods', m),
  /** 批量删方法（单事务）：移除论文时连同该论文的全部方法一起删 */
  deleteMethods: (ids: string[]) => db.deleteMany('methods', ids),
  listRelations: () => db.all<Relation>('relations'),
  saveRelation: (r: Relation) => db.put('relations', r),
  /** 批量写关系（单事务）：用于「按范围原子替换」，整批失败则全部回滚 */
  saveRelations: (rs: Relation[]) => db.putMany('relations', rs),
  /** 批量删关系（单事务）：只删被替换掉的旧关系 */
  deleteRelations: (ids: string[]) => db.deleteMany('relations', ids),
  clearRelations: () => db.clear('relations'),
  listPlans: () => db.all<ReadingPlan>('plans'),
  savePlan: (p: ReadingPlan & { id: string }) => db.put('plans', p),

  /** 按文件内容哈希查找已导入论文，避免重复上传重复消耗模型额度 */
  async findByHash(hash: string): Promise<Paper | undefined> {
    const all = await db.all<Paper>('papers');
    return all.find((p) => p.contentHash === hash);
  },

  async reset() {
    for (const s of STORES) {
      if (s === 'meta') continue;
      await db.clear(s);
    }
  },
};

/** 文件内容哈希（用于去重与复用分析） */
export async function hashFile(file: File | ArrayBuffer): Promise<string> {
  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 运行期配置（模型信息、使用记录）持久化 */
export interface AppMeta {
  id: string;
  key: string;
  value: unknown;
}

export async function saveMeta(key: string, value: unknown) {
  await db.put('meta', { id: key, key, value } as never);
}

export async function loadMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.get<AppMeta>('meta', key);
  return row?.value as T | undefined;
}

/** 真实使用记录：每次模型调用都落一条，作为 LearnBuddy 使用证据 */
export interface UsageRecord {
  id: string;
  at: number;
  kind: 'extract' | 'relations' | 'plan' | 'divergence';
  paperId?: string;
  model: string;
  ms: number;
  promptChars: number;
  completionChars: number;
  ok: boolean;
  error?: string;
}

export async function appendUsage(rec: Omit<UsageRecord, 'id' | 'at'>) {
  const list = (await loadMeta<UsageRecord[]>('usage')) || [];
  list.push({ ...rec, id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, at: Date.now() });
  // 只保留最近 500 条，避免无限增长
  await saveMeta('usage', list.slice(-500));
}
