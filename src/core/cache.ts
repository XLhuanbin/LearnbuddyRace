/**
 * 预置语料缓存格式与加载。
 *
 * 缓存由 scripts/analyze.mjs 在本地用真实模型生成，浏览器端只负责读取与展示。
 * 界面必须明确区分「预置样例（缓存）」与「本次实时分析」，二者不可混淆。
 */

import type {
  ConditionDimension,
  ConditionValue,
  DivergenceReport,
  ExperimentConditions,
  FieldKey,
  Method,
  Paper,
  ReadingPlan,
  Relation,
} from './types';
import { CONDITION_DIMENSIONS, METHOD_FIELD_LABELS } from './types';
import { RULES_VERSION, type StalenessReport } from './rules';

export const FIELD_KEYS_ORDER: FieldKey[] = [
  'researchTask',
  'methodName',
  'coreIdea',
  'inputsConditions',
  'datasets',
  'metrics',
  'limitations',
];

export const CACHE_VERSION = 3;

/** 缓存中不存 rawText，全文单独按需加载 */
export type CachedPaperMeta = Omit<Paper, 'rawText' | 'pages'> & { pages?: undefined };

export interface CachedPaperText {
  paperId: string;
  pages: Paper['pages'];
  rawText: string;
  charCount: number;
}

export interface CachedCorpusIndex {
  cacheVersion: number;
  generatedBy: string;
  notLive: boolean;
  notice: string;
  meta: {
    generatedAt: string;
    model?: string;
    promptVersion?: string;
    domain?: string;
    domainConfirmed?: boolean;
    samplesAreDevOnly?: boolean;
    [k: string]: unknown;
  };
  papers: CachedPaperMeta[];
  methods: Method[];
  relations: Relation[];
  /** 字段与证据校验统计，便于界面与验证记录引用 */
  verification: {
    fieldsWithValue: number;
    fieldsEvidenceVerified: number;
    /** 有值但引文未能定位（待人工核对） */
    fieldsEvidenceFailed: number;
    /** 有值但模型没给引文（未找到证据） */
    fieldsNoEvidence: number;
    /** 论文未报告或未提取到 */
    fieldsMissing: number;
    totalFields: number;
  };
  /** 预置的跨论文分歧分析（真实模型离线生成） */
  divergences?: DivergenceReport;
  /** 预置的示例决策结果（对应 meta.demoProfile 这一组用户条件，明确标注为示例） */
  decisionSample?: ReadingPlan;
  /** 示例决策所用的用户条件，界面必须如实展示 */
  demoProfile?: {
    background: string;
    interest: string;
    time?: string;
    compute?: string;
    goal?: string;
  };
  /** 生成该缓存时的判定规则版本（与 RULES_VERSION 不一致即视为过期） */
  rulesVersion?: string;
  /** 生成该缓存时的输入（论文集合）签名，输入变化即视为过期 */
  inputsSignature?: string;
  /** 该缓存是否为「仅按新规则重算、未重新调用模型」的产物 */
  revalidatedOnly?: boolean;
}

/** 判断缓存相对当前规则/提示词/输入是否过期 */
export function assessCorpusStaleness(
  index: Pick<CachedCorpusIndex, 'cacheVersion' | 'meta' | 'rulesVersion' | 'inputsSignature'>,
  currentPromptVersion: string,
  currentInputsSignature: string,
): StalenessReport {
  const reasons: StalenessReport['reasons'] = [];
  const notes: string[] = [];

  if (index.cacheVersion !== CACHE_VERSION) {
    reasons.push('cache_format_changed');
    notes.push(`缓存文件结构版本为 ${index.cacheVersion}，当前程序为 ${CACHE_VERSION}。`);
  }
  if (index.rulesVersion && index.rulesVersion !== RULES_VERSION) {
    reasons.push('rules_version_changed');
    notes.push(`可比性/关系判定规则：缓存为 ${index.rulesVersion}，当前为 ${RULES_VERSION}。规则类结论已在界面实时重算。`);
  }
  const pv = index.meta?.promptVersion;
  if (pv && pv !== currentPromptVersion) {
    reasons.push('prompt_version_changed');
    notes.push(`提示词模板：缓存为 ${pv}，当前为 ${currentPromptVersion}。模型抽取类结果需要重新生成才能反映新模板。`);
  }
  if (index.inputsSignature && index.inputsSignature !== currentInputsSignature) {
    reasons.push('inputs_changed');
    notes.push('输入论文集合与生成缓存时不同。');
  }

  return { stale: reasons.length > 0, reasons, notes };
}

