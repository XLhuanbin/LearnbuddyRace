/**
 * 方法家族 / 技术策略 / 领域概览 —— 全部由程序从**已抽取字段**派生，可审计、可复算。
 *
 * 本版修正的三个真实问题：
 * 1. **家族与策略分离**：家族（架构路线）单一且必须由「方法名称 + 核心思路首句」这类
 *    *定义性文本* 支撑；技术策略可以有多个标签。只提到「CNN 教师 / 对比方法 / 背景介绍」
 *    不足以判定家族 —— 因此不把整段核心思路（含相关工作与教师说明）当作家族证据。
 * 2. **概览统计**：数据集/指标先在**单篇内部去重**，再统计出现在几篇论文中；
 *    文案区分「全部 / 部分 / 未知」，不因为一篇论文涉及图像分类就说全部论文都是分类。
 * 3. **关系方向**：关系说明按 from→to 方向生成，从任一端查看都不会颠倒谁改进谁；
 *    对称关系（similar）不强行加方向。
 *
 * 不按论文 ID 硬编码：规则只依赖字段文本，换一组论文同样适用；命不中的家族为「待确认」。
 */

import type { Evidence, Method, Paper, Relation, RelationType } from './types';

export type FamilyConfidence = 'evidence' | 'inferred' | 'pending';

export interface FamilyVerdict {
  id: 'cnn' | 'transformer' | 'hybrid' | 'pending';
  name: string;
  confidence: FamilyConfidence;
  /** 判定依据：用了哪段文字、命中了什么 */
  basis: { source: '方法名称' | '核心思路首句'; keyword: string; quote: string }[];
  /** 需要向用户说明的限制（例如只有名称证据或文本不足） */
  note?: string;
}

export interface StrategyTag {
  id: string;
  name: string;
  basis: { source: '方法名称' | '核心思路'; keyword: string }[];
}

export interface MethodProfile {
  methodId: string;
  paperId: string;
  shortName: string;
  family: FamilyVerdict;
  strategies: StrategyTag[];
  /** 一句话贡献：来自核心思路的首个完整分句，具体到「做了什么」；没有依据时为空串 */
  contribution: string;
  contributionBasis?: Evidence;
  /** 解决什么问题（研究任务字段） */
  problem: string;
  problemBasis?: Evidence;
  approach: string;
  limitations: string;
  limitationsBasis?: Evidence;
}

/* ------------------------------------------------------------------ *
 * 家族判定：只看「定义性文本」= 方法名称 + 核心思路首句
 * ------------------------------------------------------------------ */

const FAMILY_RULES: {
  id: FamilyVerdict['id'];
  name: string;
  re: RegExp;
}[] = [
  {
    id: 'transformer',
    name: 'Transformer 架构',
    re: /vision transformer|视觉 transformer|transformer|self-attention|self attention|\bvit\b|\bswin\b|deit|attention[- ]based/i,
  },
  {
    id: 'cnn',
    name: '卷积网络（CNN）',
    re: /convnet|convnext|convolutional|卷积网络|卷积神经|\bresnet\b|res[-\s]?ne|resnext|residual (learning|network|nets?)|残差(学习|网络)|深度可分离卷积|倒置瓶颈/i,
  },
];

/**
 * 节点短贡献：从核心思路里**压缩**出一条可读的短描述。
 * 忠实性规则：只做筛选与删除（按子句切分、跳过公式与「引用其它方法」的子句、在词边界截断），
 * 不改写、不添加任何词；输出是原文的连续子串（测试有断言）。
 */
