/**
 * 不可比检测（规则计算，不使用模型自评）。
 *
 * 本轮修正的关键点：
 * 1. **按论文对计算**：pairLevel / differingDimensions 不再复用「全集维度结论」，
 *    避免出现「两篇之间只能有限比较，却被全集结论判成不能比较」（比较页与分歧页不一致的根因）。
 * 2. **未知不等于一致**：任何一篇在某个维度上是未提取到 / 无法确认 / 引文不支撑主张，该维度一律判为「信息不足」，
 *    不允许因为「字段值恰好相同」就判成一致。
 * 3. **区分范围**：预训练语料 / 下游额外训练数据 / 数据增强分开；下游额外数据与数据增强必须绑定具体实验，
 *    范围不同不能对应比较。
 * 4. **数据划分按数据集比对**：只比较双方都有的数据集，避免把 BERT 的 CoNLL-2003 划分与 RoBERTa 的 GLUE 划分当成同一实验的对应条件。
 * 5. **精度声明**：论文级汇总属于初筛，报告必须带上这一限制，不能宣称为严格核验。
 */

import type {
  ConditionDimension,
  ConditionValue,
  ExperimentConditions,
  Method,
  Paper,
} from './types';
import { CONDITION_DIMENSIONS, CONDITION_LABELS } from './types';
import { RULES_VERSION, parseSplitsByDataset } from './rules';
import { effectiveField, overrideFor, withEffectiveMethods } from './effective';

export type ComparableLevel = 'comparable' | 'limited' | 'not_comparable' | 'unknown';

export const LEVEL_LABELS: Record<ComparableLevel, string> = {
  comparable: '可以直接比较',
  limited: '只能有限比较',
  not_comparable: '当前不能直接比较',
  unknown: '信息不足，无法判断',
};

export const LEVEL_ORDER: ComparableLevel[] = ['not_comparable', 'limited', 'unknown', 'comparable'];

export const SCREENING_NOTICE =
  '本判断基于「论文级」条件汇总，属于初筛。要做结果级比较，需要选定具体实验（任务 + 数据集版本/划分 + 指标 + 实验设置），' +
  '当前粒度不足以宣称已完成严格核验。';

export interface PaperConditionCell {
  paperId: string;
  paperTitle: string;
  values: string[];
  status: ConditionValue['status'];
  note?: string;
  evidence?: ConditionValue['evidence'];
  scope?: ConditionValue['scope'];
  scopeDetail?: string;
  stage?: ConditionValue['stage'];
  structureMigrated?: boolean;
}

export interface DimensionJudgment {
  dimension: ConditionDimension;
  label: string;
  level: ComparableLevel;
  cells: PaperConditionCell[];
  /** 具体哪些条件不一致 */
  differences: string[];
  /** 判断依据（区分原文证据 / 信息缺失 / 判定规则） */
  basis: { kind: 'evidence' | 'missing' | 'rule'; text: string }[];
  /** 缺失的信息 */
  missing: string[];
  /** 该维度是否需要绑定具体实验才能严格比较 */
  needsExperimentBinding?: boolean;
}

export interface ComparabilityReport {
  paperIds: string[];
  dimensions: DimensionJudgment[];
  overall: {
    level: ComparableLevel;
    /** 是否允许据此做数值对照（系统仍不会自动排名） */
    numericComparisonAllowed: boolean;
    summary: string;
    blockingDimensions: ConditionDimension[];
  };
  /** 结果精度：当前只做到论文级初筛 */
  precision: 'paper-level-screening';
  rulesVersion: string;
  notices: string[];
}

const EMPTY_CONDITION: ConditionValue = { values: [], status: 'not_extracted' };