/** 兼容第一阶段缓存：把 assertedBy 迁移为 evidenceState */
export function migrateRelation(r: Relation): Relation {
  if (r.evidenceState) return r;
  const legacy = r.assertedBy ?? (r.evidence?.verified ? 'explicit' : 'inferred');
  return {
    ...r,
    evidenceState: legacy === 'explicit' ? 'explicit' : 'inferred',
    rationale:
      r.rationale ??
      (legacy === 'explicit' ? `论文原文明确陈述了该关系（p.${r.evidence?.page ?? '?'}）。` : '第一阶段缓存未记录推断理由。'),
  };
}

/**
 * 条件结构迁移（早期缓存只有 extraTrainingData，且缺少 scope / stage）：
 * - extraTrainingData → downstreamExtraData，并标记 structureMigrated；
 * - 预训练语料按需从 pretrainedModel 的取值中拆出；
 * - dataSplits 未按数据集绑定的，标记 needExperimentBinding（通过 note 与 structureMigrated 表达）。
 * 迁移不改变原始引文，只补齐新结构字段并明确标注「未经重新抽取」。
 */
export function migrateConditions(conditions?: ExperimentConditions): ExperimentConditions | undefined {
  if (!conditions) return undefined;
  const legacy = conditions as unknown as Record<string, ConditionValue | undefined>;
  const out = {} as ExperimentConditions;

  for (const dim of CONDITION_DIMENSIONS) {
    const existing = legacy[dim];
    if (existing) {
      out[dim] = { ...existing };
      continue;
    }
    out[dim] = { values: [], status: 'not_extracted' };
  }

  // 早期键名迁移
  const legacyExtra = legacy['extraTrainingData'];
  if (legacyExtra && !legacy['downstreamExtraData']) {
    out.downstreamExtraData = {
      ...legacyExtra,
      structureMigrated: true,
      note:
        (legacyExtra.note ? legacyExtra.note + '；' : '') +
        '该条目由早期的「额外训练数据」字段迁移而来，未按当前结构（预训练语料 / 下游额外数据 / 数据增强 + 适用范围）重新抽取。',
    };
  }

  // 预训练语料：从 pretrainedModel 的值里拆出含语料信息的条目
  const pm = out.pretrainedModel;
  if (pm && pm.values.length && out.pretrainingCorpus.values.length === 0) {
    const corpusLike = pm.values.filter((v) => /corpus|corpora|wikipedia|bookscorpus|common crawl|web ?text/i.test(v));
    if (corpusLike.length) {
      out.pretrainingCorpus = {
        values: corpusLike,
        status: pm.status,
        evidence: pm.evidence,
        note: '该条目由「预训练模型」字段中拆出，未按当前结构重新抽取。',
        structureMigrated: true,
      };
    }
  }

  // 数据划分：早期条目没有「数据集：」前缀，无法按数据集对应比较
  if (out.dataSplits.values.length && !out.dataSplits.values.some((v) => /[:：]/.test(v))) {
    out.dataSplits = {
      ...out.dataSplits,
      structureMigrated: true,
      note:
        (out.dataSplits.note ? out.dataSplits.note + '；' : '') +
        '该条目未绑定具体数据集，无法与其它论文的同一实验对应比较，需要重新抽取。',
    };
  }

  return out;
}

/** 兼容第一阶段缓存：把两态字段状态迁移为四态，并补齐条件结构 */
export function migrateMethod(m: Method): Method {
  const fields = { ...m.fields };
  for (const k of FIELD_KEYS_ORDER) {
    const r = fields[k];
    if (!r) continue;
    const legacy = (r as unknown as { status: string }).status;
    if (legacy === 'ok' || legacy === 'verified') fields[k] = { ...r, status: 'verified' };
    else if (legacy === 'partial' || legacy === 'unverified') fields[k] = { ...r, status: r.value ? 'unverified' : 'missing' };
    else if (legacy === 'missing') fields[k] = { ...r, status: 'missing' };
    else if (legacy === 'no_evidence') fields[k] = { ...r, status: 'no_evidence' };
  }
  return { ...m, fields, conditions: migrateConditions(m.conditions) };
}

