/**
 * 实验记录级逻辑：数据/指标名称规范化 + 两条实验的可比性判断。
 *
 * 设计原则（对应本轮要求）：
 * 1. **以实验为单位**，不是以整篇论文为单位；一篇论文可有多条实验。
 * 2. 都写 ImageNet / 都写 top-1 **不等于**可比：要逐项核对任务、数据集及版本、划分、指标口径与单位、
 *    预训练数据、训练数据、分辨率、额外数据、蒸馏、测试时增强、单模型或集成。
 * 3. 四类口径明确区分：可直接比较 / 只能结合条件讨论 / 信息不足 / 不能直接比较；
 *    绝不把「某条记录字段填满了」当成「两条记录可以比」。
 * 4. 公开基准表现的比较 **不等于**「架构本身更优」的因果结论；本模块不做排名，也不生成排行榜式图形依据。
 *
 * 本轮（2026-10-13）修复的两类语义缺陷：
 * - **未知值判据不统一**（已复现）：完整性用一套判据、比较引擎用另一套，
 *   于是「双方 evalSplit 都为空」「verification 缺失」「双方 extraData 都是『未说明』/『—』」
 *   都会被判成 `directly_comparable`。现在全模块（含抽取侧）只用 `isUnknownValue` 一个入口。
 * - **归一化丢掉了真实实验口径**（已复现）：mAP@0.5 / mAP@0.5:0.95 / box mAP / mask mAP 被归成同一个 'mAP'；
 *   metricUnit 完全不参与比较；ImageNet-1K-V2 被归成 ImageNet-1K；ImageNet-1K + ImageNet-21K 被归成单个 1K；
 *   224x224 / 224x384 / 224x640 全被归成 '224'。现在只合并**有明确依据**的等价写法，其余原样保留。
 */

import type { ExperimentConditionSupplement, ExperimentRecord, TaskTag } from './types';

/* ============================ 统一未知值判据 ============================ */

/**
 * 「未知 / 未记录」的**唯一**判据。
 *
 * 覆盖（这是可以扩展的白名单，不是猜测）：
 * - 空串 / 只有空白；
 * - 中文占位：未知、未知指标、未说明、未报告、未给出、未标注、不详、无、待补；
 * - 英文占位：unknown / unspecified / not reported / not specified / not stated / not given /
 *   not available / not applicable / n/a / na / tbd；
 * - 破折号类占位：- / -- / – / — / − / ． / .
 *
 * ⚠️ 项目铁律「未知 ≠ 一致」：两边都是未知时既不能判「一致」，也不能判「不同」，
 * 只能进「信息不足」。过去 completeness 用一套判据、compare 用另一套，导致同一份数据在两处结论相反。
 *
 * ⚠️ **刻意排除 `none`**：在这个领域里「none / no external data / 无额外数据」是**有意义的取值**
 * （表示「明确没有使用额外数据」），不是占位符。把它当未知会让「双方都没有额外数据」变成信息不足，
 * 与本项目 `canonicalDatasetName` 里的 `none` 规范名和 `looksLikeNegation('none')` 的口径冲突。
 */
const UNKNOWN_VALUE_RE =
  /^(?:|未知(?:指标|值|项|条件)?|未说明|未报告|未给出|未标注|未提供|不详|未提及|待补|待确认|unknown|unspecified|not[ \t]*(?:reported|specified|stated|given|available|applicable|mentioned)|n\/?a|na|tbd|-{1,2}|–|—|−|\.|．|）|)$/i;

/** 该字段值是否属于「未知 / 未记录」 */
export function isUnknownValue(raw?: string | null): boolean {
  const t = (raw ?? '').trim();
  if (!t) return true;
  return UNKNOWN_VALUE_RE.test(t);
}

/** 兼容旧名（抽取侧与页面都在用）：条件维度值是否未记录 */
export function isConditionValueMissing(raw?: string | null): boolean {
  return isUnknownValue(raw);
}

/** 指标数值是否缺失（空，或「未知 / n/a / —」这类占位写法） */
export function isMetricValueMissing(raw?: string | null): boolean {
  return isUnknownValue(raw);
}

const clean = (raw?: string | null) => (raw ?? '').replace(/\s+/g, ' ').trim();

/* ============================ 数据集名称规范化 ============================ */

/**
 * 数据集别名 → 规范名。
 *
 * 依据（不是凭感觉合并）：
 * - ILSVRC2012 / ILSVRC-2012 / ImageNet-2012 与 ImageNet-1K 是同一个 1000 类分类基准；
 * - ImageNet-21K 与 ImageNet-22K 常被混用（同一数据集的 21,841 / 21,843 类版本）；
 * - JFT-300M 与 "JFT" 指同一内部数据集；
 * - ImageNet-5K 是 ViT 论文使用的子树集，**不与 1K/21K 合并**；
 * - **ImageNet-1K-V2 ≠ ImageNet-1K**：V2 是重新收集验证集的版本，数值口径不同，必须分开
 *   （旧实现把 V2 归成 1K，已复现）。因此 V2 规则必须排在 1K 之前。
 * - **复合来源必须保留**：'ImageNet-1K + ImageNet-21K' 不是单个 1K ——
 *   旧实现按第一个命中的别名归成 ImageNet-1K，等于把「用了 21K 额外数据」这条关键信息抹掉（已复现）。
 */
const DATASET_ALIASES: { canonical: string; patterns: RegExp[] }[] = [
  { canonical: 'ImageNet-1K-V2', patterns: [/imagenet[\s-]?v2/i, /imagenetv2/i, /imagenet[\s-]?1k[\s-]?v2/i] },
  { canonical: 'ImageNet-21K', patterns: [/imagenet[\s-]?21k/i, /imagenet[\s-]?22k/i] },
  { canonical: 'ImageNet-5K', patterns: [/imagenet[\s-]?5k/i] },
  {
    canonical: 'ImageNet-1K',
    patterns: [/imagenet[\s-]?1k/i, /ilsvrc[\s-]?2012/i, /imagenet[\s-]?2012/i, /^imagenet$/i, /^in[\s-]?1k$/i],
  },
  { canonical: 'JFT-300M', patterns: [/jft[\s-]?300m/i, /^jft$/i] },
  { canonical: 'CIFAR-100', patterns: [/cifar[\s-]?100/i] },
  { canonical: 'CIFAR-10', patterns: [/cifar[\s-]?10(?!0)/i] },
  { canonical: 'COCO', patterns: [/^coco$/i, /ms[ \t]?coco/i] },
  { canonical: 'ADE20K', patterns: [/ade[\s-]?20k/i] },
  { canonical: 'Pascal VOC', patterns: [/pascal[\s-]?voc/i, /^voc[\s-]?(?:2012|2007)$/i] },
  { canonical: 'none', patterns: [/^none$/i, /^无$/, /scratch[ \t]*only/i, /from[ \t]*scratch/i] },
];