export function conditionOf(method: Method | undefined, dim: ConditionDimension): ConditionValue {
  if (!method) return EMPTY_CONDITION;

  /**
   * 人工修正优先：用户把「数据集 / 评价指标」字段改对了，可比性与条件矩阵必须跟着改。
   * 否则 conditions 里那份旧的结构化取值会一直盖住人工修正，用户的修改等于没生效。
   * 注意：人工修正值不是原文核验结果，状态一律记「待人工核对」（不冒充 verified）。
   */
  if (dim === 'datasets' || dim === 'metrics') {
    const ov = overrideFor(method, dim);
    if (ov) {
      const eff = effectiveField(method, dim);
      return {
        values: (eff.value ?? '')
          .split(/[,;、]|and/)
          .map((x) => x.trim())
          .filter(Boolean),
        status: eff.value ? 'unverified' : 'not_extracted',
        evidence: eff.evidence,
        note: (eff.note ? eff.note + '；' : '') + '该维度按人工修正值计算，不是原文核验结果。',
        scope: 'paper',
      };
    }
  }

  const fromConditions = method.conditions?.[dim];
  if (fromConditions) return fromConditions;

  // 兼容早期缓存：conditions 不存在时退化到 fields 字段（读人工修正后的有效值）
  if (dim === 'datasets' || dim === 'metrics') {
    const f = effectiveField(method, dim);
    if (f?.value) {
      return {
        values: f.value.split(/[,;、]|\band\b/).map((s) => s.trim()).filter(Boolean),
        status: f.status === 'verified' ? 'verified' : f.status === 'missing' ? 'not_reported' : 'unverified',
        evidence: f.evidence,
        note: f.note,
      };
    }
  }
  if (dim === 'experimentalSettings') {
    const f = method.fields.inputsConditions;
    if (f?.value) {
      return {
        values: [f.value],
        status: f.status === 'verified' ? 'verified' : f.status === 'missing' ? 'not_reported' : 'unverified',
        evidence: f.evidence,
        note: f.note,
      };
    }
  }
  return EMPTY_CONDITION;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s\-_/]+/g, '')
    .replace(/[（）()【】\[\]:：,，.。]/g, '');

function canonicalList(values: string[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    let v = raw.trim();
    if (!v) continue;
    v = v.replace(/^(the|a|an)\s+/i, '');
    v = v.replace(/\s*(benchmark|dataset|datasets|corpus|task|suite)s?$/i, '');
    v = v.trim();
    if (!v) continue;
    if (!out.some((x) => norm(x) === norm(v))) out.push(v);
  }
  return out;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const na = a.map(norm).sort();
  const nb = b.map(norm).sort();
  return na.every((x, i) => x === nb[i]);
}

function overlap(a: string[], b: string[]): string[] {
  const nb = new Set(b.map(norm));
  return a.filter((x) => nb.has(norm(x)));
}

/** 集合语义的维度：按集合是否一致判断 */
const SET_DIMENSIONS: ConditionDimension[] = ['datasets', 'metrics', 'pretrainingCorpus'];

/** 必须绑定具体实验才能对应比较的维度 */
const EXPERIMENT_SCOPED: ConditionDimension[] = ['downstreamExtraData', 'dataAugmentation'];

const PROTOCOL_PATTERNS: { key: string; label: string; re: RegExp }[] = [
  { key: 'finetune', label: '微调', re: /fine-?tun|微调/i },
  { key: 'zeroshot', label: '零样本', re: /zero-?shot|零样本/i },
  { key: 'fewshot', label: '少样本', re: /few-?shot|one-?shot|少样本|单样本/i },
  { key: 'pretrain', label: '预训练', re: /pre-?train|预训练/i },
  { key: 'distill', label: '知识蒸馏', re: /distill|蒸馏/i },
  { key: 'scratch', label: '从头训练', re: /from scratch|从头训练/i },
];

function protocolOf(values: string[]): { keys: string[]; labels: string[] } {
  const text = values.join(' ; ');
  const keys: string[] = [];
  const labels: string[] = [];
  for (const p of PROTOCOL_PATTERNS) {
    if (p.re.test(text)) {
      keys.push(p.key);
      labels.push(p.label);
    }
  }
  return { keys, labels };
}

/** 状态是否可以用于「一致性」判断 */
function usableForConsistency(status: ConditionValue['status']): boolean {
  return status === 'verified' || status === 'not_reported';
}

function statusText(s: ConditionValue['status']): string {
  switch (s) {
    case 'verified':
      return '可核验';
    case 'unverified':
      return '引文不支撑该主张，待人工核对';
    case 'not_reported':
      return '论文明确表示无 / 不适用';
    case 'not_extracted':
      return '本次片段中未提取到';
    default:
      return '无法确认';
  }
}

/**
 * 对一组论文做不可比检测。
 */
