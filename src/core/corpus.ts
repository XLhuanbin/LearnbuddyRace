/**
 * 语料集身份与范围（本模块是「当前语料状态」的唯一来源）。
 *
 * 背景：早期版本的论文与方法是**不带语料集标识**的，导致：
 * - 左侧计数把不同语料集混在一起（5 篇 → 10 篇）；
 * - 旧 NLP 数据被静默计入正式视觉案例；
 * - 实验比较页出现「没有实验记录」但左侧显示有论文的错位。
 *
 * 因此这里规定：
 * 1. 每个语料集有稳定 ID（vision-classification / nlp-dev），用户自己上传的论文归 'user-import'；
 * 2. 论文 ID 由 arXiv 编号派生，天然稳定，可据此把无标识的历史数据归位；
 * 3. 所有页面计数都必须来自同一份「当前语料范围」，不得直接用全量数组长度。
 */

import type { CorpusId, Method, Paper, Relation } from './types';

export type CorpusKey = 'vision' | 'nlp-dev';

/**
 * 当前集合模式（研究地图与所有分析页面共用同一个模式）：
 * - 'case'：只允许当前案例的预置论文 / 方法 / 关系；
 * - 'own'：只允许用户自己上传（user-import）的论文 / 方法 / 关系。
 * 两种模式永远互斥，不叠加。
 */
export type ScopeMode = 'case' | 'own';

/**
 * 预置语料集定义。
 * ⚠️ arxivIds 必须与 `samples/vision-samples.json` / `samples/dev-samples.json` 保持一致，
 * `tests/core.test.ts` 里有断言防止漂移。
 */
export const CORPUS_META: Record<
  CorpusKey,
  { id: CorpusId; key: CorpusKey; label: string; domain: string; base: string; arxivIds: string[]; purpose: string }
> = {
  vision: {
    id: 'vision-classification',
    key: 'vision',
    label: '视觉方法演进案例',
    domain: 'ImageNet 图像分类',
    base: './samples-vision/',
    arxivIds: ['1512.03385', '2010.11929', '2012.12877', '2103.14030', '2201.03545'],
    purpose: '方法演进与实验公平比较',
  },
  'nlp-dev': {
    id: 'nlp-dev',
    key: 'nlp-dev',
    label: '开发回归样例',
    domain: 'NLP 预训练与微调',
    base: './samples/',
    arxivIds: ['1706.03762', '1810.04805', '1907.11692', '1910.01108', '2005.14165'],
    purpose: '开发流程回归验证（不代表正式选题）',
  },
};

export const paperIdOf = (arxivId: string) => `p_arxiv_${arxivId}`;

/** 预置论文 ID → 所属语料集（用于给历史数据归位） */
export function corpusOfPaperId(paperId: string): CorpusId {
  for (const meta of Object.values(CORPUS_META)) {
    if (meta.arxivIds.some((a) => paperIdOf(a) === paperId)) return meta.id;
  }
  return 'user-import';
}

export function corpusKeyOfId(id: CorpusId): CorpusKey | null {
  const hit = Object.values(CORPUS_META).find((m) => m.id === id);
  return hit ? hit.key : null;
}

export interface CorpusScope {
  key: CorpusKey;
  /** 当前集合模式：'case' 案例 / 'own' 我上传的论文 */
  mode: ScopeMode;
  meta: (typeof CORPUS_META)[CorpusKey];
  /** 当前语料集的预置论文 */
  presetPapers: Paper[];
  /** 用户自己上传/粘贴的论文（始终可见，但单独计数） */
  ownPapers: Paper[];
  /** 当前语料集的方法分析结果 */
  presetMethods: Method[];
  ownMethods: Method[];
  /** 其它语料集的残留数据（提示用户切换或清理，不计入上方数量） */
  foreignPapers: Paper[];
  foreignMethods: Method[];
  /**
   * === 唯一的当前分析范围 ===
   * 关系生成、跨论文比较、阅读路线、分歧分析、统计与导出都只能吃这两个数组，
   * 不得再把全量 papers / methods 送给模型或页面。
   */
  papers: Paper[];
  methods: Method[];
  /** 当前分析范围的方法 ID 集合（唯一的关系过滤依据） */
  scopeMethodIds: Set<string>;
  /** 论文数（预置 + 自传）：描述「当前集合」，与集合页一致 */
  paperCount: number;
  /** 预置论文数 */
  presetPaperCount: number;
  /** 实验记录数（只统计当前分析范围内的方法） */
  experimentCount: number;
  /** 分类实验数（只统计当前分析范围内的方法） */
  classificationCount: number;
}

/**
 * 计算「当前语料范围」：所有页面（导航、论文库、实验比较、方法关系）都必须用这里的数字。
 */