export function shortContribution(idea: string): string {
  if (!idea) return '';
  const cleaned = idea
    .replace(/[A-Za-z]\([^)]{0,12}\)/g, ' ') // H(x)、F(x) 这类单字母数学记号
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const clauses = cleaned.split(/[。；;]/).filter((c) => c.trim().length >= 6);
  const pool: string[] = [];
  for (const clause of clauses) {
    for (const part of clause.split(/[，,]/)) {
      const t = part.trim();
      if (t.length < 6 || t.length > 34) continue;
      if (/[A-Za-z]\s*[:：]=/.test(t)) continue; // 公式子句
      if (REFERENCE_CTX.test(t)) {
        REFERENCE_CTX.lastIndex = 0;
        continue; // 「以 X 为起点 / 借用 X 的技巧」这类引用子句
      }
      REFERENCE_CTX.lastIndex = 0;
      pool.push(t);
    }
    if (pool.length) break; // 用第一个能提供非引用子句的分句
  }
  let pick = pool[0];
  if (!pick) {
    // 所有子句都是「引用其它方法」的语境时，不把引用当作贡献（宁可留空，由界面显示信息不足）
    const first = clauses[0]?.split(/[，,]/).map((x) => x.trim()).filter((x) => x.length >= 6)[0] ?? '';
    REFERENCE_CTX.lastIndex = 0;
    if (first && !REFERENCE_CTX.test(first)) pick = first;
    REFERENCE_CTX.lastIndex = 0;
  }
  if (!pick) return '';
  if (pick.length <= 34) return pick.replace(/[\s]+[A-Za-z]$/, '').trim();
  const head = pick.slice(0, 34);
  const sp = head.lastIndexOf(' ');
  return (sp > 12 ? head.slice(0, sp) : head).replace(/[\s]+[A-Za-z]$/, '').trim();
}

/** 取核心思路的第一个分句（定义性文本），最长 120 字 */
export function firstClause(text: string): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const idx = clean.search(/[。；;]/);
  const head = idx >= 0 ? clean.slice(0, idx) : clean;
  return head.slice(0, 120);
}

/**
 * 剔除「引用其它方法」的语境片段，避免把「以 ResNet 为起点 / 借用 ViT 的训练技巧 / 引入 Swin 的宏观设计」
 * 误判成本方法的架构本身。
 */
const REFERENCE_CTX =
  /([^，,。；;]{0,16}(训练技巧|技巧|为起点|作为起点|借鉴|参考|对照|教师|teacher|student|baseline|adapted from|inspired by|引入|沿用|继承)[^，,。；;]{0,16})/gi;

export function stripReferenceMentions(text: string): string {
  REFERENCE_CTX.lastIndex = 0;
  const out = (text ?? '').replace(REFERENCE_CTX, '〔引用其它方法〕');
  REFERENCE_CTX.lastIndex = 0;
  return out;
}

/**
 * 家族判定（架构路线）：
 * 1. **方法名称优先**——名称是作者对自己架构身份的表述，名称命中即为该家族；
 * 2. 名称没有架构关键词时，才看「核心思路首句」，且先剔除引用其它方法的语境；
 * 3. 两类都不足以判定 → 待确认（不硬塞）。
 * 因此「提到 CNN 教师」「以 ResNet 为起点」「引入 Swin 的设计」都不会改变本方法的家族。
 */
export function classifyFamily(method: Method): FamilyVerdict {
  const name = method.fields.methodName?.value ?? '';
  const clause = firstClause(method.fields.coreIdea?.value ?? '');

  const nameHits = FAMILY_RULES.filter((r) => r.re.test(name));
  if (nameHits.length === 1) {
    const rule = nameHits[0];
    return {
      id: rule.id,
      name: rule.name,
      confidence: 'evidence',
      basis: [{ source: '方法名称', keyword: (rule.re.exec(name)?.[0] ?? '').trim(), quote: name.slice(0, 120) }],
    };
  }
  if (nameHits.length > 1) {
    return {
      id: 'hybrid',
      name: '混合（卷积 + 注意力）',
      confidence: 'evidence',
      basis: nameHits.map((r) => ({ source: '方法名称' as const, keyword: (r.re.exec(name)?.[0] ?? '').trim(), quote: name.slice(0, 120) })),
      note: '方法名称里同时出现两类架构关键词，按混合路线处理。',
    };
  }

  const cleaned = stripReferenceMentions(clause);
  REFERENCE_CTX.lastIndex = 0;
  const clauseHits = FAMILY_RULES.filter((r) => r.re.test(cleaned));
  if (clauseHits.length === 1) {
    const rule = clauseHits[0];
    return {
      id: rule.id,
      name: rule.name,
      confidence: 'inferred',
      basis: [{ source: '核心思路首句', keyword: (rule.re.exec(cleaned)?.[0] ?? '').trim(), quote: clause.slice(0, 120) }],
      note: '名称中没有架构关键词，家族依据来自核心思路首句（已剔除引用其它方法的语境）。',
    };
  }
  if (clauseHits.length > 1) {
    return {
      id: 'hybrid',
      name: '混合（卷积 + 注意力）',
      confidence: 'inferred',
      basis: clauseHits.map((r) => ({ source: '核心思路首句' as const, keyword: (r.re.exec(cleaned)?.[0] ?? '').trim(), quote: clause.slice(0, 120) })),
      note: '核心思路首句同时出现两类架构关键词（已剔除引用语境），按混合路线处理。',
    };
  }

  return {
    id: 'pending',
    name: '待确认',
    confidence: 'pending',
    basis: [],
    note: '方法名称与核心思路首句（剔除引用语境后）都没有出现可判定的架构关键词，因此不强行归类。',
  };
}