export function compareConditions(papers: Paper[], methods: Method[]): ComparabilityReport {
  // 可比性判断（含论文对级 comparePair / pairLevel）统一使用人工修正后的有效字段值
  methods = withEffectiveMethods(methods);
  const titleById = new Map(papers.map((p) => [p.id, p.title]));
  const dimensions: DimensionJudgment[] = [];

  for (const dim of CONDITION_DIMENSIONS) {
    const cells: PaperConditionCell[] = methods.map((m) => {
      const c = conditionOf(m, dim);
      return {
        paperId: m.paperId,
        paperTitle: titleById.get(m.paperId) ?? m.paperId,
        values: canonicalList(c.values),
        status: c.status,
        note: c.note,
        evidence: c.evidence,
        scope: c.scope,
        scopeDetail: c.scopeDetail,
        stage: c.stage,
        structureMigrated: c.structureMigrated,
      };
    });

    const missing: string[] = [];
    const basis: DimensionJudgment['basis'] = [];
    const differences: string[] = [];
    let needsExperimentBinding = false;

    const usable = cells.filter((c) => usableForConsistency(c.status));
    const unusable = cells.filter((c) => !usableForConsistency(c.status));

    for (const c of unusable) {
      missing.push(`${c.paperTitle}：${statusText(c.status)}`);
    }
    for (const c of cells) {
      if (c.evidence?.verified) {
        basis.push({
          kind: 'evidence',
          text: `${c.paperTitle} → ${CONDITION_LABELS[dim]}：${c.values.join('、') || '—'}${
            c.scope === 'experiment' ? `（仅限实验：${c.scopeDetail ?? '未指明'}）` : ''
          }（原文 p.${c.evidence.page ?? '?'}）`,
        });
      } else if (c.status === 'verified') {
        basis.push({ kind: 'evidence', text: `${c.paperTitle} → ${CONDITION_LABELS[dim]}：${c.values.join('、') || '—'}` });
      }
    }

    let level: ComparableLevel;

    if (unusable.length > 0) {
      // 关键规则：只要有一篇在该维度上不可用，就不能判为一致，也不能判为不一致
      level = 'unknown';
      basis.push({
        kind: 'missing',
        text: `有 ${unusable.length} 篇论文在该维度上的信息不可用（未提取到 / 无法确认 / 引文不支撑主张），因此无法判断是否一致。缺失不等于一致。`,
      });
    } else if (usable.length < 2) {
      level = 'unknown';
      basis.push({ kind: 'missing', text: `只有 ${usable.length} 篇论文报告了该维度，不足以判断。` });
    } else if (dim === 'dataSplits') {
      // 按数据集比对划分，只比较双方都有的数据集
      const maps = usable.map((c) => ({ cell: c, map: parseSplitsByDataset(c.values) }));
      const scoped = maps.filter((m) => !m.map.has('__unscoped__'));
      const sharedDatasets = scoped.length >= 2
        ? [...scoped[0].map.keys()].filter((d) => scoped.every((m) => m.map.has(d)))
        : [];

      if (scoped.length < usable.length) {
        // 有论文的划分未绑定数据集
        needsExperimentBinding = true;
        level = 'unknown';
        basis.push({
          kind: 'rule',
          text: '有论文的数据划分条目没有绑定到具体数据集，无法确认是否与对方的同一实验对应，因此不做一致/不一致判断。',
        });
      } else if (!sharedDatasets.length) {
        level = 'unknown';
        needsExperimentBinding = true;
        basis.push({
          kind: 'rule',
          text: `各论文报告划分的数据集没有交集（${usable
            .map((c) => `${c.paperTitle.slice(0, 18)}：${[...parseSplitsByDataset(c.values).keys()].join('/')}`)
            .join('；')}），属于不同实验的划分，不能当作同一条件比较。`,
        });
      } else {
        const diffs: string[] = [];
        for (const d of sharedDatasets) {
          const vals = maps.map((m) => ({ cell: m.cell, v: m.map.get(d) ?? '' }));
          const allSame = vals.every((x) => norm(x.v) === norm(vals[0].v));
          if (!allSame) {
            diffs.push(`${d}：${vals.map((x) => `${x.cell.paperTitle.slice(0, 16)}「${x.v}」`).join(' ↔ ')}`);
          }
        }
        if (diffs.length) {
          level = 'limited';
          differences.push(...diffs);
          basis.push({ kind: 'rule', text: `在共同数据集（${sharedDatasets.join('、')}）上数据划分不一致，只能有限比较。` });
        } else {
          level = 'comparable';
          basis.push({ kind: 'rule', text: `共同数据集（${sharedDatasets.join('、')}）的划分一致。` });
        }
      }
    } else if (EXPERIMENT_SCOPED.includes(dim)) {
      const hasExperimentScope = usable.some((c) => c.scope === 'experiment');
      const scopeUnknown = usable.some((c) => !c.scope || c.scope === 'unknown' || c.structureMigrated);
      const scopeDetails = usable
        .filter((c) => c.scope === 'experiment')
        .map((c) => `${c.paperTitle.slice(0, 16)}：${c.scopeDetail ?? '未指明'}`);

      if (scopeUnknown) {
        // 关键规则：适用范围未知时，即使各论文的取值看起来相同，也只能判为「信息不足」。
        // 因为「某篇论文整篇没有额外数据」与「某次实验没有额外数据」是两件不同的事。
        needsExperimentBinding = true;
        level = 'unknown';
        const migrated = usable.filter((c) => c.structureMigrated).map((c) => c.paperTitle.slice(0, 20));
        basis.push({
          kind: 'missing',
          text: migrated.length
            ? `有 ${migrated.length} 篇论文的该条目尚未按当前结构重新抽取（缺少「适用范围」信息：${migrated.join('、')}），无法确认它是整篇论文的结论还是某次实验的描述，因此即使取值相同也不判为一致。`
            : '有论文的该条目没有说明适用范围（整篇论文还是某个具体实验），无法对应比较；取值相同不等于条件一致。',
        });
      } else if (hasExperimentScope) {
        needsExperimentBinding = true;
        const scopeSame = usable.every((c) => c.scope === 'experiment' && norm(c.scopeDetail ?? '') === norm(usable[0].scopeDetail ?? ''));
        if (!scopeSame) {
          level = 'unknown';
          basis.push({
            kind: 'rule',
            text: `各论文的该条目针对的实验不同（${scopeDetails.join('；')}），不能直接对应比较。`,
          });
          differences.push(...scopeDetails.map((s) => `适用实验不同：${s}`));
        } else if (!usable.every((c) => sameSet(c.values, usable[0].values))) {
          level = 'not_comparable';
          differences.push(
            usable.map((c) => `${c.paperTitle.slice(0, 20)}：${c.values.join('、') || '—'}`).join(' ↔ '),
          );
          basis.push({ kind: 'rule', text: `在相同实验（${usable[0].scopeDetail ?? '未指明'}）下该条件不同，不能直接比较。` });
        } else {
          level = 'comparable';
          basis.push({ kind: 'rule', text: `相同实验（${usable[0].scopeDetail ?? '未指明'}）下该条件一致。` });
        }
      } else if (!usable.every((c) => sameSet(c.values, usable[0].values))) {
        level = 'not_comparable';
        differences.push(usable.map((c) => `${c.paperTitle.slice(0, 20)}：${c.values.join('、') || '—'}`).join(' ↔ '));
        basis.push({ kind: 'rule', text: '该条件不同会直接改变结果的可比性，因此判为不能直接比较。' });
      } else {
        level = 'comparable';
        basis.push({ kind: 'rule', text: `${usable.length} 篇论文在整篇论文范围内该条件一致。` });
      }
    } else if (SET_DIMENSIONS.includes(dim)) {
      const lists = usable.map((c) => c.values);
      const allSame = lists.every((l) => sameSet(l, lists[0]));
      if (allSame) {
        level = 'comparable';
        basis.push({ kind: 'rule', text: `${usable.length} 篇论文的${CONDITION_LABELS[dim]}完全一致。` });
      } else {
        const allOverlap = lists.every((l) => overlap(l, lists[0]).length > 0);
        level = allOverlap ? 'limited' : 'not_comparable';
        for (let i = 0; i < usable.length; i++) {
          for (let j = i + 1; j < usable.length; j++) {
            const a = usable[i];
            const b = usable[j];
            if (!sameSet(a.values, b.values)) {
              const common = overlap(a.values, b.values);
              differences.push(
                `${a.paperTitle}（${a.values.join('、') || '空'}）与 ${b.paperTitle}（${b.values.join('、') || '空'}）${
                  common.length ? `仅共有：${common.join('、')}` : '没有共同项'
                }`,
              );
            }
          }
        }
        basis.push({
          kind: 'rule',
          text: allOverlap ? '存在部分重叠但并非同一组，只能就共同部分做有限对照。' : '没有共同项，报告结果来自不同口径，不能直接横向对比。',
        });
      }
    } else if (dim === 'experimentalSettings') {
      const protos = usable.map((c) => protocolOf(c.values));
      const noProto = usable.filter((_, i) => protos[i].keys.length === 0);
      const sets = protos.map((p) => new Set(p.keys));
      const shared = [...sets[0]].filter((k) => sets.every((s) => s.has(k)));

      if (noProto.length === usable.length) {
        level = 'unknown';
        basis.push({ kind: 'missing', text: '未能从论文文本中识别出明确的评估协议（微调/零样本/少样本等），无法判断协议是否一致。' });
        for (const c of noProto) missing.push(`${c.paperTitle}：评估协议无法从原文识别`);
      } else if (shared.length === 0) {
        level = 'not_comparable';
        for (let i = 0; i < usable.length; i++) {
          for (let j = i + 1; j < usable.length; j++) {
            if (protos[i].keys.length && protos[j].keys.length && !protos[i].keys.some((k) => protos[j].keys.includes(k))) {
              differences.push(
                `${usable[i].paperTitle}（协议：${protos[i].labels.join('/') || '未识别'}）↔ ${usable[j].paperTitle}（协议：${
                  protos[j].labels.join('/') || '未识别'
                }）`,
              );
            }
          }
        }
        basis.push({ kind: 'rule', text: '评估协议不同（例如微调 vs 零样本/少样本），报告的结果含义不同，不能直接横向比较。' });
        if (noProto.length) for (const c of noProto) missing.push(`${c.paperTitle}：评估协议无法从原文识别`);
      } else {
        const identical = sets.every((s) => s.size === sets[0].size && [...s].every((k) => sets[0].has(k)));
        level = identical ? 'comparable' : 'limited';
        for (let i = 0; i < usable.length; i++) {
          for (let j = i + 1; j < usable.length; j++) {
            if (usable[i].values.map(norm).join('|') !== usable[j].values.map(norm).join('|')) {
              differences.push(
                `${usable[i].paperTitle}：${usable[i].values.join('、').slice(0, 90)} ↔ ${usable[j].paperTitle}：${usable[j].values
                  .join('、')
                  .slice(0, 90)}`,
              );
            }
          }
        }
        basis.push({
          kind: 'rule',
          text: identical
            ? `评估协议一致（${protos[0].labels.join('/')}），具体设置差异只影响复现，不影响结论口径。`
            : `评估协议存在共有部分（${shared.join('/')}）但并非完全一致，具体设置差异使结果只能有限比较。`,
        });
        if (noProto.length) for (const c of noProto) missing.push(`${c.paperTitle}：评估协议无法从原文识别`);
      }
    } else if (dim === 'computeResources') {
      const notVerified = cells.filter((c) => c.status !== 'verified').length;
      level = notVerified > 0 ? 'unknown' : 'limited';
      basis.push({
        kind: 'rule',
        text:
          notVerified > 0
            ? `${notVerified} 篇论文未报告可核验的算力/训练时长，因此无法判断运行门槛。`
            : '所有论文都报告了算力信息，但硬件配置不同，仍需按具体资源核对。',
      });
    } else {
      // pretrainedModel
      const lists = usable.map((c) => c.values.map(norm).join('|'));
      const allSame = lists.every((l) => l === lists[0]);
      level = allSame ? 'comparable' : 'limited';
      if (!allSame) {
        for (let i = 0; i < usable.length; i++) {
          for (let j = i + 1; j < usable.length; j++) {
            if (usable[i].values.map(norm).join('|') !== usable[j].values.map(norm).join('|')) {
              differences.push(
                `${usable[i].paperTitle}（${usable[i].values.join('、') || '未报告'}）↔ ${usable[j].paperTitle}（${
                  usable[j].values.join('、') || '未报告'
                }）`,
              );
            }
          }
        }
        basis.push({ kind: 'rule', text: `${CONDITION_LABELS[dim]}不一致会带来偏差，只能有限比较。` });
      } else {
        basis.push({ kind: 'rule', text: `${usable.length} 篇论文的${CONDITION_LABELS[dim]}一致。` });
      }
    }

    dimensions.push({
      dimension: dim,
      label: CONDITION_LABELS[dim],
      level,
      cells,
      differences,
      basis,
      missing,
      needsExperimentBinding: needsExperimentBinding || undefined,
    });
  }

  // 总体结论：取最保守的一档（算力不决定性能可比性）
  // 优先级：不能直接比较 > 信息不足 > 只能有限比较 > 可以直接比较。
  // 「信息不足」排在「只能有限比较」之前，是因为只要有关键维度未知，就不能声称「可以有限对照」。
  const perfDims = dimensions.filter((d) => d.dimension !== 'computeResources');
  const blocking = perfDims.filter((d) => d.level === 'not_comparable').map((d) => d.dimension);
  let overallLevel: ComparableLevel;
  if (blocking.length) overallLevel = 'not_comparable';
  else if (perfDims.some((d) => d.level === 'unknown')) overallLevel = 'unknown';
  else if (perfDims.some((d) => d.level === 'limited')) overallLevel = 'limited';
  else overallLevel = 'comparable';

  const blockers = perfDims.filter((d) => d.level === 'not_comparable');
  const limiteds = perfDims.filter((d) => d.level === 'limited');
  const unknowns = perfDims.filter((d) => d.level === 'unknown');
  const needing = perfDims.filter((d) => d.needsExperimentBinding);

  const parts: string[] = [];
  if (blockers.length) parts.push(`以下条件不一致，不能直接比较：${blockers.map((d) => d.label).join('、')}`);
  if (limiteds.length) parts.push(`以下条件存在差异，只能有限比较：${limiteds.map((d) => d.label).join('、')}`);
  if (unknowns.length) parts.push(`以下条件信息不足，无法判断：${unknowns.map((d) => d.label).join('、')}`);
  if (!parts.length) parts.push('所有已检查条件一致，可做同口径对照');

  const notices = [
    '可比性判断由规则在已抽取的实验条件上计算，不使用模型自评的置信度。',
    '「未提取到 / 无法确认 / 引文不支撑主张」一律按信息不足处理，不会因为字段值相同而被判成一致。',
    '即使条件一致，系统也不会自动排名或给出优劣结论，请回到原文查看具体数值与其报告方式。',
  ];
  if (needing.length) {
    notices.push(
      `以下维度需要绑定到具体实验才能严格比较：${needing.map((d) => d.label).join('、')}。当前为论文级初筛。`,
    );
  }

  return {
    paperIds: methods.map((m) => m.paperId),
    dimensions,
    overall: {
      level: overallLevel,
      numericComparisonAllowed: overallLevel === 'comparable',
      summary: parts.join('；') + '。',
      blockingDimensions: blocking,
    },
    precision: 'paper-level-screening',
    rulesVersion: RULES_VERSION,
    notices,
  };
}