/** 复合来源的分隔符：'ImageNet-1K + ImageNet-21K'、'IN-1K/21K'、'COCO & VOC' */
const COMPOSITE_SPLIT = /[+＋]|[ \t]+and[ \t]+|[&、]|[ \t]*\/[ \t]*/i;

export interface CanonicalResult {
  canonical?: string;
  raw?: string;
  notes: string[];
  /** 复合来源的组成部分（规范名），单一时为空 */
  composite?: string[];
}

/**
 * 数据集名里常见的「限定词」：写在数据集名后面，实际说的是**划分 / 评测方式**，不是另一个数据集。
 * 例：「ImageNet validation」「ImageNet test set」「ImageNet 2012 训练集」都指 ImageNet-1K 这个数据集，
 * 差别在划分（另有 evalSplit 字段专门记录）。
 * 不做这层剥离的话，「ImageNet validation」会原样保留、与「ImageNet-1K」判成两个数据集，
 * 而它们其实完全可以直接对照。只剥离线性的、无歧义的限定词，不做任何猜测性改写。
 */
const DATASET_QUALIFIER_RE =
  /[ \t]*[（(]?(?:the[ \t]+)?(?:validation|valid|val|test|testing|train|training|dev|development)[ \t]*(?:set|sets|split|splits)?[）)]?[ \t]*$/i;
const DATASET_SUFFIX_RE = /[ \t]*(?:dataset|data[ \t]*set|benchmark|corpus)[ \t]*$/i;

function resolveSingleDataset(raw: string, prevCanonical?: string): CanonicalResult | undefined {
  let t = clean(raw);
  if (!t) return undefined;
  if (isUnknownValue(t)) return undefined;
  if (t === '-' || t === '–' || t === '—') return undefined;

  // 剥离划分/类型限定词（可叠加：'ImageNet validation set' → 'ImageNet'）
  const strippedNote: string[] = [];
  const beforeStrip = t;
  for (let i = 0; i < 2; i++) {
    const next = t.replace(DATASET_SUFFIX_RE, '').replace(DATASET_QUALIFIER_RE, '').trim();
    if (next === t) break;
    t = next;
  }
  if (t !== beforeStrip && t.length >= 4) {
    strippedNote.push(`「${beforeStrip}」里的划分/类型限定词不改变数据集身份，按「${t}」归一并另行记录划分`);
  } else if (t !== beforeStrip) {
    // 剥完太短（例如只剩 'set'）：不剥，避免把有意义的名字削掉
    t = beforeStrip;
  }

  /**
   * 简写补全：'ImageNet-1K/21K' 拆开后第二段是 '21K'，
   * 只有在前面已经解析出 ImageNet 家族时才补成 ImageNet-21K（不猜别的家族）。
   */
  const shortK = /^(\d{1,3})\s*k$/i.exec(t);
  if (shortK && prevCanonical && /^ImageNet-/.test(prevCanonical)) {
    const canon = `ImageNet-${shortK[1]}K`;
    return { canonical: canon, raw: t, notes: [`「${t}」按前一数据集家族补全为「${canon}」`] };
  }

  for (const rule of DATASET_ALIASES) {
    if (rule.patterns.some((re) => re.test(t))) {
      const notes = [...strippedNote];
      if (rule.canonical !== t) notes.push(`「${t}」按既定对应关系归一为「${rule.canonical}」`);
      return { canonical: rule.canonical, raw: t, notes };
    }
  }
  return { canonical: t, raw: t, notes: strippedNote };
}

/** 规范化数据集/数据来源名称；返回规范化结果与「做了哪些归一」的说明 */
export function canonicalDatasetName(raw?: string): CanonicalResult {
  const t = clean(raw);
  if (!t) return { notes: [] };
  if (isUnknownValue(t)) return { canonical: 'unknown', raw: t, notes: [] };

  const parts = t.split(COMPOSITE_SPLIT).map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) {
    const seen: string[] = [];
    const notes: string[] = [];
    for (const p of parts) {
      const one = resolveSingleDataset(p, seen.length ? seen[seen.length - 1] : undefined);
      if (!one?.canonical) continue;
      if (one.canonical === 'unknown') continue;
      if (!seen.includes(one.canonical)) seen.push(one.canonical);
      notes.push(...one.notes);
    }
    if (seen.length > 1) {
      const canonical = [...seen].sort().join(' + ');
      notes.push(
        `「${t}」是复合数据来源，按组成部分归一为「${canonical}」；它与只使用其中单一数据集的结果不可直接对照。`,
      );
      return { canonical, raw: t, notes, composite: [...seen].sort() };
    }
    if (seen.length === 1) {
      return { canonical: seen[0], raw: t, notes: [...notes, `「${t}」按组成部分归一为「${seen[0]}」`], composite: [seen[0]] };
    }
    // 拆开后一段都认不出来：整体原样保留（不做「取第一个词」这类猜测）
    return { canonical: t, raw: t, notes: ['复合来源无法逐项归一，按原样保留（不猜测等价）'] };
  }

  return resolveSingleDataset(t) ?? { canonical: t, raw: t, notes: [] };
}

/* ============================ 指标名称 / 单位规范化 ============================ */

