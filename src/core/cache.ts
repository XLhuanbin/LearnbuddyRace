/**
 * 预置语料缓存格式与加载。
 *
 * 缓存由 scripts/analyze.mjs 在本地用真实模型生成，浏览器端只负责读取与展示。
 * 界面必须明确区分「预置样例（缓存）」与「本次实时分析」，二者不可混淆。
 */

import type {
  ConditionDimension,
  ConditionValue,
  CorpusId,
  DivergenceReport,
  ExperimentConditions,
  FieldKey,
  Method,
  Paper,
  ReadingPlan,
  Relation,
} from './types';
import { CONDITION_DIMENSIONS, METHOD_FIELD_LABELS } from './types';
import { RULES_VERSION, assessRelationEvidence, type StalenessReport } from './rules';
import { validateRelation } from './validate';

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

/**
 * 兼容第一阶段缓存：把已废弃的 assertedBy 迁移为 evidenceState。
 *
 * 两条硬约束（2026-10-08 集成阶段补齐）：
 * 1. **旧标签不是结论**：`assertedBy: 'explicit'` 只代表当时那次调用的说法，不能直接当「原文明示」；
 * 2. **引文能定位也不等于足以支撑**：`evidence.verified` 只说明这段文字在原文里找得到，
 *    不说明它支撑该关系（例如引文压根没提到被继承的方法名）。充分性必须过 `assessRelationEvidence`。
 *
 * 因此 explicit 仅在「引文已定位 **且** 通过充分性判定」时保留；拿不到方法信息（迁移时传不进 methods）
 * 或不足以判定时一律降为「待核查」，并在 stateAdjusted 里写明原因 —— 降级不删除数据，只降可信度。
 */