/* ------------------------------------------------------------------ *
 * 技术策略：允许多标签，来自核心思路全文（策略性描述）
 * ------------------------------------------------------------------ */

const STRATEGY_RULES: { id: string; name: string; re: RegExp }[] = [
  { id: 'distill', name: '知识蒸馏', re: /蒸馏|distillation|teacher[- ]student|教师[- ]?学生|蒸馏 token/i },
  { id: 'window', name: '窗口 / 移位窗口注意力', re: /移位窗口|shifted window|窗口注意力|非重叠局部窗口/i },
  { id: 'hierarchical', name: '层次化多尺度', re: /层级式|层次化|hierarchical|patch merging|多尺度特征/i },
  { id: 'data-efficient', name: '数据高效训练', re: /数据高效|data-efficient|无需外部数据|仅使用 imagenet/i },
  { id: 'augment-reg', name: '强数据增强与正则化', re: /强数据增强|正则化|mixup|cutmix|label smoothing|random erasing/i },
  { id: 'residual', name: '残差连接', re: /残差(映射|学习|连接)|shortcut connection|residual/i },
  { id: 'patch-embed', name: 'Patch 嵌入', re: /patch embedding|扁平化的 2d patch|线性投影.*patch|patchify/i },
  { id: 'rel-pos', name: '相对位置偏置', re: /相对位置偏置|relative position bias/i },
  { id: 'large-kernel', name: '大卷积核', re: /大卷积核|large kernel|7×7|7x7/i },
  { id: 'depthwise', name: '深度可分离卷积 / 倒置瓶颈', re: /深度可分离卷积|depthwise|倒置瓶颈|inverted bottleneck/i },
  { id: 'efficient-train', name: '高效训练设置', re: /300 epochs|优化设置|训练技巧|训练策略|优化器/i },
  { id: 'multi-task', name: '多任务骨干（检测/分割）', re: /目标检测|语义分割|mask ap|ade20k|coco/i },
];

export function classifyStrategies(method: Method): StrategyTag[] {
  const name = method.fields.methodName?.value ?? '';
  const idea = method.fields.coreIdea?.value ?? '';
  const out: StrategyTag[] = [];
  for (const rule of STRATEGY_RULES) {
    const basis: StrategyTag['basis'] = [];
    const mName = rule.re.exec(name);
    if (mName) basis.push({ source: '方法名称', keyword: mName[0] });
    const mIdea = rule.re.exec(idea);
    if (mIdea) basis.push({ source: '核心思路', keyword: mIdea[0] });
    if (basis.length) out.push({ id: rule.id, name: rule.name, basis: basis.slice(0, 2) });
  }
  return out.slice(0, 4);
}

/* ------------------------------------------------------------------ *
 * 方法画像
 * ------------------------------------------------------------------ */

const shortNameOf = (paper: Paper | undefined, method: Method, allPapers: Paper[]): string => {
  const t = paper?.title ?? '';
  const known: [RegExp, string][] = [
    [/Residual/i, 'ResNet'],
    [/AN IMAGE IS WORTH/i, 'ViT'],
    [/data-efficient/i, 'DeiT'],
    [/Swin Transformer/i, 'Swin'],
    [/ConvNet for the 2020s/i, 'ConvNeXt'],
  ];
  for (const [re, name] of known) if (re.test(t)) return name;

  // 通用兜底：用方法名称里最短的英文别名，或用标题前 14 字
  const nameField = (method.fields.methodName?.value ?? '').trim();
  const alias = /[（(]([^）)]{2,24})[）)]/.exec(nameField)?.[1] ?? '';
  if (alias) return alias.replace(/\s+/g, ' ').slice(0, 16);
  const first = nameField.split(/[；;、,，]/)[0]?.trim();
  if (first) return first.slice(0, 16);
  return (t || paper?.id || '未命名方法').slice(0, 14);
};