export function scopeCorpus(
  papers: Paper[],
  methods: Method[],
  key: CorpusKey,
  mode: ScopeMode = 'case',
  ownMethodIds?: Set<string>,
): CorpusScope {
  const meta = CORPUS_META[key];
  const inId = (id?: string) => (id ?? 'user-import') === meta.id;

  const presetPapers = papers.filter((p) => inId(p.corpusId));
  const presetMethods = methods.filter((m) => inId(m.corpusId));
  const ownPapers = papers.filter((p) => (p.corpusId ?? 'user-import') === 'user-import');
  const ownMethods = methods.filter((m) => (m.corpusId ?? 'user-import') === 'user-import');
  const foreignPapers = papers.filter((p) => {
    const c = p.corpusId ?? 'user-import';
    return c !== meta.id && c !== 'user-import';
  });
  const foreignMethods = methods.filter((m) => {
    const c = m.corpusId ?? 'user-import';
    return c !== meta.id && c !== 'user-import';
  });

  // 唯一的分析范围：案例模式只允许当前案例预置；我上传模式只允许 user-import。互斥，不叠加。
  const analysisPapers = mode === 'own' ? ownPapers : presetPapers;
  const analysisMethods = mode === 'own' ? ownMethods : presetMethods;

  const scopeMethodIds = new Set<string>(analysisMethods.map((m) => m.id));
  if (ownMethodIds) for (const id of ownMethodIds) scopeMethodIds.add(id);

  const experiments = analysisMethods.flatMap((m) => m.experiments ?? []);

  return {
    key,
    mode,
    meta,
    presetPapers,
    presetMethods,
    ownPapers,
    ownMethods,
    foreignPapers,
    foreignMethods,
    papers: analysisPapers,
    methods: analysisMethods,
    scopeMethodIds,
    paperCount: presetPapers.length + ownPapers.length,
    presetPaperCount: presetPapers.length,
    experimentCount: experiments.length,
    classificationCount: experiments.filter((e) => e.taskTag === 'classification').length,
  };
}

/** 只保留两端都在给定方法集合内的关系（防止上一个语料集/另一模式的关系残留） */
export function relationsInScope(relations: Relation[], methodIds: Set<string>): Relation[] {
  return relations.filter((r) => methodIds.has(r.fromMethodId) && methodIds.has(r.toMethodId));
}

/** 只保留与当前分析范围相关的关系 */
export function scopeRelations(relations: Relation[], scope: CorpusScope): Relation[] {
  return relationsInScope(relations, scope.scopeMethodIds);
}

/**
 * 人工关系：**用户实际改过或手工添加的**（`userEdited === true`）。
 *
 * ⚠️ 不要把 `aiOriginal` 也算进来。它是「AI 原始判定快照」，**普通 AI 关系也会有**
 * （关系生成时逐条写入，见 `model/analyze.ts`；实测 `public/samples-vision/index.json` 的
 * 10 条缓存关系全部带 `aiOriginal`、全部没有 `userEdited`）。用 `userEdited || aiOriginal`
 * 判定会把整批普通关系当成人工关系，后果是：
 * - 同 ID 的新结果一条也写不进库（`replaceRelationsInScope().write` 恒为空）；
 * - 旧的普通关系永远不会被按范围替换/删除。
 * `aiOriginal` 的正确用途只有两个：界面上展示「AI 原判定」、以及「恢复 AI 原判定」按钮。
 */
export function isManualRelation(r: Relation): boolean {
  return Boolean(r.userEdited);
}

/**
 * 按范围**原子替换**关系。
 *
 * 规则：
 * - 只替换「两端都属于 methodIds」的关系；
 * - 其它案例的关系、用户上传论文的关系一律原样保留；
 * - **当前范围内的人工关系也保留**（与「重新分析不覆盖人工修正」同一原则），
 *   且当新结果与人工关系 id 相同时，人工的版本优先。
 * 调用方负责把 `next` 写入存储。本函数是纯函数：不改动入参，写入失败时原数据仍是 `all`。
 *
 * **落库要注意**：必须写 `write` 而不是 `incoming`。直接写 incoming 会把「与人工关系撞 ID」
 * 的缓存版本写进库，把人工修正覆盖掉（内存里保住了、库里丢了，一刷新就现形）。
 * `deleteIds` 已经排除了 `write` 里的 ID，避免同一个 ID 在同一事务里先写后删。
 */