export function migrateRelation(r: Relation, methods?: Method[]): Relation {
  if (r.evidenceState) return r;
  const legacyLabel = (r as unknown as { assertedBy?: string }).assertedBy;
  /** 旧标签只作为「当时认为是什么」的提示，不作为结论 */
  const wanted: Relation['evidenceState'] =
    legacyLabel === 'explicit' ? 'explicit' : legacyLabel === 'inferred' ? 'inferred' : 'candidate';

  let evidenceState: Relation['evidenceState'] = 'candidate';
  let downgradeReason = '';
  if (wanted === 'explicit') {
    const fromMethod = methods?.find((m) => m.id === r.fromMethodId);
    const toMethod = methods?.find((m) => m.id === r.toMethodId);
    const located = r.evidence?.verified === true;
    const assessment =
      located && fromMethod && toMethod
        ? assessRelationEvidence(
            r.evidence?.quote ?? '',
            fromMethod.fields.methodName.value,
            toMethod.fields.methodName.value,
            r.type,
          )
        : undefined;
    if (assessment?.sufficient) {
      evidenceState = 'explicit';
    } else {
      downgradeReason = !located
        ? '旧格式缓存的关系没有可核验的原文引文'
        : !fromMethod || !toMethod
          ? '迁移时拿不到关系两端的方法信息，无法校验引文是否足以支撑该关系'
          : `引文不足以支撑「原文明示」（${assessment?.reason ?? '理由不足'}）`;
    }
  } else if (wanted === 'inferred') {
    evidenceState = 'inferred';
  } else {
    downgradeReason = '旧格式缓存既没有关系状态标签，也没有可核验的原文引文';
  }

  return {
    ...r,
    evidenceState,
    rationale:
      r.rationale ??
      (evidenceState === 'explicit'
        ? `论文原文明确陈述了该关系（p.${r.evidence?.page ?? '?'}）。`
        : '第一阶段缓存未记录推断理由。'),
    ...(downgradeReason
      ? {
          stateAdjusted: [
            ...(r.stateAdjusted ?? []),
            { from: wanted, to: evidenceState, reason: `${downgradeReason}；迁移后按「待核查」处理，需人工核对。` },
          ],
        }
      : {}),
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
    if (legacy === 'ok' || legacy === 'verified') {
      /**
       * 「可核验」的判据是**有可核验的原文引文**（evidence.verified），不是旧格式里的状态词。
       * 2026-10-08 集成阶段补齐：此前只认状态词，旧缓存里「写了 verified 但引文缺失/未定位」的字段
       * 会被显示成「可核验」，同时又被 validateMethod 报一条「没有提供任何原文引文」——
       * 同一条字段两处说法自相矛盾，而且会被 Library.verifiedOf 算进「已核验字段数」。
       * 现在：有值但证据不成立 → 待人工核对；连值都没有 → 缺失。
       */
      if (r.evidence?.verified === true && r.value) {
        fields[k] = { ...r, status: 'verified' };
      } else if (r.value) {
        fields[k] = {
          ...r,
          status: 'unverified',
          note: r.note ?? '迁移自旧格式：该字段没有可核验的原文引文，未标为「可核验」，需人工核对。',
        };
      } else {
        fields[k] = { ...r, status: 'missing' };
      }
    } else if (legacy === 'partial' || legacy === 'unverified') fields[k] = { ...r, status: r.value ? 'unverified' : 'missing' };
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

/**
 * 把从文件读到的缓存索引**规整为当前格式**（预置语料加载的唯一迁移入口）。
 *
 * 为什么需要：旧版缓存（cacheVersion 落后）里的方法字段状态是两态（ok / partial / …），
 * 条件结构缺维度，关系用已废弃的 `assertedBy`；而界面与下游只认当前四态字段与完整条件结构。
 * 迁移由 `migrateMethod` / `migrateRelation` 完成，二者对**当前格式是语义幂等**的
 * （已用独立脚本核验：`samples` / `samples-vision` 两份真实缓存迁移前后 0 差异）。
 *
 * 修复的真实缺陷：此前 `migrateMethod` 只在「从本机 IndexedDB 恢复记录」的路径上被调用
 * （App 侧），而从**语料文件**加载（本函数）这条路径没有迁移 —— 同一份数据两条路口径不一致：
 * 本地恢复会被迁移，语料加载却不会，旧格式缓存会带旧口径进入界面。把迁移收进本函数后，
 * 两条加载路径都经过同一层。
 */
export function normalizeCorpusIndex(data: CachedCorpusIndex): CachedCorpusIndex {
  const methods = (data.methods ?? []).map(migrateMethod);
  return {
    ...data,
    methods,
    // 关系迁移要能校验「引文是否足以支撑该关系」，必须把方法名一起传进去
    relations: (data.relations ?? []).map((r) => migrateRelation(r, methods)),
  };
}

/**
 * 本机恢复（刷新恢复）路径的统一归一：**迁移 + 按当前规则重跑关系证据校验**。
 *
 * 与预置语料加载路径（normalizeCorpusIndex → revalidateCachedRelations）口径一致：
 * 迁移只补结构；关系是不是「原文明示」必须过证据校验。
 * 充分性判定只依赖引文与方法名（不需要论文全文），所以本机恢复时无需先把全文读出来。
 */
export function normalizeRestoredData(
  methods: Method[],
  relations: Relation[],
  papers: Paper[],
): { methods: Method[]; relations: Relation[]; notes: string[] } {
  const migratedMethods = methods.map(migrateMethod);
  const migratedRelations = relations.map((r) => migrateRelation(r, migratedMethods));
  // 本机数据没有逐条记录「生成时的规则版本」，这里只做证据校验，不做版本强制降级
  //（版本不一致的过期提示由预置语料路径的 assessCorpusStaleness 负责）
  const check = revalidateCachedRelations(migratedRelations, migratedMethods, papers, { rulesVersionChanged: false });
  return { methods: migratedMethods, relations: check.relations, notes: check.notes };
}

/** 浏览器端加载缓存索引（自动带构建指纹，避免读到 CDN 缓存的旧语料） */
export async function loadCorpusIndex(base = './samples/'): Promise<{ index: CachedCorpusIndex; formatMismatch?: string }> {
  const v = await currentBuildId();
  const res = await fetch(`${base}index.json?v=${v}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`预置语料索引加载失败（HTTP ${res.status}）。`);
  const raw = (await res.json()) as CachedCorpusIndex;
  // 版本不一致不再直接失败：旧结构由 migrateMethod/migrateRelation 迁移，并作为过期原因上报给界面。
  const formatMismatch =
    raw.cacheVersion !== CACHE_VERSION
      ? `缓存文件结构版本为 ${raw.cacheVersion}，当前程序为 ${CACHE_VERSION}；已按当前结构迁移加载，相关结果标记为过期。`
      : undefined;
  // 对外一律返回**已迁移**的索引：两条加载路径（本地恢复 / 语料文件）结构口径一致。
  return { index: normalizeCorpusIndex(raw), formatMismatch };
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

/* ============================ 全文目录与缓存关系重校验 ============================ */

/**
 * 论文全文所在的语料目录。
 *
 * 视觉案例的全文在 `samples-vision/text/`，**不在** `samples/text/` ——
 * 早先一律用默认的 `./samples/`，于是视觉案例的论文永远取不到全文，
 * 表现是：证据打不开、关系分析缺少 rawText 却仍显示「可分析」。
 */
export function corpusBaseOfPaper(corpusId?: CorpusId): string {
  return corpusId === 'vision-classification' ? './samples-vision/' : './samples/';
}

/**
 * 缓存加载时按**当前规则**重新校验关系。
 *
 * 为什么必须做：缓存里的 evidenceState 是生成缓存那一刻的判定结论。
 * 规则版本变了以后，旧结论不能继续冒充当前的「原文明示 / 系统推断」。
 *
 * 行为：
 * 1. 每条关系都重跑一次当前的关系证据判定（validateRelation）；
 * 2. 规则版本与当前不一致时，仍未重新判定的 explicit / inferred 一律降级为「待核查」，
 *    并记录降级原因（不删除数据，只降可信度）。
 */
export function revalidateCachedRelations(
  relations: Relation[],
  methods: Method[],
  papers: Paper[],
  opts: { cachedRulesVersion?: string; rulesVersionChanged: boolean },
): { relations: Relation[]; downgraded: number; notes: string[] } {
  const notes: string[] = [];
  let downgraded = 0;

  const out = relations.map((r) => {
    const { relation } = validateRelation(r, methods, papers);
    let next = relation;
    if (opts.rulesVersionChanged && (next.evidenceState === 'explicit' || next.evidenceState === 'inferred')) {
      const from = next.evidenceState;
      next = {
        ...next,
        evidenceState: 'candidate',
        stateAdjusted: [
          ...(next.stateAdjusted ?? []),
          {
            from,
            to: 'candidate',
            reason: `缓存生成时的规则版本为 ${opts.cachedRulesVersion ?? '未知'}，当前为 ${RULES_VERSION}；未按新规则重新判定前，旧结论不作为当前结论。`,
          },
        ],
      };
    }
    if (next.evidenceState !== r.evidenceState) downgraded += 1;
    return next;
  });

  if (opts.rulesVersionChanged) {
    notes.push(
      `关系判定规则已从 ${opts.cachedRulesVersion ?? '未知'} 变为 ${RULES_VERSION}：${relations.length} 条缓存关系已按「待核查」处理，需要重新分析关系后才能作为当前结论。`,
    );
  }
  return { relations: out, downgraded, notes };
}