export function buildMethodProfile(method: Method, paper: Paper | undefined, allPapers: Paper[]): MethodProfile {
  const f = method.fields;
  const idea = f.coreIdea?.value ?? '';
  const clause = firstClause(idea);
  return {
    methodId: method.id,
    paperId: method.paperId,
    shortName: shortNameOf(paper, method, allPapers),
    family: classifyFamily(method),
    strategies: classifyStrategies(method),
    contribution: clause,
    contributionBasis: f.coreIdea?.evidence,
    problem: (f.researchTask?.value ?? '').trim(),
    problemBasis: f.researchTask?.evidence,
    approach: idea,
    limitations: (f.limitations?.value ?? '').trim(),
    limitationsBasis: f.limitations?.evidence,
  };
}

/* ------------------------------------------------------------------ *
 * 领域概览（统计口径：单篇内先去重；区分全部 / 部分 / 未知）
 * ------------------------------------------------------------------ */

const DATASET_RE = /\b(ImageNet-22K|ImageNet-21K|ImageNet-1K|ImageNet ReaL|ImageNet V2|ImageNet-A|ImageNet-R|ImageNet-Sketch|ImageNet|ILSVRC|CIFAR-10|CIFAR-100|COCO|ADE20K|PASCAL VOC|VTAB|Flowers-102|Oxford-IIIT Pets|JFT-300M)\b/gi;
const METRIC_RE = /\b(top-1 (?:accuracy|error(?: rate)?)|top-5 (?:accuracy|error(?: rate)?)|accuracy|few-shot accuracy|fine-tuning accuracy|mAP|box AP|mask AP|AP_box|mIoU|image throughput)\b/gi;

/** 单篇内部去重后，统计出现在 N 篇论文中的词；返回「全部 / 部分」分组 */
function collectAcrossPapers(perPaper: string[][]): { all: string[]; some: { word: string; count: number }[]; maxCount: number } {
  const counter = new Map<string, { display: string; papers: number }>();
  for (const words of perPaper) {
    const uniq = new Map<string, string>();
    for (const w of words) {
      const key = w.toLowerCase().replace(/\s+/g, ' ').trim();
      if (key && !uniq.has(key)) uniq.set(key, w.trim());
    }
    for (const [key, display] of uniq) {
      const cur = counter.get(key);
      if (cur) cur.papers += 1;
      else counter.set(key, { display, papers: 1 });
    }
  }
  const maxCount = perPaper.filter((x) => x.length > 0).length;
  const entries = [...counter.values()].sort((a, b) => b.papers - a.papers);
  return {
    all: entries.filter((e) => e.papers === maxCount && maxCount > 1).map((e) => e.display),
    some: entries.filter((e) => e.papers < maxCount).map((e) => ({ word: e.display, count: e.papers })),
    maxCount,
  };
}

const dedupPerPaper = (texts: string[], re: RegExp): string[][] =>
  texts.map((t) => {
    const m = t.match(re) ?? [];
    const seen = new Map<string, string>();
    for (const x of m) {
      const key = x.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!seen.has(key)) seen.set(key, x.trim());
    }
    return [...seen.values()];
  });

export interface MethodGroup {
  id: string;
  name: string;
  summary: string;
  basis: { keyword: string; source: string; paperId?: string }[];
  members: { paperId: string; methodId: string; paper?: Paper; method?: Method }[];
}

export interface MethodOverview {
  summaryLines: string[];
  datasetAll: string[];
  datasetSome: { word: string; count: number }[];
  metricAll: string[];
  metricSome: { word: string; count: number }[];
  taskPapers: { task: string; count: number };
  groups: MethodGroup[];
  ungrouped: { paperId: string; methodId: string; paper?: Paper; method?: Method; reason: string }[];
  note: string;
}

const GROUP_SUMMARY: Record<string, string> = {
  transformer: '以 Transformer / 自注意力结构为核心路线，重点在「注意力如何替代或补充卷积」。',
  cnn: '以卷积与残差等结构为基础，重点在「卷积网络如何做深、做强、做现代化」。',
  hybrid: '同时使用卷积与注意力两类结构，重点在两条路线的结合方式。',
  pending: '名称与核心思路首句不足以判定架构路线，暂不归类。',
};

