/**
 * 实验记录级逻辑：数据/指标名称规范化 + 两条实验的可比性判断。
 *
 * 设计原则（对应本轮要求）：
 * 1. **以实验为单位**，不是以整篇论文为单位；一篇论文可有多条实验。
 * 2. 都写 ImageNet / 都写 top-1 **不等于**可比：要逐项核对预训练数据、训练数据、评估集与划分、
 *    分辨率、额外数据、蒸馏、测试时增强、单模型或集成。
 * 3. 三种口径明确区分：可直接比较 / 只能结合条件讨论 / 信息不足不能直接判断；
 *    再加一类「不能比较」（任务、评估集或指标不同）。
 * 4. 公开基准表现的比较 **不等于**「架构本身更优」的因果结论；本模块不做排名。
 */

import type { ExperimentRecord, TaskTag } from './types';

/* ============================ 名称规范化 ============================ */

/**
 * 数据集别名 → 规范名。
 *
 * 依据（不是凭感觉合并）：
 * - ILSVRC2012 与 ImageNet-1K 是同一个 1000 类分类基准的两种叫法（论文中常见写法："ImageNet"、"ILSVRC-2012"）。
 * - ImageNet-21K 与 ImageNet-22K 在视觉论文里常被混用（同一数据集的 21,841 / 21,843 类版本），
 *   比较时统一为 ImageNet-21K，并在记录里写出原始写法。
 * - JFT-300M 与 "JFT" 指同一内部数据集。
 * - ImageNet-5K 是 ViT 论文使用的子树集，**不与 1K/21K 合并**。
 */
const DATASET_ALIASES: { canonical: string; patterns: RegExp[] }[] = [
  { canonical: 'ImageNet-1K', patterns: [/imagenet[\s-]?1k/i, /ilsvrc[\s-]?2012/i, /imagenet[\s-]?2012/i, /^imagenet$/i, /imagenet\s*1k/i] },
  { canonical: 'ImageNet-21K', patterns: [/imagenet[\s-]?21k/i, /imagenet[\s-]?22k/i] },
  { canonical: 'ImageNet-5K', patterns: [/imagenet[\s-]?5k/i] },
  { canonical: 'JFT-300M', patterns: [/jft[\s-]?300m/i, /^jft$/i] },
  { canonical: 'CIFAR-100', patterns: [/cifar[\s-]?100/i] },
  { canonical: 'CIFAR-10', patterns: [/cifar[\s-]?10(?!0)/i] },
  { canonical: 'COCO', patterns: [/^coco$/i, /ms\s?coco/i] },
  { canonical: 'ADE20K', patterns: [/ade[\s-]?20k/i] },
  { canonical: 'ImageNet-1K-V2', patterns: [/imagenet[\s-]?v2/i, /imagenetv2/i] },
  { canonical: 'none', patterns: [/^none$/i, /^无$/, /scratch\s*only/i] },
];

export interface CanonicalResult {
  canonical?: string;
  raw?: string;
  notes: string[];
}

/** 规范化数据集/数据来源名称；返回规范化结果与「做了哪些归一」的说明 */
export function canonicalDatasetName(raw?: string): CanonicalResult {
  const t = (raw ?? '').trim();
  if (!t) return { notes: [] };
  const unknowns = /^(未知|unknown|not\s+reported|n\/a|-?)$/i;
  if (unknowns.test(t)) return { canonical: 'unknown', raw: t, notes: [] };

  for (const rule of DATASET_ALIASES) {
    if (rule.patterns.some((re) => re.test(t))) {
      const notes: string[] = [];
      if (rule.canonical !== t) notes.push(`「${t}」按既定对应关系归一为「${rule.canonical}」`);
      return { canonical: rule.canonical, raw: t, notes };
    }
  }
  return { canonical: t, raw: t, notes: [] };
}

/** 指标名规范化（top-1 / top-5 必须区分，不能互相比） */
export function canonicalMetricName(raw?: string): string {
  const t = (raw ?? '').trim().toLowerCase();
  if (!t) return 'unknown';
  // 注意：error 与 accuracy 是**不同**的指标（数值方向相反）。实测 ResNet 论文报的是 top-1 err.，
  // 而 DeiT/Swin/ConvNeXt 报的是 top-1 acc.；两者可以互换（100 − err）但不能直接并列比较。
  const isErr = /err/.test(t);
  if (/top[\s-]?1/.test(t)) return isErr ? 'top-1 error' : 'top-1 accuracy';
  if (/top[\s-]?5/.test(t)) return isErr ? 'top-5 error' : 'top-5 accuracy';
  if (/map/.test(t)) return 'mAP';
  if (/miou/.test(t)) return 'mIoU';
  return t;
}

/** 判断两个规范指标名是否只是「error ↔ accuracy」的换算关系 */
export function isErrorVsAccuracy(a: string, b: string): boolean {
  const pairs = [
    ['top-1 error', 'top-1 accuracy'],
    ['top-5 error', 'top-5 accuracy'],
  ];
  return pairs.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

/** 分辨率规范化：224² / 224x224 / 224 都归一到 "224" */
export function canonicalResolution(raw?: string): string {
  const t = (raw ?? '').trim();
  if (!t) return 'unknown';
  if (/^(未知|unknown|n\/a|-?)$/i.test(t)) return 'unknown';
  const m = /(\d{2,4})/.exec(t);
  return m ? m[1] : t;
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
  insufficient_info: '信息不足，不能直接比较',
  not_comparable: '不能直接比较',
};

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
  unknowns: { field: string; label: string; which: 'a' | 'b' | 'both' }[];
  /** 硬性阻断：任务 / 评估集 / 指标不同 */
  blocked: ConditionDiff[];
  /** 吞吐量等辅助信息的比较注意事项 */
  caveats: string[];
  disclaimer: string;
}