/**
 * 论文对级别的可比性：**对该论文对重新计算**，不使用全集结论。
 * 比较页与分歧页都调用这一个函数，保证两处结论一致。
 */
export function comparePair(papers: Paper[], methods: Method[], a: string, b: string): ComparabilityReport {
  const subset = methods.filter((m) => m.paperId === a || m.paperId === b);
  const subsetPapers = papers.filter((p) => p.id === a || p.id === b);
  return compareConditions(subsetPapers, subset);
}

export function pairLevel(papers: Paper[], methods: Method[], a: string, b: string): ComparableLevel {
  return comparePair(papers, methods, a, b).overall.level;
}

/** 列出两篇论文之间具体不一致的条件（按论文对重新计算） */
export function differingDimensions(
  papers: Paper[],
  methods: Method[],
  a: string,
  b: string,
): { dimension: ConditionDimension; label: string; detail: string }[] {
  const report = comparePair(papers, methods, a, b);
  const out: { dimension: ConditionDimension; label: string; detail: string }[] = [];
  for (const d of report.dimensions) {
    if (d.dimension === 'computeResources') continue;
    if (d.level === 'comparable' || d.level === 'unknown') continue;
    const ca = d.cells.find((c) => c.paperId === a);
    const cb = d.cells.find((c) => c.paperId === b);
    if (!ca || !cb) continue;
    out.push({
      dimension: d.dimension,
      label: d.label,
      detail: `${ca.paperTitle.slice(0, 24)}：${ca.values.join('、') || '—'} ↔ ${cb.paperTitle.slice(0, 24)}：${
        cb.values.join('、') || '—'
      }`,
    });
  }
  return out;
}

export function emptyConditions(): ExperimentConditions {
  const dims = {} as ExperimentConditions;
  for (const d of CONDITION_DIMENSIONS) dims[d] = { values: [], status: 'not_extracted' };
  return dims;
}