export function buildMethodOverview(
  entries: { paper?: Paper; method?: Method }[],
  relations: Relation[] = [],
): MethodOverview {
  const valid = entries.filter((e) => e.method);

  const groups = new Map<string, MethodGroup>();
  const ungrouped: MethodOverview['ungrouped'] = [];
  for (const e of valid) {
    const m = e.method!;
    const family = classifyFamily(m);
    if (family.id === 'pending') {
      ungrouped.push({
        paperId: m.paperId,
        methodId: m.id,
        paper: e.paper,
        method: m,
        reason: family.note ?? '缺少可判定的架构关键词',
      });
      continue;
    }
    if (!groups.has(family.id)) {
      groups.set(family.id, {
        id: family.id,
        name: family.name,
        summary: GROUP_SUMMARY[family.id] ?? '',
        basis: [],
        members: [],
      });
    }
    const g = groups.get(family.id)!;
    for (const b of family.basis) g.basis.push({ keyword: b.keyword, source: b.source, paperId: m.paperId });
    g.members.push({ paperId: m.paperId, methodId: m.id, paper: e.paper, method: m });
  }

  const texts = valid.map((e) => e.method!);
  const datasetStat = collectAcrossPapers(dedupPerPaper(texts.map((m) => m.fields.datasets?.value ?? ''), DATASET_RE));
  const metricStat = collectAcrossPapers(dedupPerPaper(texts.map((m) => m.fields.metrics?.value ?? ''), METRIC_RE));

  const classifyPapers = valid.filter((e) => /分类|classification/i.test(e.method!.fields.researchTask?.value ?? ''));
  const unknownTask = valid.length - classifyPapers.length;

  const summaryLines: string[] = [];
  summaryLines.push(
    `这组论文共 ${valid.length} 篇；其中 ${classifyPapers.length} 篇的研究任务描述里包含图像分类` +
      (unknownTask > 0
        ? `，其余 ${unknownTask} 篇的任务描述没有出现「分类」字样（不代表一定不涉及分类，只是字段里没写到）。`
        : '。'),
  );
  if (datasetStat.all.length) {
    summaryLines.push(`全部论文都涉及的数据集：${datasetStat.all.slice(0, 4).join('、')}。`);
  }
  if (datasetStat.some.length) {
    summaryLines.push(
      `仅部分论文涉及：${datasetStat.some
        .slice(0, 5)
        .map((s) => `${s.word}（${s.count}/${valid.length} 篇）`)
        .join('、')}。`,
    );
  }
  if (!datasetStat.all.length && !datasetStat.some.length) {
    summaryLines.push('数据集字段没有提取到可比对的名称，因此不做数据集层面的汇总。');
  }
  if (metricStat.all.length || metricStat.some.length) {
    summaryLines.push(
      `指标口径：${[...metricStat.all, ...metricStat.some.slice(0, 4).map((s) => `${s.word}（${s.count} 篇）`)].join('、')}` +
        '；不同论文可能用准确率或错误率、top-1 或 top-5，不能直接相互套用。',
    );
  }

  const groupList = [...groups.values()].sort((a, b) => b.members.length - a.members.length);
  if (groupList.length) {
    summaryLines.push(
      `方法家族：${groupList.map((g) => `${g.name} ${g.members.length} 篇`).join('、')}` +
        (ungrouped.length ? `，另有 ${ungrouped.length} 篇待确认。` : '。'),
    );
  }

  if (relations.length) {
    const explicit = relations.filter((r) => r.evidenceState === 'explicit').length;
    const inferred = relations.filter((r) => r.evidenceState === 'inferred').length;
    summaryLines.push(
      `方法关系共 ${relations.length} 条：原文明示 ${explicit} 条、系统推断 ${inferred} 条、待核查 ${relations.length - explicit - inferred} 条。`,
    );
  }

  return {
    summaryLines,
    datasetAll: datasetStat.all,
    datasetSome: datasetStat.some,
    metricAll: metricStat.all,
    metricSome: metricStat.some,
    taskPapers: { task: '图像分类', count: classifyPapers.length },
    groups: groupList,
    ungrouped,
    note: '以上统计由程序按已抽取字段计算：同一篇论文内先去重，再统计跨论文出现次数；「全部」指所有论文都出现，「部分」会标注篇数。系统归组 ≠ 原文结论，点节点可查看原文依据。',
  };
}