/**
 * 指标口径的规范化：**保留阈值、预测对象**。
 *
 * 修复（已复现）：旧实现 `if (/map/.test(t)) return 'mAP'` 把
 * mAP@0.5 / mAP@0.5:0.95 / box mAP / mask mAP 全部吞成同一个 'mAP'，
 * 于是「阈值不同」「检测框 vs 分割掩码」这两种本质不同的口径在页面上被当成同一个指标。
 *
 * 输出形如：`mAP (box) @0.5:0.95`、`top-1 accuracy`、`mIoU`。
 */
export function canonicalMetricName(raw?: string): string {
  const t = clean(raw);
  if (!t) return 'unknown';
  if (isUnknownValue(t)) return 'unknown';
  const low = t.toLowerCase();

  // 注意：error 与 accuracy 是**不同**的指标（数值方向相反）。ResNet 论文报 top-1 err.，
  // DeiT/Swin/ConvNeXt 报 top-1 acc.；两者可互换（100 − err）但不能直接并列比较。
  const isErr = /(^|[^a-z])err/.test(low);
  let base: string;
  if (/m[ \t-]?ap/.test(low)) base = 'mAP';
  // AP 与 mAP 不是同一个指标（AP 是单类/单对象的平均精度，mAP 是各类平均），必须分开；
  // 但 'AP box' 与 'AP_box' 只是写法差异，归一后应相同（否则同一个结果会被判成两种指标）。
  else if (/(^|[^a-z])ap(?=[ \t_.-]|$)/.test(low)) base = 'AP';
  else if (/miou/.test(low)) base = 'mIoU';
  else if (/top[ \t-]?1/.test(low)) base = isErr ? 'top-1 error' : 'top-1 accuracy';
  else if (/top[ \t-]?5/.test(low)) base = isErr ? 'top-5 error' : 'top-5 accuracy';
  else if (/(^|[^a-z])f1([^a-z]|$)/.test(low)) base = 'F1';
  else if (/accuracy|acc(\.|$|[^a-z])/.test(low)) base = 'accuracy';
  else if (/error/.test(low)) base = 'error';
  else if (/psnr/.test(low)) base = 'PSNR';
  else if (/ssim/.test(low)) base = 'SSIM';
  else if (/auc/.test(low)) base = 'AUC';
  else if (/(^|[^a-z])iou([^a-z]|$)/.test(low)) base = 'IoU';
  else if (/bleu/.test(low)) base = 'BLEU';
  else base = low;

  const target = detectMetricTarget(low);
  const threshold = detectMetricThreshold(t);
  const parts = [base];
  if (target) parts.push(`(${target})`);
  if (threshold) parts.push(`@${threshold}`);
  return parts.join(' ');
}

/** 预测对象 / 评估范围（box、mask、keypoint…）。不同对象的结果不可互比。 */
export function detectMetricTarget(low: string): string | undefined {
  if (/panoptic/.test(low)) return 'panoptic';
  if (/mask|segm/.test(low)) return 'mask';
  if (/keypoint|kp\b/.test(low)) return 'keypoint';
  if (/box|bbox|bounding/.test(low)) return 'box';
  if (/semantic/.test(low)) return 'semantic';
  if (/instance/.test(low)) return 'instance';
  return undefined;
}

/** 指标阈值（IoU/score 阈值区间），如 0.5、0.5:0.95。没有写就返回 undefined —— 不猜。 */
export function detectMetricThreshold(t: string): string | undefined {
  const m =
    /@\s*([0-9]+(?:\.[0-9]+)?(?:\s*[:：~-]\s*[0-9]+(?:\.[0-9]+)?)?)/.exec(t) ??
    /(?:iou|threshold|thr)[ \t=:]*([0-9]+(?:\.[0-9]+)?(?:\s*[:：~-]\s*[0-9]+(?:\.[0-9]+)?)?)/i.exec(t);
  if (!m) return undefined;
  return m[1].replace(/\s+/g, '').replace(/[：~-]/g, ':').replace(/:+/g, ':');
}

/** 指标单位规范化（百分数 / 比例 / 其它）。未知一律 unknown，**不擅自假定**。 */
export function canonicalMetricUnit(raw?: string): string {
  const t = clean(raw);
  if (!t || isUnknownValue(t)) return 'unknown';
  if (/^%$|百分|percent|pct$/i.test(t)) return '%';
  if (/^ratio$|比例|fraction|^0[\s-]?1$|^\[0, ?1\]$/i.test(t)) return 'ratio';
  return t.toLowerCase();
}

/** 单位换算关系：百分数 ↔ 比例可以显式换算，其它单位不假设可换算 */
export function metricUnitConversion(a: string, b: string): { convertible: boolean; note?: string } {
  const pair = new Set([a, b]);
  if (pair.has('%') && pair.has('ratio')) {
    return {
      convertible: true,
      note: '一边用百分数（%）、一边用比例（0–1）：两者可按 ×100 换算，但必须显式换算并标注口径后才能并列比较。',
    };
  }
  return { convertible: false };
}

/* ============================ 划分 / 分辨率规范化 ============================ */

const SPLIT_SYNONYMS: Record<string, string> = {
  validation: 'val',
  valid: 'val',
  dev: 'val',
  'dev set': 'val',
  development: 'val',
  testing: 'test',
  'test set': 'test',
  验证集: 'val',
  开发集: 'val',
  测试集: 'test',
  训练集: 'train',
  评估集: 'val',
};

/**
 * 数据划分规范化：'Validation' / 'dev' → 'val'，'testing' → 'test'，
 * 'train/dev/test' 这种组合按集合处理（顺序无关）。
 * 未知 / 空 → 'unknown'（**不**当成「与对方一致」）。
 */
export function canonicalSplit(raw?: string): string {
  const t = clean(raw);
  if (!t || isUnknownValue(t)) return 'unknown';
  const tokens = t
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .split(/[,/、|;；]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => SPLIT_SYNONYMS[x] ?? x);
  if (!tokens.length) return 'unknown';
  return [...new Set(tokens)].sort().join('/');
}

/**
 * 输入分辨率规范化：**保留完整分辨率**。
 *
 * 旧实现用 `/(\d{2,4})/` 取第一个数字，224x224 / 224x384 / 224x640 全归成 '224'（已复现），
 * 等于把「不同的测试分辨率」这条直接影响结果的条件抹掉。
 * 现在保留每个分辨率 token，多个 token（如 '224x224 (finetune 384x384)'）全部保留。
 */