export function replaceRelationsInScope(
  all: Relation[],
  incoming: Relation[],
  methodIds: Set<string>,
): { keep: Relation[]; drop: Relation[]; next: Relation[]; write: Relation[]; deleteIds: string[] } {
  const outOfRange: Relation[] = [];
  const inRange: Relation[] = [];
  for (const r of all) {
    if (methodIds.has(r.fromMethodId) && methodIds.has(r.toMethodId)) inRange.push(r);
    else outOfRange.push(r);
  }
  const manual = inRange.filter(isManualRelation);
  const drop = inRange.filter((r) => !isManualRelation(r));
  const byId = new Map<string, Relation>();
  for (const r of outOfRange) byId.set(r.id, r);
  for (const r of manual) byId.set(r.id, r);
  const manualIds = new Set(manual.map((r) => r.id));
  const write: Relation[] = [];
  for (const r of incoming) {
    if (manualIds.has(r.id)) continue; // 人工修正优先：既不覆盖内存，也不写库
    byId.set(r.id, r);
    write.push(r);
  }
  const writeIds = new Set(write.map((r) => r.id));
  const deleteIds = drop.filter((r) => !writeIds.has(r.id)).map((r) => r.id);
  return { keep: [...outOfRange, ...manual], drop, next: [...byId.values()], write, deleteIds };
}

/**
 * 用缓存结果替换一条方法记录时，**保留用户的人工修正**。
 *
 * 案例加载（重新加载演示案例）会把预置方法按同 ID 覆盖写库。缓存里的方法永远没有
 * `overrides`，直接覆盖就会把用户逐字段核对过的修正丢掉（实测：重载后 overrides 1 → 0）。
 * 这里只保留「用户产生的东西」：人工修正记录；AI 字段值仍按缓存更新
 * （但要保证修正值本身还有效 —— `effectiveField` 会优先读修正值）。
 */
export function mergeCachedMethod(incoming: Method, prev?: Method): Method {
  if (!prev) return incoming;
  const overrides = prev.overrides ?? [];
  if (!overrides.length) return incoming;
  return { ...incoming, overrides };
}

/** 批量版本：按 id 找旧记录，逐个合并人工修正 */
export function mergeCachedMethods(incoming: Method[], prev: Method[]): Method[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  return incoming.map((m) => mergeCachedMethod(m, byId.get(m.id)));
}

/**
 * 删除一篇论文时应当一起清掉的东西：
 * 论文本体 + **该论文的全部方法**（按 paperId 找，不假设方法 ID 是 `m_${paperId}`）+ 这些方法参与的全部关系。
 * 返回新数组与「被删掉的东西」（用于撤销与写库）。
 */
export function collectPaperRemoval(
  papers: Paper[],
  methods: Method[],
  relations: Relation[],
  paperId: string,
): {
  papers: Paper[];
  methods: Method[];
  relations: Relation[];
  removedMethods: Method[];
  removedRelations: Relation[];
} {
  const removedMethods = methods.filter((m) => m.paperId === paperId);
  const removedIds = new Set(removedMethods.map((m) => m.id));
  const removedRelations = relations.filter((r) => removedIds.has(r.fromMethodId) || removedIds.has(r.toMethodId));
  return {
    papers: papers.filter((p) => p.id !== paperId),
    methods: methods.filter((m) => m.paperId !== paperId),
    relations: relations.filter((r) => !removedIds.has(r.fromMethodId) && !removedIds.has(r.toMethodId)),
    removedMethods,
    removedRelations,
  };
}

/**
 * 阅读路线 / 分歧结果 / 语料元信息这类「某个案例的分析产物」必须带上语料集身份，
 * 否则切换案例后刷新会显示上一个案例的结果。
 */
export interface ScopedSnapshot<T> {
  corpusId: CorpusId;
  payload: T;
}

export function asScopedSnapshot<T>(corpusId: CorpusId, payload: T): ScopedSnapshot<T> {
  return { corpusId, payload };
}

/**
 * 读取本机保存的分析产物：只有明确记录且语料集一致才复用。
 * 旧版本没有语料集标识的裸数据一律不复用（宁可显示「尚未生成」，也不显示别的案例的结论）。
 */
export function readScopedSnapshot<T>(stored: unknown, corpusId: CorpusId): T | undefined {
  if (!stored || typeof stored !== 'object') return undefined;
  const s = stored as Partial<ScopedSnapshot<T>>;
  if (!('corpusId' in s) || !('payload' in s)) return undefined;
  return s.corpusId === corpusId ? (s.payload as T) : undefined;
}

/** 历史数据归位：给没有 corpusId 的论文/方法补上稳定身份 */
export function legacyCorpusPatches(papers: Paper[], methods: Method[]): {
  papers: Paper[];
  methods: Method[];
} {
  const patchP: Paper[] = [];
  for (const p of papers) {
    if (!p.corpusId) patchP.push({ ...p, corpusId: corpusOfPaperId(p.id) });
  }
  const byPaper = new Map(patchP.map((p) => [p.id, p.corpusId]));
  const sidePapers = new Map(papers.map((p) => [p.id, p.corpusId]));
  const patchM: Method[] = [];
  for (const m of methods) {
    if (m.corpusId) continue;
    const fallback = byPaper.get(m.paperId) ?? sidePapers.get(m.paperId) ?? corpusOfPaperId(m.paperId);
    patchM.push({ ...m, corpusId: fallback });
  }
  return { papers: patchP, methods: patchM };
}