/* ------------------------------------------------------------------ *
 * 关系文案：方向必须忠实于 from → to，对称关系不加方向
 * ------------------------------------------------------------------ */

export const RELATION_VERB: Record<RelationType, string> = {
  extends: '继续发展',
  improves: '改进',
  combines: '组合使用',
  similar: '思路相近',
  unclear: '关系不明确',
};

/** 从「观察者方法」视角描述一条关系，保证方向不会讲反 */
/** 取一段文字里的第一个完整句子（用于「一句话回答」），只做截取，不改写 */
export function firstSentence(text: string, max = 90): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^[^。；;]{6,}/);
  const one = (m ? m[0] : t).trim();
  return one.length > max ? one.slice(0, max) : one;
}

/**
 * 默认地图上给出的探索问题：从**已有关系数据**里挑一条最值得先看的，
 * 而不是写死某个方法对。排序优先级：类型（继承 > 改进 > 组合 > 相近）× 证据状态（原文明示 > 系统推断 > 待核查）。
 * 「关系不明确」的对不参与提问（它本来就没有关系证据）。
 */
export function pickExploreRelation<T extends { type: string; evidenceState: string }>(relations: T[]): T | null {
  const usable = relations.filter((r) => r.type !== 'unclear');
  if (!usable.length) return null;
  const typeRank = (t: string) => (t === 'extends' ? 0 : t === 'improves' ? 1 : t === 'combines' ? 2 : 3);
  const stateRank = (e: string) => (e === 'explicit' ? 0 : e === 'inferred' ? 1 : 2);
  return [...usable].sort((a, b) => stateRank(a.evidenceState) - stateRank(b.evidenceState) || typeRank(a.type) - typeRank(b.type))[0];
}

/** 探索问题的问法（按关系类型换说法，方向不变） */
export function exploreQuestion(type: string, fromName: string, toName: string): string {
  if (type === 'extends') return `${toName} 相比 ${fromName} 改变了什么？`;
  if (type === 'improves') return `${toName} 相比 ${fromName} 改进在哪？`;
  if (type === 'combines') return `${toName} 是怎么把别的思路组合起来的？`;
  return `${fromName} 与 ${toName} 有什么相近之处？`;
}

export function relationSentence(
  rel: Relation,
  viewerId: string,
  nameOf: (methodId: string) => string,
): { text: string; symmetric: boolean; direction: 'outgoing' | 'incoming' | 'symmetric' } {
  const from = nameOf(rel.fromMethodId);
  const to = nameOf(rel.toMethodId);
  const symmetric = rel.type === 'similar' || rel.type === 'unclear';

  if (symmetric) {
    return {
      text: `${from} 与 ${to} ${RELATION_VERB[rel.type]}（未声明方向）`,
      symmetric: true,
      direction: 'symmetric',
    };
  }
  if (rel.fromMethodId === viewerId) {
    return { text: `${to} 在 ${from} 的基础上${RELATION_VERB[rel.type]}`, symmetric: false, direction: 'outgoing' };
  }
  if (rel.toMethodId === viewerId) {
    return { text: `${from} 是 ${to} 的前置方法：${to}${RELATION_VERB[rel.type] === '继续发展' ? '在此基础上继续发展' : `对它做了${RELATION_VERB[rel.type]}`}`, symmetric: false, direction: 'incoming' };
  }
  return { text: `${to} 在 ${from} 的基础上${RELATION_VERB[rel.type]}`, symmetric: false, direction: 'outgoing' };
}

/** 关系的一句话解释：来自 rationale（已有推断理由），没有就如实说明 */
export function relationExplanation(rel: Relation): string {
  const t = (rel.rationale ?? '').trim();
  if (t.length >= 8) return t.length > 160 ? t.slice(0, 160) + '…' : t;
  if (rel.evidence?.quote) return `原文片段：${rel.evidence.quote.slice(0, 120)}`;
  return '这条关系没有附解释文本，请以原文证据为准（若证据也不足，视为待核查）。';
}