export function canonicalResolution(raw?: string): string {
  const t = clean(raw);
  if (!t) return 'unknown';
  if (isUnknownValue(t)) return 'unknown';
  const found: string[] = [];
  const pair = /(\d{2,4})\s*[x×*]\s*(\d{2,4})/gi;
  for (const m of t.matchAll(pair)) found.push(`${m[1]}x${m[2]}`);
  if (!found.length) {
    const square = /(\d{2,4})\s*(?:²|\^2)/g;
    for (const m of t.matchAll(square)) found.push(`${m[1]}x${m[1]}`);
  }
  if (!found.length) {
    const single = /(\d{2,4})/g;
    for (const m of t.matchAll(single)) found.push(m[1]);
  }
  if (!found.length) return t;
  return [...new Set(found)].join(' + ');
}

/* ============================ 实验身份 ============================ */

/**
 * 一条实验记录的**稳定身份**（内容派生，不依赖数组下标）。
 *
 * 为什么需要：抽取结果的 id 形如 `x_<paperId>_<序号>`，序号会随模型返回顺序变化，
 * 重新分析后 id 与原来对不上；靠 id 匹配人工产物就会「丢确认」或「把 A 的确认带给 B」。
 * 因此人工产物（实验条件的补充与确认）一律用这个 key 匹配。
 *
 * 为什么不只用（模型变体 + 指标名 + 评估集）：已复现 val → test 改变后仍携带旧确认
 * —— 必须把**划分、分辨率、任务、单位**一起纳入身份，条件变了就失效。
 */
export function experimentIdentityKey(e: Pick<
  ExperimentRecord,
  'paperId' | 'taskTag' | 'modelVariant' | 'evalDataset' | 'evalSplit' | 'inputResolution' | 'metricName' | 'metricUnit'
>): string {
  return [
    e.paperId,
    e.taskTag,
    clean(e.modelVariant).toLowerCase(),
    canonicalDatasetName(e.evalDataset).canonical ?? 'unknown',
    canonicalSplit(e.evalSplit),
    canonicalResolution(e.inputResolution),
    canonicalMetricName(e.metricName),
    canonicalMetricUnit(e.metricUnit),
  ].join('|');
}

/* ============================ 人工补充的有效实验视图 ============================ */

/**
 * 该记录上人工补充过的条件维度 → 补充记录。
 *
 * 只在**比较与展示**时使用；存储里始终保留 AI 原值（这样身份 key 稳定、人工值也不会冒充抽取结果）。
 */
export function supplementedDims(e: ExperimentRecord): Map<string, ExperimentConditionSupplement> {
  const m = new Map<string, ExperimentConditionSupplement>();
  for (const s of e.supplements ?? []) {
    if (!s?.dimension || !clean(s.value)) continue;
    m.set(s.dimension, s);
  }
  return m;
}

/** 该维度是否有人工补充值 */
export function isSupplementedDim(e: ExperimentRecord, dim: string): boolean {
  return supplementedDims(e).has(dim);
}

/**
 * 应用人工补充后的有效实验记录。
 *
 * 依据项目铁律「人工修正要成为统一有效值」：页面、比较引擎与导出口径必须一致，
 * 因此任何「判断这条记录能不能比」的地方都要先过这一层。
 * 原对象不被修改（返回副本），AI 原值仍可从 `supplements[].originalValue` 取到。
 */
export function withSupplements(e: ExperimentRecord): ExperimentRecord {
  const sups = supplementedDims(e);
  if (!sups.size) return e;
  const out = { ...e } as ExperimentRecord & Record<string, unknown>;
  for (const [dim, s] of sups) out[dim] = s.value;
  return out as ExperimentRecord;
}

/** 批量版本：所有下游入口统一先过这一层 */
export function effectiveExperimentRecords(list: ExperimentRecord[]): ExperimentRecord[] {
  return list.map(withSupplements);
}

/* ---------- 表格行列对应的三种状态 ---------- */

/**
 * 「这个数值确实属于表格里该模型行 × 该指标列」是否成立。
 *
 * 三档（必须分开，因为它们可信度完全不同）：
 * - `program`：程序核验通过（引文 + 表题 + 行标签都定位到，且版面核查确认列头与指标一致）；
 * - `manual` ：**人工声明**已核对。这不是程序核验结果，只是「用户看了表格并给出来源」，
 *              所以它只让这一项不再算「未知」，同时会在结论里挂一条明确的注意事项；
 * - `unverified`：未确认（缺元数据、核验未通过、或人工声明没给值/来源）。
 *
 * ⚠️ 为什么需要 `manual`：语料的版面核查经常因为 PDF 文本层缺列头而无法通过，
 * 但人翻一下表格就能确认；这类确认必须被记录下来，否则页面永远只能显示「信息不足」。
 * 但绝不能把它说成「已核验」，也不能让它悄悄通过 —— 因此它必须带来源，并在结论里注明。
 */
export type TableBindingState = 'program' | 'manual' | 'unverified';

/** 人工声明「已核对」时允许填写的确认值（必须给出来源才作数） */
const BINDING_AFFIRM = /^(已核对|已确认|已对照|confirmed|verified|yes|y|是)$/i;

export function tableBindingState(e: ExperimentRecord): TableBindingState {
  if (e.verification?.rowColConfirmed === true) return 'program';
  const sup = supplementedDims(e).get('tableBinding');
  if (sup && BINDING_AFFIRM.test(sup.value.trim()) && sup.source.trim()) return 'manual';
  return 'unverified';
}

/* ============================ 指标数值解析 ============================ */

export type MetricValueShape =
  | { kind: 'point'; value: number; raw: string }
  | { kind: 'range'; low: number; high: number; raw: string }
  | { kind: 'bound'; bound: 'lower' | 'upper'; value: number; raw: string }
  | { kind: 'approx'; value: number; plusMinus?: number; raw: string }
  | { kind: 'unknown'; raw: string }
  | { kind: 'unparsed'; raw: string };

const NUM = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;

