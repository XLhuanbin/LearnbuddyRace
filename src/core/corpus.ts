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
  /** 当前语料集的方法 ID 集合（用于过滤关系） */
  scopeMethodIds: Set<string>;
  /** 论文数（预置 + 自传） */
  paperCount: number;
  /** 预置论文数 */
  presetPaperCount: number;
  /** 实验记录数（仅当前语料集的预置结果） */
  experimentCount: number;
  /** 分类实验数 */
  classificationCount: number;
}

/**
 * 计算「当前语料范围」：所有页面（导航、论文库、实验比较、方法关系）都必须用这里的数字。
 */
export function scopeCorpus(papers: Paper[], methods: Method[], key: CorpusKey, ownMethodIds?: Set<string>): CorpusScope {
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

  const scopeMethodIds = new Set<string>([...presetMethods, ...ownMethods].map((m) => m.id));
  if (ownMethodIds) for (const id of ownMethodIds) scopeMethodIds.add(id);

  const experiments = presetMethods.flatMap((m) => m.experiments ?? []);

  return {
    key,
    meta,
    presetPapers,
    presetMethods,
    ownPapers,
    ownMethods,
    foreignPapers,
    foreignMethods,
    scopeMethodIds,
    paperCount: presetPapers.length + ownPapers.length,
    presetPaperCount: presetPapers.length,
    experimentCount: experiments.length,
    classificationCount: experiments.filter((e) => e.taskTag === 'classification').length,
  };
}

/** 只保留与当前语料相关的关系（防止上一个语料集的关系残留） */
export function scopeRelations(relations: Relation[], scope: CorpusScope): Relation[] {
  return relations.filter((r) => scope.scopeMethodIds.has(r.fromMethodId) && scope.scopeMethodIds.has(r.toMethodId));
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
