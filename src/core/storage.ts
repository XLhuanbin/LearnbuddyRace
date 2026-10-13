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
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
  dbPromise = p;
  /**
   * 打开失败（隐私模式禁用、配额异常、瞬时故障等）时清掉缓存，让**下一次操作可以重试**，
   * 而不是让整个会话永久卡在一个已 reject 的 Promise 上 —— 否则「刷新恢复」会彻底失效，
   * 后续所有读写都直接失败，用户看不到任何保存结果。
   */
  p.catch(() => {
    if (dbPromise === p) dbPromise = null;
  });
  return p;
}

/**
 * 单条请求 + **等事务真正提交**。
 *
 * ⚠️ 修复（P1，已用最小模拟复现）：旧实现在 `request.onsuccess` 就 resolve。
 * 而 IndexedDB 的 `onsuccess` 只表示「这条请求成功」，**事务仍然可能在此之后 abort**
 * （配额超限、其它写入冲突、浏览器隐私策略等）。实测症状：调用方的 Promise 已经
 * fulfilled、界面显示「保存成功」，但 `persisted = false` —— 刷新后数据没了。
 *
 * 因此这里：
 * 1. 请求成功时只**暂存** `request.result`；
 * 2. 只有 `transaction.oncomplete`（事务已提交）才 resolve；
 * 3. `error` / `abort` 一律 reject —— 上层不得据此显示「保存成功」。
 *
 * `settled` 守卫是必须的：事务出错时浏览器会**同时**派发 `error` 与 `abort`，
 * 不守卫就会重复 settle（第二次静默无效，但错误信息会丢掉更准的那一个）。
 */
async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let result: T | undefined;
    let settled = false;
    let t: IDBTransaction;
    try {
      t = db.transaction(store, mode);
    } catch (e) {
      reject(e instanceof Error ? e : new Error('IndexedDB 事务创建失败'));
      return;
    }
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err ?? 'IndexedDB 事务失败，数据未提交')));
    };
    const req = fn(t.objectStore(store));
    req.onsuccess = () => {
      result = req.result as T;
    };
    // 请求级错误：事务随后会 abort，这里不再单独 settle，避免出现「先 resolve 再 reject」的歧义
    req.onerror = () => {
      /* 由事务的 error/abort 统一处理 */
    };
    t.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(result as T);
    };
    t.onerror = () => fail(t.error ?? new Error('IndexedDB 事务失败，数据未提交'));
    t.onabort = () => fail(t.error ?? new Error('IndexedDB 事务被中断，数据未提交'));
  });
}

/**
 * 在同一事务里批量写同一个 store。
 *
 * 用途：关系「按范围原子替换」时先整批写新关系，再整批删旧关系。
 * 任一条写入失败 → 事务 abort → 整批回滚，不会留下半套数据（原数据仍然是原样）。
 */
/**
 * 在一个已开启的事务上挂统一的 settle 逻辑。
 *
 * 与上面 `tx()` 同样的守卫：事务出错时 `error` 与 `abort` 会**都**触发，
 * 不守卫就会出现「先 resolve 再 reject」（后一次静默失效，但错误信息丢了更准的那一个）。
 */
function settleTransaction(t: IDBTransaction, resolve: () => void, reject: (e: unknown) => void): void {
  let settled = false;
  const fail = (err: unknown) => {
    if (settled) return;
    settled = true;
    reject(err instanceof Error ? err : new Error('IndexedDB 事务被中断，数据未提交'));
  };
  t.oncomplete = () => {
    if (settled) return;
    settled = true;
    resolve();
  };
  t.onerror = () => fail(t.error ?? new Error('IndexedDB 事务失败，数据未提交'));
  t.onabort = () => fail(t.error ?? new Error('IndexedDB 事务被中断，数据未提交'));
}

async function txBatch(store: StoreName, ops: { kind: 'put' | 'delete'; value?: { id: string }; key?: string }[]): Promise<void> {
  if (!ops.length) return;
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(store, 'readwrite');
    } catch (e) {
      reject(e instanceof Error ? e : new Error('IndexedDB 事务创建失败'));
      return;
    }
    const os = t.objectStore(store);
    for (const op of ops) {
      if (op.kind === 'put' && op.value) os.put(op.value);
      else if (op.kind === 'delete' && op.key) os.delete(op.key);
    }
    settleTransaction(t, resolve, reject);
  });
}

/** 跨 store 事务里的一个操作 */
export type StoreOp =
  | { store: StoreName; kind: 'put'; value: { id: string } }
  | { store: StoreName; kind: 'delete'; key: string };

/**
 * **跨 store 的原子事务**。
 *
 * 用途：案例加载 = 论文 / 方法 / 关系的写入与删除必须在**同一个事务**里完成。
 * 旧实现是一条一条 `saveMethod`/`saveRelations`/`deleteRelations` 各自开事务：
 * 中途失败会留下「新数据写了一半、旧数据删了一半」的中间态，
 * 而且写入用的是原始缓存对象，会把同一 ID 上的人工修正覆盖掉。
 * 任一操作失败 → 整个事务 abort → 全部回滚，原数据保持原样。
 */