export function methodToCache(m: Method): Method {
  return { ...m, cached: true };
}

/** 统计某方法集合的字段与证据校验情况（离线脚本与浏览器共用） */
export function buildVerificationStat(methods: Method[]): CachedCorpusIndex['verification'] {
  let withValue = 0;
  let verified = 0;
  let noEvidence = 0;
  let notLocated = 0;
  let missing = 0;
  let total = 0;
  for (const m of methods) {
    for (const k of FIELD_KEYS_ORDER) {
      total++;
      const r = m.fields[k];
      if (r?.value) withValue++;
      switch (r?.status) {
        case 'verified':
          verified++;
          break;
        case 'no_evidence':
          noEvidence++;
          break;
        case 'unverified':
          notLocated++;
          break;
        default:
          missing++;
      }
    }
  }
  return {
    fieldsWithValue: withValue,
    fieldsEvidenceVerified: verified,
    fieldsEvidenceFailed: notLocated,
    fieldsNoEvidence: noEvidence,
    fieldsMissing: missing,
    totalFields: total,
  };
}

export interface LoadedCorpus {
  index: CachedCorpusIndex;
  /** 已加载全文的论文 id 集合 */
  textLoaded: Set<string>;
}

/**
 * 读取构建指纹，用作静态资源的版本查询串。
 * 原因：部署通道是静态托管，样本 JSON 会被 CDN 按 URL 缓存；若不带版本串，
 * 重新部署后访问者可能读到旧语料（实测出现过）。构建脚本会把指纹写入 build.json。
 */
let buildIdPromise: Promise<string> | undefined;
function currentBuildId(): Promise<string> {
  if (!buildIdPromise) {
    buildIdPromise = fetch('./build.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => (typeof j?.buildId === 'string' ? j.buildId : 'dev'))
      .catch(() => 'dev');
  }
  return buildIdPromise;
}

/** 浏览器端加载缓存索引（自动带构建指纹，避免读到 CDN 缓存的旧语料） */
export async function loadCorpusIndex(base = './samples/'): Promise<{ index: CachedCorpusIndex; formatMismatch?: string }> {
  const v = await currentBuildId();
  const res = await fetch(`${base}index.json?v=${v}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`预置语料索引加载失败（HTTP ${res.status}）。`);
  const data = (await res.json()) as CachedCorpusIndex;
  // 版本不一致不再直接失败：旧结构由 migrateMethod/migrateRelation 迁移，并作为过期原因上报给界面。
  const formatMismatch =
    data.cacheVersion !== CACHE_VERSION
      ? `缓存文件结构版本为 ${data.cacheVersion}，当前程序为 ${CACHE_VERSION}；已按当前结构迁移加载，相关结果标记为过期。`
      : undefined;
  return { index: data, formatMismatch };
}

/** 按需加载某篇论文的全文（用于证据上下文展示） */
export async function loadPaperText(paperId: string, base = './samples/'): Promise<CachedPaperText> {
  const v = await currentBuildId();
  const res = await fetch(`${base}text/${paperId}.json?v=${v}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`论文全文加载失败（HTTP ${res.status}）：${paperId}`);
  return (await res.json()) as CachedPaperText;
}

/** 把缓存元数据补成完整 Paper（全文需另行注入） */
export function hydratePaper(meta: CachedPaperMeta | Paper, text?: CachedPaperText): Paper {
  const base = meta as unknown as Paper;
  const pages = text?.pages ?? base.pages ?? [];
  return {
    ...base,
    pages,
    rawText: text?.rawText ?? base.rawText ?? '',
    charCount: text?.charCount ?? base.charCount ?? 0,
    // 页数未知时保持 undefined，界面显示「页数未知」而不是 0
    pageCount: text?.pages?.length ?? base.pageCount ?? (base.pages?.length || undefined),
  };
}

export function fieldLabel(k: FieldKey): string {
  return METHOD_FIELD_LABELS[k];
}