/**
 * 解析指标数值，**如实区分**「确切值 / 区间 / 上下界 / 均值±方差 / 无法解析」。
 *
 * 修复（#19）：旧实现一律 `parseFloat` 取第一个数字当精确结果，
 * 于是 '78.5–79.1'、'>80'、'76.5 ± 0.3'、'7.2e1' 都会被画成一个看起来精确的条长，
 * 视觉上就变成了排行榜。这里只对 `point` 给单一数值，其余交给界面如实展示原始写法。
 */
export function parseMetricValue(raw?: string): MetricValueShape {
  const t = clean(raw);
  if (!t || isUnknownValue(t)) return { kind: 'unknown', raw: t };

  // 均值 ± 标准差
  const pm = /([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*(?:±|\+-|\+\/-|\\pm)\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/.exec(t);
  if (pm) return { kind: 'approx', value: Number(pm[1]), plusMinus: Math.abs(Number(pm[2])), raw: t };

  // 上下界：'>80'、'≥ 78.5'、'<10'、'at most 80'
  const bound = /^(?:>=|≥|>|at least|不少于|至少)\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/i.exec(t);
  if (bound) return { kind: 'bound', bound: 'lower', value: Number(bound[1]), raw: t };
  const bound2 = /^(?:<=|≤|<|at most|不超过|至多)\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/i.exec(t);
  if (bound2) return { kind: 'bound', bound: 'upper', value: Number(bound2[1]), raw: t };

  // 区间：'78.5–79.1'、'78.5~79.1'、'78.5 to 79.1'
  const range = /(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*(?:–|—|~|-|至|to)\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/i.exec(t);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (Number.isFinite(low) && Number.isFinite(high)) {
      return { kind: 'range', low: Math.min(low, high), high: Math.max(low, high), raw: t };
    }
  }

  // 单一数值（允许带百分号/单位后缀）
  const nums = t.match(NUM);
  if (nums && nums.length === 1) {
    const v = Number(nums[0]);
    if (Number.isFinite(v)) return { kind: 'point', value: v, raw: t };
  }
  if (!nums || !nums.length) return { kind: 'unknown', raw: t };
  // 有多个数字但不符合上面的模式（例如 '224 分辨率下 76.5'）：不猜，原样交出
  return { kind: 'unparsed', raw: t };
}

/* ============================ 实验比较 ============================ */

export type ExperimentLevel =
  | 'directly_comparable'
  | 'comparable_with_conditions'
  | 'insufficient_info'
  | 'not_comparable';

export const EXPERIMENT_LEVEL_LABELS: Record<ExperimentLevel, string> = {
  directly_comparable: '已知条件下可直接比较',
  comparable_with_conditions: '只能结合条件讨论',
  insufficient_info: '信息不足',
  not_comparable: '不能直接比较',
};

/** 四类结论的展示顺序（页面分组用） */
export const EXPERIMENT_LEVEL_ORDER: ExperimentLevel[] = [
  'directly_comparable',
  'comparable_with_conditions',
  'insufficient_info',
  'not_comparable',
];

export interface ConditionDiff {
  field: string;
  label: string;
  a: string;
  b: string;
}

export interface ExperimentComparison {
  level: ExperimentLevel;
  reasons: string[];
  /** 双方都有值且不同 */
  differences: ConditionDiff[];
  /** 至少一方未知 → 无法直接比较 */
  unknowns: { field: string; label: string; which: 'a' | 'b' | 'both'; hint?: string }[];
  /** 硬性阻断：任务 / 评估集 / 指标 / 单位口径不同 */
  blocked: ConditionDiff[];
  /** 吞吐量、单位换算等辅助信息的比较注意事项 */
  caveats: string[];
  disclaimer: string;
}

/**
 * 逐项判断的条件字段。
 *
 * 任务 / 评估数据集 / 指标名 / 指标数值 由下面的专门分支处理（它们需要更准确的措辞与阻断语义），
 * 因此不在这张表里重复；这里覆盖其余**会影响结果口径**的条件维度。
 */
const CONDITION_FIELDS: { field: keyof ExperimentRecord; label: string; canonicalize?: (v?: string) => string }[] = [
  { field: 'evalSplit', label: '评估划分', canonicalize: canonicalSplit },
  { field: 'metricUnit', label: '指标单位', canonicalize: canonicalMetricUnit },
  { field: 'pretrainData', label: '预训练数据', canonicalize: (v) => canonicalDatasetName(v).canonical ?? 'unknown' },
  { field: 'trainData', label: '训练/微调数据', canonicalize: (v) => canonicalDatasetName(v).canonical ?? 'unknown' },
  { field: 'inputResolution', label: '输入分辨率', canonicalize: canonicalResolution },
  { field: 'extraData', label: '额外数据' },
  { field: 'distillation', label: '蒸馏' },
  { field: 'testTimeAug', label: '测试时增强' },
  { field: 'inferenceMode', label: '单模型/集成' },
];

/** 上表 + 并列比较的「主口径」字段，供页面渲染条件矩阵时统一遍历 */
export const MATRIX_FIELDS: { field: keyof ExperimentRecord; label: string; canonicalize?: (v?: string) => string }[] = [
  { field: 'taskTag', label: '任务' },
  { field: 'evalDataset', label: '评估数据集', canonicalize: (v) => canonicalDatasetName(v).canonical ?? 'unknown' },
  { field: 'evalSplit', label: '评估划分', canonicalize: canonicalSplit },
  { field: 'metricName', label: '评估指标', canonicalize: canonicalMetricName },
  { field: 'metricUnit', label: '指标单位', canonicalize: canonicalMetricUnit },
  { field: 'metricValue', label: '指标数值' },
  { field: 'pretrainData', label: '预训练数据', canonicalize: (v) => canonicalDatasetName(v).canonical ?? 'unknown' },
  { field: 'trainData', label: '训练/微调数据', canonicalize: (v) => canonicalDatasetName(v).canonical ?? 'unknown' },
  { field: 'inputResolution', label: '输入分辨率', canonicalize: canonicalResolution },
  { field: 'extraData', label: '额外数据' },
  { field: 'distillation', label: '蒸馏' },
  { field: 'testTimeAug', label: '测试时增强' },
  { field: 'inferenceMode', label: '单模型/集成' },
];

const sameValue = (a?: string, b?: string, canon?: (v?: string) => string) => {
  const fa = canon ? canon(a) : clean(a).toLowerCase();
  const fb = canon ? canon(b) : clean(b).toLowerCase();
  return fa === fb;
};

/** 比较两条实验记录；不做排名，不给出「哪个更好」的结论 */
export function compareExperiments(a: ExperimentRecord, b: ExperimentRecord): ExperimentComparison {
  const reasons: string[] = [];
  const differences: ConditionDiff[] = [];
  const unknowns: ExperimentComparison['unknowns'] = [];
  const blocked: ConditionDiff[] = [];
  const caveats: string[] = [];

  /* ---------- 硬性阻断项 ---------- */
  if (a.taskTag !== b.taskTag) {
    blocked.push({ field: 'taskTag', label: '任务', a: a.taskTag, b: b.taskTag });
    reasons.push('两条记录属于不同任务，分类结论不能与检测/分割结果混在一起比较。');
  }

  /**
   * 评估数据集：只有「双方都有值且归一后不同」才是硬阻断；
   * 任一方未知一律计入「信息不足」—— 旧实现在双方都未知时把两个 'unknown' 判成相等，
   * 于是两处都不知道反而可能被算成「已知条件下可直接比较」（已复现）。
   */
  const dsA = canonicalDatasetName(a.evalDataset);
  const dsB = canonicalDatasetName(b.evalDataset);
  const dsUnknownA = !dsA.canonical || dsA.canonical === 'unknown';
  const dsUnknownB = !dsB.canonical || dsB.canonical === 'unknown';
  if (dsUnknownA || dsUnknownB) {
    unknowns.push({
      field: 'evalDataset',
      label: '评估数据集',
      which: dsUnknownA && dsUnknownB ? 'both' : dsUnknownA ? 'a' : 'b',
      hint: '评估数据集未确认时，既不能认定两个结果可对照，也不能认定数据集不同。',
    });
    reasons.push('至少一条记录的评估数据集未确认：既不能认定两个结果可对照，也不能认定数据集不同。');
  } else if (dsA.canonical !== dsB.canonical) {
    blocked.push({
      field: 'evalDataset',
      label: '评估数据集',
      a: `${a.evalDataset}（${dsA.canonical}）`,
      b: `${b.evalDataset}（${dsB.canonical}）`,
    });
    const composite = dsA.composite?.length! > 1 || dsB.composite?.length! > 1;
    reasons.push(
      composite
        ? '评估数据集的数据来源不同（含复合来源，如同时使用预训练集与评估集），数值不可直接对照。'
        : '评估数据集不同（或无法归一为同一数据集），数值不可直接对照。',
    );
  }

  /* ---------- 指标口径：名称（含阈值/对象）与单位 ---------- */
  const ma = canonicalMetricName(a.metricName);
  const mb = canonicalMetricName(b.metricName);
  if (ma === 'unknown' || mb === 'unknown') {
    unknowns.push({
      field: 'metricName',
      label: '指标',
      which: ma === 'unknown' && mb === 'unknown' ? 'both' : ma === 'unknown' ? 'a' : 'b',
      hint: '指标未确认时，既不能认定口径一致，也不能认定指标不同。',
    });
    reasons.push('至少一条记录的评估指标未确认：既不能认定口径一致，也不能认定指标不同。');
  } else if (ma !== mb) {
    blocked.push({ field: 'metricName', label: '指标', a: `${a.metricName}（${ma}）`, b: `${b.metricName}（${mb}）` });
    if (isErrorVsAccuracy(ma, mb)) {
      reasons.push(
        '一个是错误率（error）、一个是准确率（accuracy）：两者可以互换（100 − err）但数值方向相反，直接并列会得出相反结论；需要先换算并注明口径。',
      );
    } else if (sameBaseMetric(ma, mb)) {
      reasons.push(
        `指标口径不同（同一指标的不同阈值或预测对象：${ma} ↔ ${mb}），数值不能直接并列。`,
      );
    } else {
      reasons.push('指标不同（例如 top-1 与 top-5），不能互相比较。');
    }
  }

  const ua = canonicalMetricUnit(a.metricUnit);
  const ub = canonicalMetricUnit(b.metricUnit);
  if (ua === 'unknown' || ub === 'unknown') {
    unknowns.push({
      field: 'metricUnit',
      label: '指标单位',
      which: ua === 'unknown' && ub === 'unknown' ? 'both' : ua === 'unknown' ? 'a' : 'b',
      hint: '单位没写时不能擅自假定成百分数或比例（同一个 0.768 可能是 76.8% 也可能是 0.768%）。',
    });
    reasons.push('至少一条记录没有写明指标单位：无法确认数值口径，不能直接比较。');
  } else if (ua !== ub) {
    const conv = metricUnitConversion(ua, ub);
    if (conv.convertible) {
      caveats.push(conv.note!);
      differences.push({ field: 'metricUnit', label: '指标单位', a: ua, b: ub });
      reasons.push('单位写法不同但可按明确换算关系转换（需换算后并注明口径）。');
    } else {
      blocked.push({ field: 'metricUnit', label: '指标单位', a: ua, b: ub });
      reasons.push('指标单位不同且没有明确换算关系，数值不可直接对照。');
    }
  }

  /* ---------- 指标数值本身 ---------- */
  const valueMissingA = isMetricValueMissing(a.metricValue);
  const valueMissingB = isMetricValueMissing(b.metricValue);
  if (valueMissingA || valueMissingB) {
    unknowns.push({
      field: 'metricValue',
      label: '指标数值',
      which: valueMissingA && valueMissingB ? 'both' : valueMissingA ? 'a' : 'b',
      hint: '没有可对照的数字谈不上「可直接比较」；数值写法异常时会如实标注原始写法。',
    });
    reasons.push('至少一条记录没有可对照的指标数值：没有数字谈不上「可直接比较」。');
  }

  /* ---------- 表格行列对应（核验元数据） ---------- */
  /**
   * 修复（已复现）：旧实现只在 `rowColConfirmed === false` 时降级，**字段缺失（undefined）被放行**，
   * 于是「从未核查过行列对应」的记录会被当成核查通过。
   * 依据「缺核验元数据不能默认通过」：只有明确 true 才算核验成立。
   */
  const ba = tableBindingState(a);
  const bb = tableBindingState(b);
  if (ba === 'unverified' || bb === 'unverified') {
    const missingMeta = a.verification === undefined || b.verification === undefined;
    unknowns.push({
      field: 'tableBinding',
      label: '表格行列对应',
      which: ba === 'unverified' && bb === 'unverified' ? 'both' : ba === 'unverified' ? 'a' : 'b',
      hint: missingMeta
        ? '该记录缺少「表格行列对应」的核验元数据，按未确认处理（缺失不等于通过）。'
        : '引文 / 表题 / 行标签未全部定位，或版面核查无法确认列头，数值可能错位。可在展开层填入「已核对」并注明来源（人工声明，会明确标注）。',
    });
    reasons.push(
      '至少一条记录的「表格行列对应」尚未确认（缺少核验元数据或未全部定位），数值可能错位，不能直接比较。',
    );
  } else if (ba === 'manual' || bb === 'manual') {
    // 人工声明可以把这一项从「未知」里拿出来，但必须留下可见的注意事项（不能冒充程序核验）
    caveats.push(
      '表格行列对应由**人工声明**为已核对（不是程序核验结果）：使用前请自行复核该数值确实属于对应行与列。',
    );
  }

  /* ---------- 逐项条件 ---------- */
  for (const cf of CONDITION_FIELDS) {
    const rawA = (a[cf.field] as string | undefined) ?? '';
    const rawB = (b[cf.field] as string | undefined) ?? '';
    const missA = isUnknownValue(rawA);
    const missB = isUnknownValue(rawB);
    if (missA || missB) {
      unknowns.push({
        field: String(cf.field),
        label: cf.label,
        which: missA && missB ? 'both' : missA ? 'a' : 'b',
        hint: '该条件未记录：既不能认定一致，也不能认定不同。',
      });
      continue;
    }
    if (!sameValue(rawA, rawB, cf.canonicalize)) {
      differences.push({
        field: String(cf.field),
        label: cf.label,
        a: cf.canonicalize ? `${rawA}（${cf.canonicalize(rawA)}）` : rawA,
        b: cf.canonicalize ? `${rawB}（${cf.canonicalize(rawB)}）` : rawB,
      });
    }
  }

  /* ---------- 辅助信息：吞吐量不能跨设置排名 ---------- */
  if (a.throughput?.value || b.throughput?.value) {
    const ha = a.throughput?.hardware ?? '';
    const hb = b.throughput?.hardware ?? '';
    const ba = a.throughput?.batchSize ?? '';
    const bb = b.throughput?.batchSize ?? '';
    if (!ha || !hb || ha.toLowerCase() !== hb.toLowerCase()) {
      caveats.push('吞吐量（throughput）的测量硬件不同或未说明，**不能**直接比较快慢。');
    } else if (ba !== bb) {
      caveats.push('吞吐量的批量不同，不能直接比较快慢。');
    }
  }
  if (a.params || b.params) caveats.push('参数量与 FLOPs 属于模型规模信息，可以作为规模参照，但不代表任务表现更优。');

  let level: ExperimentLevel = 'directly_comparable';
  if (blocked.length) level = 'not_comparable';
  else if (unknowns.length) level = 'insufficient_info';
  else if (differences.length) level = 'comparable_with_conditions';

  const disclaimer =
    '说明：以上判断只看「记录下来的条件是否一致」，不评价方法优劣，也不做排名。' +
    '公开基准上的数值差异可能来自预训练数据、训练策略、分辨率、测试时增强等非架构因素，' +
    '不能据此得出「某种架构本身更优」的因果结论。';

  return { level, reasons, differences, unknowns, blocked, caveats, disclaimer };
}

/** 两个指标名是否只是「同一指标的不同阈值 / 预测对象」 */
function sameBaseMetric(a: string, b: string): boolean {
  const base = (s: string) =>
    s
      .replace(/@[0-9.:]+/g, '')
      .replace(/\([^)]*\)/g, '')
      .trim();
  return base(a) === base(b);
}

/** 判断两个规范指标名是否只是「error ↔ accuracy」的换算关系 */
export function isErrorVsAccuracy(a: string, b: string): boolean {
  const pairs = [
    ['top-1 error', 'top-1 accuracy'],
    ['top-5 error', 'top-5 accuracy'],
  ];
  return pairs.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

/** 从一批实验里挑出「可讨论同一问题」的候选对（用于自动给出值得看的比较） */
export function suggestComparablePairs(
  experiments: ExperimentRecord[],
): { a: ExperimentRecord; b: ExperimentRecord; cmp: ExperimentComparison }[] {
  const out: { a: ExperimentRecord; b: ExperimentRecord; cmp: ExperimentComparison }[] = [];
  for (let i = 0; i < experiments.length; i++) {
    for (let j = i + 1; j < experiments.length; j++) {
      const a = experiments[i];
      const b = experiments[j];
      const cmp = compareExperiments(a, b);
      if (cmp.level === 'directly_comparable' || cmp.level === 'comparable_with_conditions') out.push({ a, b, cmp });
    }
  }
  return out;
}

/** 任务标签过滤：分类比较只看 classification */
export const classificationOnly = (list: ExperimentRecord[]): ExperimentRecord[] =>
  list.filter((e) => e.taskTag === ('classification' as TaskTag));

/**
 * 在**两个方法各自的实验记录之间**挑一对「同口径」的来比较。
 *
 * 为什么需要：关系与比较页原先固定取各自的第一条分类实验（`exps[0][0]`），
 * 那两条很可能数据集/指标都不同 —— 结果就是界面上并排摆两个不可比的数字。
 * 这里优先返回可直接比较 / 有条件可比较的对；实在没有时才退回「不是硬阻断」的那一对，
 * 但调用方必须按返回的 `cmp.level` 决定要不要展示数字（不可比就不展示）。
 */
export function pickComparableExperimentPair(
  expsA: ExperimentRecord[],
  expsB: ExperimentRecord[],
): { a: ExperimentRecord; b: ExperimentRecord; cmp: ExperimentComparison } | null {
  let fallback: { a: ExperimentRecord; b: ExperimentRecord; cmp: ExperimentComparison } | null = null;
  for (const a of classificationOnly(expsA)) {
    for (const b of classificationOnly(expsB)) {
      const cmp = compareExperiments(a, b);
      if (cmp.level === 'directly_comparable' || cmp.level === 'comparable_with_conditions') {
        return { a, b, cmp };
      }
      if (!fallback && cmp.level !== 'not_comparable') fallback = { a, b, cmp };
    }
  }
  return fallback;
}

/* ============================ 同口径分组 ============================ */

/**
 * 同口径组的键：**任务 + 数据集（含版本）+ 划分 + 指标口径（含阈值/对象）+ 单位**。
 *
 * 修复（#17）：旧分组只按「指标名 + 单位」，于是
 * - 分类与检测会被放进同一组（taskTag 没隔离）；
 * - ImageNet-1K 与 ImageNet-1K-V2 混在一起；
 * - val 与 test 混在一起；
 * - mAP@0.5 与 mAP@0.5:0.95 混在一起（旧规范化把它们归成同一个 mAP）。
 * 这些都属于「主口径」不同，不能当成一组互相直接比较。
 *
 * ⚠️ 分组只是**候选**：即便主口径一致，预训练数据/分辨率/额外数据等仍可能不同，
 * 因此组内仍需逐对比较，不能把一个「只能结合条件讨论」的对自动升级为整组可直接比较。
 */
export interface GroupKey {
  taskTag: string;
  dataset: string;
  split: string;
  metric: string;
  unit: string;
}

export function groupKeyOf(e: ExperimentRecord): GroupKey {
  return {
    taskTag: e.taskTag,
    dataset: canonicalDatasetName(e.evalDataset).canonical ?? 'unknown',
    split: canonicalSplit(e.evalSplit),
    metric: canonicalMetricName(e.metricName),
    unit: canonicalMetricUnit(e.metricUnit),
  };
}

export const groupKeyString = (k: GroupKey): string => [k.taskTag, k.dataset, k.split, k.metric, k.unit].join(' | ');

/** 组的可读标签 */
export const groupLabel = (k: GroupKey): string =>
  [k.taskTag, k.dataset, k.split === 'unknown' ? '划分未注明' : k.split, k.metric, k.unit === 'unknown' ? '单位未注明' : k.unit].join(
    ' · ',
  );

export interface ExperimentGroup {
  key: GroupKey;
  id: string;
  label: string;
  experiments: ExperimentRecord[];
  /** 该组内是否存在未知的主口径（划分/单位未知时不建议当作「同口径」展示） */
  hasUnknownKeyPart: boolean;
}

/**
 * 把实验记录按主口径分组。
 * 未知主口径（数据集/划分/指标/单位未确认）的记录**单独成组**并标记，不与他人混为一组。
 */
export function groupExperiments(experiments: ExperimentRecord[]): ExperimentGroup[] {
  const map = new Map<string, ExperimentGroup>();
  for (const e of experiments) {
    const key = groupKeyOf(e);
    const id = groupKeyString(key);
    let g = map.get(id);
    if (!g) {
      g = {
        key,
        id,
        label: groupLabel(key),
        experiments: [],
        hasUnknownKeyPart:
          key.dataset === 'unknown' ||
          key.split === 'unknown' ||
          key.metric === 'unknown' ||
          key.unit === 'unknown' ||
          key.taskTag === 'other',
      };
      map.set(id, g);
    }
    g.experiments.push(e);
  }
  return [...map.values()];
}

/* ============================ 页面用的成对判定 ============================ */

export interface ExperimentPairVerdict {
  a: ExperimentRecord;
  b: ExperimentRecord;
  cmp: ExperimentComparison;
  /** 同一主口径组内 */
  sameGroup: boolean;
}

/**
 * 页面主结果：**成对**判定（不是「单条记录填满了几项」）。
 *
 * 返回：
 * - `pairs`：所有两两组合的判定（排列无关：只遍历 i<j 一次），页面按 level 分组展示；
 * - `groups`：主口径候选组（仅供组织展示，不代替逐对结论）。
 *
 * 计数对象的语义在返回值里写清楚：`pairCount` 是**实验对**数，`recordCount` 是**实验记录**数，
 * `paperCount` 是**论文**数 —— 页面必须用对应的名字，不能把成对判定标成单条记录属性。
 */
export function analyzeExperimentComparability(experiments: ExperimentRecord[]): {
  pairs: ExperimentPairVerdict[];
  groups: ExperimentGroup[];
  pairCount: number;
  recordCount: number;
  paperCount: number;
  byLevel: Record<ExperimentLevel, ExperimentPairVerdict[]>;
} {
  const pairs: ExperimentPairVerdict[] = [];
  for (let i = 0; i < experiments.length; i++) {
    for (let j = i + 1; j < experiments.length; j++) {
      const a = experiments[i];
      const b = experiments[j];
      const cmp = compareExperiments(a, b);
      pairs.push({
        a,
        b,
        cmp,
        sameGroup: groupKeyString(groupKeyOf(a)) === groupKeyString(groupKeyOf(b)),
      });
    }
  }
  const byLevel = {
    directly_comparable: pairs.filter((p) => p.cmp.level === 'directly_comparable'),
    comparable_with_conditions: pairs.filter((p) => p.cmp.level === 'comparable_with_conditions'),
    insufficient_info: pairs.filter((p) => p.cmp.level === 'insufficient_info'),
    not_comparable: pairs.filter((p) => p.cmp.level === 'not_comparable'),
  } as Record<ExperimentLevel, ExperimentPairVerdict[]>;
  return {
    pairs,
    groups: groupExperiments(experiments),
    pairCount: pairs.length,
    recordCount: experiments.length,
    paperCount: new Set(experiments.map((e) => e.paperId)).size,
    byLevel,
  };
}