async function txApply(ops: StoreOp[]): Promise<void> {
  if (!ops.length) return;
  const db = await openDb();
  const stores = [...new Set(ops.map((o) => o.store))] as StoreName[];
  return new Promise<void>((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(stores, 'readwrite');
    } catch (e) {
      reject(e instanceof Error ? e : new Error('IndexedDB 事务创建失败'));
      return;
    }
    for (const op of ops) {
      const os = t.objectStore(op.store);
      if (op.kind === 'put') os.put(op.value);
      else os.delete(op.key);
    }
    settleTransaction(t, resolve, reject);
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
  /**
   * 关系的「写入 + 删除」放在**同一个事务**里完成（按范围原子替换的正确写法）。
   * 分两次调用会留下「新的写完了、旧的还没删」的中间态。
   */
  swapRelations: (puts: Relation[], deleteIds: string[]) =>
    txApply([
      ...puts.map((value) => ({ store: 'relations' as const, kind: 'put' as const, value })),
      ...deleteIds.map((key) => ({ store: 'relations' as const, kind: 'delete' as const, key })),
    ]),
  /** 跨 store 原子事务（案例加载：论文/方法/关系的写入与删除一起提交或一起回滚） */
  applyAtomic: (ops: StoreOp[]) => txApply(ops),
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

/**
 * 读取 meta，并可选用**运行时结构校验**兜底。
 *
 * 为什么要校验：meta store 里存的是 JSON，刷新恢复时直接 `as T` 断言，
 * 一旦本机数据被旧版本写坏（或手工改过），下游拿到结构不符的对象会在
 * `.map/.filter` 处抛错，表现为「打开页面白屏/恢复失败」而不是一条明确的提示。
 * 校验不通过时按「没有这份数据」处理（返回 undefined），宁可显示「尚未生成」，
 * 也不用坏数据冒充结论。
 */
export async function loadMeta<T>(key: string, validate?: (v: unknown) => boolean): Promise<T | undefined> {
  const row = await db.get<AppMeta>('meta', key);
  const value = row?.value;
  if (value === undefined || value === null) return undefined;
  if (validate && !validate(value)) return undefined;
  return value as T | undefined;
}

/**
 * **原子** read-modify-write：读取与写入放在**同一个事务**里。
 *
 * 背景（P2，已用最小模拟复现）：`appendUsage` 原来是 `loadMeta` → `push` → `saveMeta` 三个独立事务。
 * 两次并行调用会各自读到同一份旧列表，各自 push 后整份覆盖 —— 后写的把先写的整条覆盖掉，
 * 使用记录凭空丢失（这是「LearnBuddy 使用证据」的一部分，丢了就无法自证）。
 *
 * IndexedDB 对同一 store 的 readwrite 事务是**串行**的：第二次的读一定发生在第一次提交之后，
 * 因此放在同一事务里就不会互相覆盖。
 */
async function txUpdateMeta<T>(key: string, updater: (current: T | undefined) => T): Promise<T> {
  const dbh = await openDb();
  return new Promise<T>((resolve, reject) => {
    let next: T;
    let settled = false;
    let t: IDBTransaction;
    try {
      t = dbh.transaction('meta', 'readwrite');
    } catch (e) {
      reject(e instanceof Error ? e : new Error('IndexedDB 事务创建失败'));
      return;
    }
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error('IndexedDB 事务被中断，数据未提交'));
    };
    const os = t.objectStore('meta');
    const req = os.get(key);
    req.onsuccess = () => {
      const row = req.result as AppMeta | undefined;
      try {
        next = updater(row?.value as T | undefined);
      } catch (e) {
        // 更新函数抛错时主动 abort，避免事务悬着
        try {
          t.abort();
        } catch {
          /* ignore */
        }
        fail(e);
        return;
      }
      os.put({ id: key, key, value: next } as never);
    };
    t.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(next);
    };
    t.onerror = () => fail(t.error ?? new Error('IndexedDB 事务失败，数据未提交'));
    t.onabort = () => fail(t.error ?? new Error('IndexedDB 事务被中断，数据未提交'));
  });
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

/** 使用记录最多保留的条数（避免无限增长） */
const MAX_USAGE_RECORDS = 500;

/** 使用记录的运行时结构校验：坏数据按「没有」处理，不让一条脏记录带崩整个状态页 */
export function isUsageRecordList(v: unknown): v is UsageRecord[] {
  if (!Array.isArray(v)) return false;
  return v.every((x) => {
    if (!x || typeof x !== 'object') return false;
    const r = x as Partial<UsageRecord>;
    return typeof r.id === 'string' && typeof r.at === 'number' && typeof r.kind === 'string';
  });
}

/**
 * 追加一条使用记录（**并发安全**）。
 *
 * 见 `txUpdateMeta` 的说明：读与写在同一事务里完成，两次并行调用不会互相覆盖。
 * 裁剪（只留最近 N 条）也在同一事务里做，避免「先读到 500 条再各自裁剪」的竞态。
 */
export async function appendUsage(rec: Omit<UsageRecord, 'id' | 'at'>): Promise<UsageRecord[]> {
  return txUpdateMeta<UsageRecord[]>('usage', (current) => {
    const list = isUsageRecordList(current) ? [...current] : [];
    list.push({
      ...rec,
      id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
    });
    return list.slice(-MAX_USAGE_RECORDS);
  });
}