const CONDITION_FIELDS: { field: keyof ExperimentRecord; label: string; canonicalize?: (v?: string) => string }[] = [
  { field: 'pretrainData', label: '预训练数据', canonicalize: (v) => canonicalDatasetName(v).canonical ?? 'unknown' },
  { field: 'trainData', label: '训练/微调数据', canonicalize: (v) => canonicalDatasetName(v).canonical ?? 'unknown' },
  { field: 'inputResolution', label: '输入分辨率', canonicalize: canonicalResolution },
  { field: 'extraData', label: '额外数据' },
  { field: 'distillation', label: '蒸馏' },
  { field: 'testTimeAug', label: '测试时增强' },
  { field: 'inferenceMode', label: '单模型/集成' },
];

const UNKNOWN = /^(未知|unknown|not\s+reported|n\/a|-?|)$/i;

const same = (a?: string, b?: string, canon?: (v?: string) => string) => {
  const fa = canon ? canon(a) : (a ?? '').trim().toLowerCase();
  const fb = canon ? canon(b) : (b ?? '').trim().toLowerCase();
  return fa === fb;
};

/** 比较两条实验记录；不做排名，不给出「哪个更好」的结论 */
export function compareExperiments(a: ExperimentRecord, b: ExperimentRecord): ExperimentComparison {
  const reasons: string[] = [];
  const differences: ConditionDiff[] = [];
  const unknowns: ExperimentComparison['unknowns'] = [];
  const blocked: ConditionDiff[] = [];
  const caveats: string[] = [];

  // 硬性阻断项
  if (a.taskTag !== b.taskTag) {
    blocked.push({ field: 'taskTag', label: '任务', a: a.taskTag, b: b.taskTag });
    reasons.push('两条记录属于不同任务，分类结论不能与检测/分割结果混在一起比较。');
  }
  const da = canonicalDatasetName(a.evalDataset).canonical ?? a.evalDataset;
  const db = canonicalDatasetName(b.evalDataset).canonical ?? b.evalDataset;
  if (da !== db) {
    blocked.push({ field: 'evalDataset', label: '评估数据集', a: `${a.evalDataset}（${da}）`, b: `${b.evalDataset}（${db}）` });
    reasons.push('评估数据集不同（或无法归一为同一数据集），数值不可直接对照。');
  }
  const ma = canonicalMetricName(a.metricName);
  const mb = canonicalMetricName(b.metricName);
  if (ma !== mb) {
    blocked.push({ field: 'metricName', label: '指标', a: a.metricName, b: b.metricName });
    if (isErrorVsAccuracy(ma, mb)) {
      reasons.push(
        '一个是错误率（error）、一个是准确率（accuracy）：两者可以互换（100 − err）但数值方向相反，直接并列会得出相反结论；需要先换算并注明口径。',
      );
    } else {
      reasons.push('指标不同（例如 top-1 与 top-5），不能互相比较。');
    }
  }
  const sa = (a.evalSplit ?? '').trim().toLowerCase();
  const sb = (b.evalSplit ?? '').trim().toLowerCase();
  if (sa && sb && sa !== sb) {
    differences.push({ field: 'evalSplit', label: '评估划分', a: a.evalSplit!, b: b.evalSplit! });
    reasons.push('评估划分不同（如 val 与 test），需要结合条件讨论。');
  } else if ((sa && !sb) || (!sa && sb)) {
    unknowns.push({ field: 'evalSplit', label: '评估划分', which: sa ? 'b' : 'a' });
  }

  // 表格行列关系未确认 → 数值本身可疑
  const va = a.verification?.rowColConfirmed;
  const vb = b.verification?.rowColConfirmed;
  if (va === false || vb === false) {
    unknowns.push({ field: 'tableBinding', label: '表格行列对应', which: va === false && vb === false ? 'both' : va === false ? 'a' : 'b' });
    reasons.push('至少一条记录的「表格行列对应」尚未确认（引文、表题、行标签未全部定位），数值可能错位，不能直接比较。');
  }

  // 逐项条件
  for (const cf of CONDITION_FIELDS) {
    const rawA = (a[cf.field] as string | undefined) ?? '';
    const rawB = (b[cf.field] as string | undefined) ?? '';
    const missA = UNKNOWN.test(rawA.trim());
    const missB = UNKNOWN.test(rawB.trim());
    if (missA || missB) {
      unknowns.push({ field: String(cf.field), label: cf.label, which: missA && missB ? 'both' : missA ? 'a' : 'b' });
      continue;
    }
    if (!same(rawA, rawB, cf.canonicalize)) {
      differences.push({ field: String(cf.field), label: cf.label, a: rawA, b: rawB });
    }
  }

  // 辅助信息：吞吐量不能跨设置排名
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

/** 从一批实验里挑出「可讨论同一问题」的候选对（用于自动给出值得看的比较） */
export function suggestComparablePairs(experiments: ExperimentRecord[]): { a: ExperimentRecord; b: ExperimentRecord; cmp: ExperimentComparison }[] {
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
 * 为什么需要：联系与区别页原先固定取各自的第一条分类实验（`exps[0][0]`），
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
