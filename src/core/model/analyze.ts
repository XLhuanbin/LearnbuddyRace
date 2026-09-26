/**
 * 分析编排层：方法抽取 / 关系推断 / 方法决策 / 分歧发现。
 * 上层界面只调用这里，模型与提示词的差异都被隔离在本层。
 *
 * 所有模型输出都会经过 validate.ts 的程序校验后才交给界面。
 */

import type {
  CandidateMethod,
  Evidence,
  ConditionDimension,
  ConditionValue,
  DivergenceFinding,
  DivergenceReport,
  ExperimentConditions,
  FieldKey,
  Method,
  MethodFieldResult,
  Paper,
  PlanStep,
  ReadingPlan,
  Relation,
  RelationEvidenceState,
  RelationType,
  ResearchQuestion,
  UserProfile,
  ValidationIssue,
} from '../types';
import { CONDITION_DIMENSIONS, METHOD_FIELD_LABELS } from '../types';
import type { ExecutionAssessment, ExperimentRecord, ResourceFeasibility, TaskTag, TrainingStage } from '../types';
import { canonicalDatasetName } from '../experiments';
import { locateNear, locateQuote } from '../text';
import { selectExcerpt } from '../excerpt';
import { buildEvidence } from '../evidence';
import { compareConditions, comparePair, differingDimensions, emptyConditions, LEVEL_LABELS, pairLevel } from '../comparability';
import { RULES_VERSION, assessClaimScope, assessRelationEvidence, looksLikeNegation, looksLikeTitle, normalizeConditions } from '../rules';
import { applyDivergenceRules, buildCheckedPairs } from '../divergenceRules';
import { buildRelationHints } from '../relationCandidates';
import { findWeightsAvailability } from '../inferenceReadiness';
import { validateMethod, validateRelation } from '../validate';
import {
  ModelError,
  chat,
  optionalArrayField,
  parseJsonObject,
  requireArrayField,
  requireArrayOfObjects,
  type CallTrace,
} from './client';
import { withEffectiveMethods } from '../effective';
import {
  PROMPT_VERSION,
  decisionSystemPrompt,
  decisionUserPrompt,
  divergenceSystemPrompt,
  divergenceUserPrompt,
  extractionSystemPrompt,
  extractionUserPrompt,
  relationSystemPrompt,
  relationUserPrompt,
} from './prompts';

export interface RunConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxAttempts?: number;
  /** 外部取消信号（用户停止等待）：只停止本地等待 */
  signal?: AbortSignal;
}

const FIELD_KEYS: FieldKey[] = [
  'researchTask',
  'methodName',
  'coreIdea',
  'inputsConditions',
  'datasets',
  'metrics',
  'limitations',
];

interface RawField {
  value?: string | null;
  quote?: string | null;
  page?: number | string | null;
  status?: string;
  fieldStatus?: string;
  note?: string;
}

interface RawCondition {
  values?: (string | null)[] | null;
  quote?: string | null;
  page?: number | string | null;
  status?: string;
  note?: string;
  /** 适用范围：paper=整篇论文，experiment=某个具体实验 */
  scope?: string;
  /** scope=experiment 时说明哪个实验（任务/数据集/表） */
  scopeDetail?: string;
  /** 算力类条目的训练阶段 */
  stage?: string;
}

function toPage(v: number | string | null | undefined): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function toStringArray(v: (string | null)[] | null | undefined): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && x.toLowerCase() !== 'null');
}

/* ============================ 方法抽取 ============================ */

export async function extractMethod(
  paper: Paper,
  cfg: RunConfig,
  onTrace?: (t: CallTrace) => void,
): Promise<Method> {
  const { text: excerpt, usedSections, excerpted } = selectExcerpt(
    paper.rawText,
    24000,
    paper.pages.map((p) => ({ page: p.page, offset: p.offset })),
  );

  const { text } = await chat(
    {
      signal: cfg.signal,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages: [
        { role: 'system', content: extractionSystemPrompt() },
        { role: 'user', content: extractionUserPrompt(paper.title, excerpt, usedSections, excerpted) },
      ],
      temperature: 0,
      maxTokens: 8000,
      json: true,
      timeoutMs: cfg.timeoutMs ?? 120_000,
      maxAttempts: cfg.maxAttempts ?? 3,
      label: `extract:${paper.id.slice(0, 8)}`,
    },
    onTrace,
  );

  const raw = parseJsonObject(text, '字段抽取结果') as { paperTitle?: string } & Record<string, unknown>;

  // 顶层 fields 出现时必须是对象（写成数组/字符串说明模型没按结构返回，按失败处理）
  if (raw.fields !== undefined && (typeof raw.fields !== 'object' || raw.fields === null || Array.isArray(raw.fields))) {
    throw new ModelError('模型返回的字段抽取结果里，fields 不是对象，已按失败处理。', 'format', JSON.stringify(raw.fields)?.slice(0, 200));
  }
  // 顶层 conditions 出现时必须是对象
  if (raw.conditions !== undefined && (typeof raw.conditions !== 'object' || raw.conditions === null || Array.isArray(raw.conditions))) {
    throw new ModelError('模型返回的字段抽取结果里，conditions 不是对象，已按失败处理。', 'format', JSON.stringify(raw.conditions)?.slice(0, 200));
  }

  // 兼容 v1（字段直接在顶层）与 v2（字段在 fields 下）
  const rawFields: Record<string, RawField> = (raw.fields as Record<string, RawField>) ?? (raw as unknown as Record<string, RawField>);
  if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) {
    throw new ModelError('模型返回的字段抽取结果里没有可用的字段对象，已按失败处理。', 'format');
  }
  const rawConditions = (raw.conditions as Record<string, RawCondition>) ?? {};

  const rawTitle = (raw.paperTitle || '').toString().trim();
  const head = paper.rawText.slice(0, Math.min(paper.rawText.length, 6000));
  const titleVerified = !!rawTitle && !!locateQuote(head, rawTitle);

  const fields = {} as Record<FieldKey, MethodFieldResult>;
  for (const key of FIELD_KEYS) {
    const item = rawFields[key];
    const value = (item?.value ?? '').toString().trim();
    const declaredMissing =
      (item?.status || item?.fieldStatus || '').toLowerCase() === 'missing' || !value;
    const claimedPage = toPage(item?.page);

    if (declaredMissing) {
      fields[key] = {
        value: undefined,
        status: 'missing',
        note: item?.note?.trim() || (value ? '未提取到' : '论文未报告'),
      };
      continue;
    }

    const quote = (item?.quote ?? '')?.toString().trim();
    if (!quote) {
      fields[key] = {
        value,
        status: 'no_evidence',
        note: item?.note?.trim() || '模型给出了内容但没有提供原文引文',
        claimedPage,
      };
      continue;
    }

    const evidence = buildEvidence(paper, { quote });
    fields[key] = evidence?.verified
      ? { value, status: 'verified', evidence, note: item?.note?.trim() || undefined, claimedPage }
      : {
          value,
          status: 'unverified',
          evidence,
          note: evidence?.verifyNote || '该字段的引文未通过定位校验',
          claimedPage,
        };
  }

  // 条件抽取（按当前结构；兼容早期缓存里的 extraTrainingData 键）
  const conditions: ExperimentConditions = emptyConditions();
  for (const dim of CONDITION_DIMENSIONS) {
    const item =
      rawConditions[dim] ??
      (dim === 'downstreamExtraData' ? rawConditions['extraTrainingData'] : undefined);
    if (!item) continue;
    const status = (item.status || '').toLowerCase();
    const values = toStringArray(item.values);
    const quote = (item.quote ?? '')?.toString().trim();
    const claimedPage = toPage(item.page);
    const scopeRaw = (item.scope || '').toLowerCase();
    let scope: ConditionValue['scope'] =
      scopeRaw === 'paper' || scopeRaw === 'experiment' ? (scopeRaw as 'paper' | 'experiment') : scopeRaw === 'unknown' ? 'unknown' : undefined;
    const stageRaw = (item.stage || '').toLowerCase();
    const stage: ConditionValue['stage'] =
      (['pretrain', 'finetune', 'inference', 'from_scratch', 'distill'] as const).includes(stageRaw as never)
        ? (stageRaw as ConditionValue['stage'])
        : undefined;

    let resolved: ConditionValue['status'];
    let evidence;
    let note = item.note?.trim() || undefined;
    let scopeDetail = item.scopeDetail?.trim() || undefined;

    if (status === 'not_reported') {
      resolved = 'not_reported';
    } else if (status === 'unclear') {
      resolved = 'unclear';
    } else if (!values.length && !quote) {
      resolved = 'not_extracted';
      note = note || '本次片段中未提取到';
    } else if (!quote) {
      resolved = 'unverified';
      note = note || '该条目没有提供引文，无法核验';
    } else {
      evidence = buildEvidence(paper, { quote });
      resolved = evidence?.verified ? 'verified' : 'unverified';
      if (!evidence?.verified) note = note || evidence?.verifyNote;
    }

    // 范围检查统一在 rules.normalizeConditions 中实现（与离线重算共用同一套规则）
    conditions[dim] = { values, status: resolved, evidence, note, claimedPage, scope, scopeDetail, stage };

    conditions[dim] = { values, status: resolved, evidence, note, claimedPage, scope, scopeDetail, stage };
  }

  const normalized = normalizeConditions(conditions);


  // ---------- 实验记录（以实验为单位；含表格语境核查与来源名称规范化）----------
  const experiments = parseExperimentRecords(paper, raw as Record<string, unknown>);

  const method: Method = {
    id: `m_${paper.id}`,
    paperId: paper.id,
    fields,
    conditions: normalized,
    experiments,
    overrides: [],
    model: cfg.model,
    promptVersion: PROMPT_VERSION,
    extractedAt: Date.now(),
    cached: false,
    paperTitleGuess: rawTitle && titleVerified ? rawTitle.slice(0, 250) : undefined,
  };

  method.validation = validateMethod(paper, method);
  return method;
}

/**
 * 用「已在原文中验证」的模型标题校正启发式标题。
 *
 * 三种结果必须分得清：
 * ① 模型标题可用 → 采用，标 `model-verified`；
 * ② 模型没给/不可用，但原启发式标题本身像标题 → 保持原样（不宣称已确认）；
 * ③ 模型没给/不可用，且原启发式标题**也不像标题**（实测：DDPM 这类 PDF 会把摘要句抓成标题）
 *    → 必须标 `unverified`，界面据此显示「标题待确认」。
 *    旧实现在 ②③ 合并的分支里直接 `return paper`，导致摘要句一直挂着「已确认」的样子。
 */
export function applyTitleCorrection(paper: Paper, method: Method): Paper {
  const guess = method.paperTitleGuess;
  if (guess && guess !== paper.title && looksLikeTitle(guess)) {
    return { ...paper, title: guess, titleFrom: 'model-verified' };
  }
  if (looksLikeTitle(paper.title)) return paper;
  return { ...paper, titleFrom: 'unverified' };
}

export interface ExtractProgressEvent {
  paperId: string;
  stage: 'excerpt' | 'model' | 'verify' | 'done';
  message: string;
  trace?: CallTrace;
}

export async function extractMethodWithProgress(
  paper: Paper,
  cfg: RunConfig,
  onEvent: (e: ExtractProgressEvent) => void,
): Promise<Method> {
  onEvent({ paperId: paper.id, stage: 'excerpt', message: `裁剪原文，送入模型（全文 ${paper.charCount} 字）` });
  const method = await extractMethod(paper, cfg, (t) =>
    onEvent({ paperId: paper.id, stage: 'model', message: '', trace: t }),
  );
  const verified = FIELD_KEYS.filter((k) => method.fields[k].status === 'verified').length;
  const withValue = FIELD_KEYS.filter((k) => method.fields[k].value).length;
  const condVerified = CONDITION_DIMENSIONS.filter((d) => method.conditions?.[d].status === 'verified').length;
  onEvent({
    paperId: paper.id,
    stage: 'verify',
    message: `校验：字段有值 ${withValue}/${FIELD_KEYS.length}、可核验 ${verified}/${FIELD_KEYS.length}；实验条件可核验 ${condVerified}/${CONDITION_DIMENSIONS.length}`,
  });
  return method;
}

/** 从文本里解析 GPU/加速卡数量（"1024 V100 GPU" → 1024；"8 卡 A100" → 8；"笔记本 / 无 GPU" → 0；无法判断 → null） */
const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/**
 * 从文本里解析加速卡数量。
 * 覆盖：数字+型号（"1024 V100" / "8 x P100" / "8 卡 A100"）、消费级型号（"一张 RTX 3090" / "单卡 3090"）、
 * 以及「笔记本 / 无 GPU」这类明确没有加速卡的情况；无法判断时返回 null（不猜）。
 */
export function parseGpuCount(text?: string): number | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (/(笔记本|laptop|无\s*GPU|没有\s*GPU|no\s+gpu|CPU\s*only|仅\s*CPU|无\s*显卡)/i.test(t)) return 0;

  const patterns = [
    /(\d+)\s*(?:x|×|卡|块|张|台|个)?\s*(?:NVIDIA\s+)?(?:V100|P100|A100|A800|H100|H800|3090|4090|2080|3080|A6000|A40|TPU|GPU|加速卡)/i,
    /(?:NVIDIA\s+)?(?:RTX|GTX|Tesla|Radeon)\s*\d{3,4}[^0-9]{0,8}(\d+)\s*(?:卡|块|张)/i,
    // 单位词后必须紧跟数字，避免把型号里的数字（如 A100 的 100）当数量
    /(?:GPU|TPU|卡|加速卡)[^0-9A-Za-z]{0,4}(\d+)(?![0-9])/i,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  // 中文数量词 + 型号（"一张 RTX 3090" / "两张 A100"）
  const cn = /([一二两三四五六七八九十])\s*(?:张|块|台|个)?\s*(?:NVIDIA\s+)?(?:RTX|GTX|Tesla|Radeon|V100|P100|A100|A800|H100|H800|GPU|TPU|卡|加速卡)/i.exec(t);
  if (cn) return CN_NUM[cn[1]] ?? null;
  if (/单卡|一张卡|一块卡|一张 GPU/i.test(t)) return 1;
  return null;
}

/** 判断算力条目里是否给出了「显存 / 并行 / 具体配置」这类可用于判断可运行性的证据 */
export function hasConfigEvidence(text?: string): boolean {
  return /(\d+\s*(?:GB|TB)|显存|memory|VRAM|节点|nodes?|DGX|并行|parallel|per-?GPU|梯度累积|gradient accumulation|batch size|分布式)/i.test(
    text ?? '',
  );
}

const FEASIBILITY_NOTES: Record<ResourceFeasibility, string> = {
  stage_evidence_available:
    '论文报告了与用户目标阶段一致的算力，且用户可及的规模不低于论文报告值；但仍缺少显存、并行策略、训练配置与可缩放实现的证据，因此「可行性」仍未验证。',
  below_paper_scale:
    '论文报告的该阶段规模高于用户可及资源；缺少显存、并行策略与可缩放实现证据，不能用更长的可用时间反推「能够复现」。',
  user_scale_unknown: '用户算力描述无法解析出可比的规模（例如只写了「有服务器」），无法与论文报告值对照。',
  paper_count_unknown: '论文只给出硬件类型与时长，没有可比的规模数字，无法判断用户资源是否满足。',
  no_matching_stage_evidence: '论文没有报告与用户目标阶段一致的算力，无法据此判断可运行性。',
};

function modelFitOf(cand: CandidateMethod): CandidateMethod['fit'] {
  return cand.fit;
}



interface RawRelation {
  from?: string;
  to?: string;
  type?: string;
  evidenceState?: string;
  assertedBy?: string;
  quote?: string | null;
  /** 允许模型给出多个候选片段，程序会逐条定位并挑选能支撑判定的那一条 */
  quotes?: (string | null)[];
  page?: number | string | null;
  rationale?: string | null;
}

const RELATION_TYPES: RelationType[] = ['extends', 'improves', 'combines', 'similar', 'unclear'];

export async function inferRelations(
  papers: Paper[],
  methods: Method[],
  cfg: RunConfig,
  onTrace?: (t: CallTrace) => void,
): Promise<{ relations: Relation[]; issues: ValidationIssue[] }> {
  const empty: { relations: Relation[]; issues: ValidationIssue[] } = { relations: [], issues: [] };
  if (methods.length < 2) return empty;
  // 关系判定与送给模型的材料都必须使用人工修正后的有效字段值
  methods = withEffectiveMethods(methods);

  const paperById = new Map(papers.map((p) => [p.id, p]));
  const materials = methods.map((m) => {
    const p = paperById.get(m.paperId);
    return {
      id: m.id,
      label: p?.title ?? m.paperId,
      methodName: m.fields.methodName.value,
      coreIdea: m.fields.coreIdea.value?.slice(0, 400),
      year: p?.year,
      evidenceQuote:
        [m.fields.methodName.evidence?.quote, m.fields.coreIdea.evidence?.quote].filter(Boolean).join(' | ').slice(0, 400) ||
        undefined,
    };
  });

  // 交叉引用线索：先用确定性检索找出「含被继承方法名 + 含关系措辞」的候选句子，
  // 再附一段方法名附近的上下文窗口。实测：不做句子级检索会漏掉可直接认证关系的句子。
  const { text: relationsHint, candidateCount } = buildRelationHints(
    papers,
    methods.map((m) => ({ id: m.id, paperId: m.paperId, methodName: m.fields.methodName.value })),
  );
  onTrace?.({ label: "relation-candidates:" + candidateCount, attempt: 1, ms: 0, promptChars: relationsHint.length, completionChars: 0 } as CallTrace);
  const { text } = await chat(
    {
      signal: cfg.signal,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages: [
        { role: 'system', content: relationSystemPrompt() },
        { role: 'user', content: relationUserPrompt(materials, relationsHint) },
      ],
      temperature: 0,
      maxTokens: 6000,
      json: true,
      timeoutMs: cfg.timeoutMs ?? 120_000,
      maxAttempts: cfg.maxAttempts ?? 3,
      label: 'relations',
    },
    onTrace,
  );

  const parsed = parseJsonObject(text, '关系分析结果');
  const rawRelations = requireArrayOfObjects(
    requireArrayField(parsed, 'relations', '关系分析结果'),
    '关系分析结果.relations',
  ) as unknown as RawRelation[];
  return assembleRelationsFromModel(rawRelations, papers, methods);
}

/**
 * 把模型给出的原始关系数组装配成 Relation（纯函数，便于回归测试）。
 *
 * 三条不可妥协的规则：
 * 1. **有向**去重：A→B 与 B→A 是两条不同的关系，不能按无向键合并掉一条；
 * 2. **candidate 保持 candidate**：不把「待核查」升级成「系统推断」；
 * 3. **证据只在关系两端的论文里定位**：定位失败 → verified=false、不填页码（模型自称的页码一律不采信）。
 */
export function assembleRelationsFromModel(
  rawRelations: RawRelation[],
  papers: Paper[],
  methods: Method[],
): { relations: Relation[]; issues: ValidationIssue[] } {
  const paperById = new Map(papers.map((p) => [p.id, p]));
  const validIds = new Set(methods.map((m) => m.id));
  const out: Relation[] = [];
  const issues: ValidationIssue[] = [];
  /** 有向去重键：A→B 与 B→A 是两条不同的关系，不能按无向键合并掉一条 */
  const seen = new Set<string>();

  rawRelations.forEach((r, i) => {
    const from = r.from || '';
    const to = r.to || '';
    if (!validIds.has(from) || !validIds.has(to) || from === to) return;
    const key = `${from}->${to}`;
    if (seen.has(key)) return;
    seen.add(key);

    const type = (RELATION_TYPES as string[]).includes(r.type || '') ? (r.type as RelationType) : 'unclear';
    const stateRaw = (r.evidenceState || r.assertedBy || '').toLowerCase();
    /**
     * candidate 必须保持 candidate：不能把「待核查」映射成「系统推断」——
     * 那等于凭空给模型的不确定结论升级了可信度。
     */
    const evidenceState: RelationEvidenceState =
      stateRaw === 'explicit' ? 'explicit' : stateRaw === 'inferred' ? 'inferred' : 'candidate';

    const fromMethod = methods.find((m) => m.id === from)!;
    const toMethod = methods.find((m) => m.id === to)!;
    const fromPaper = paperById.get(fromMethod.paperId);
    const toPaper = paperById.get(toMethod.paperId);
    /** 证据只能来自这条关系两端的论文 */
    const endpointPaperIds = new Set([fromMethod.paperId, toMethod.paperId]);

    // 「A 基于 B」通常写在 A 的论文里 ⇒ 先查 to 方，再查 from 方。
    // 不再兜底到 collection 里的其它论文：用第三篇论文的句子认证 A→B 是无效证据。
    const searchOrder: Paper[] = [toPaper, fromPaper].filter(Boolean) as Paper[];
    const rawQuotes = [r.quote, ...(r.quotes ?? [])]
      .filter((q): q is string => typeof q === 'string')
      .map((q) => q.trim())
      .filter((q) => q.length >= 20);
    const uniqueQuotes = [...new Set(rawQuotes)];

    const located: Evidence[] = [];
    let unlocated: Evidence | undefined;
    for (const q of uniqueQuotes) {
      let hit: Evidence | undefined;
      const seenPaper = new Set<string>();
      for (const cand of searchOrder) {
        if (seenPaper.has(cand.id)) continue;
        seenPaper.add(cand.id);
        const ev = buildEvidence(cand, { quote: q });
        if (ev?.verified) {
          hit = ev;
          break;
        }
      }
      if (hit && endpointPaperIds.has(hit.paperId)) located.push(hit);
      else if (!unlocated) unlocated = buildEvidence(toPaper ?? fromPaper!, { quote: q });
    }

    // 若模型声称原文明示，优先选择「确实能认证该关系」的那一条片段作为主证据
    let primary: Evidence | undefined;
    if (evidenceState === 'explicit') {
      primary = located.find(
        (ev) =>
          assessRelationEvidence(ev.quote, fromMethod.fields.methodName.value, toMethod.fields.methodName.value, type)
            .sufficient,
      );
    }
    if (!primary) primary = located[0] ?? unlocated;

    const draft: Relation = {
      id: `r_${i}_${from}_${to}`,
      fromMethodId: from,
      toMethodId: to,
      type,
      evidenceState,
      evidence: primary,
      evidenceList: located.length ? located : undefined,
      rationale: (r.rationale || '').trim() || undefined,
      aiOriginal: {
        type,
        evidenceState,
        rationale: (r.rationale || '').trim() || undefined,
        evidenceQuote: uniqueQuotes[0],
      },
    };

    const { relation, issues: relIssues } = validateRelation(draft, methods, papers);
    out.push(relation);
    issues.push(...relIssues);
  });

  return { relations: out, issues };
}

/* ============================ 方法决策 ============================ */

export type RawReadingStep = {
  methodId?: string;
  paperId?: string;
  focus?: string;
  reason?: string;
  basis?: string;
  gap?: string;
};

/**
 * 阅读顺序的结构校验（steps / readingOrder 二选一，但必须存在且至少一步）。
 * 「0 步」不是成功结果：过去会显示「完成：阅读顺序 0 步」，等于把空结果当成功。
 */
export function requireReadingSteps(obj: Record<string, unknown>): RawReadingStep[] {
  const value = optionalArrayField(obj, 'readingOrder', '阅读路线结果') ?? requireArrayField(obj, 'steps', '阅读路线结果');
  const steps = requireArrayOfObjects(value, '阅读路线结果.steps') as unknown as RawReadingStep[];
  if (!steps.length) {
    throw new ModelError(
      '模型返回的阅读路线里没有任何步骤（steps 为空数组），已按失败处理：不把「0 步」当作成功结果。',
      'format',
    );
  }
  return steps;
}

export async function generateDecision(
  papers: Paper[],
  methods: Method[],
  profile: UserProfile,
  cfg: RunConfig,
  onTrace?: (t: CallTrace) => void,
): Promise<ReadingPlan> {
  // 阅读路线必须以人工修正后的有效值为依据（否则用户改了字段、推荐却按旧值给）
  methods = withEffectiveMethods(methods);
  const paperById = new Map(papers.map((p) => [p.id, p]));
  const materials = methods.map((m) => {
    const p = paperById.get(m.paperId);
    const missingFields = FIELD_KEYS.filter((k) => m.fields[k].status !== 'verified').map((k) => METHOD_FIELD_LABELS[k]);
    const compute = m.conditions?.computeResources;
    return {
      paperId: m.paperId,
      methodId: m.id,
      title: p?.title ?? m.paperId,
      year: p?.year,
      methodName: m.fields.methodName.value,
      coreIdea: m.fields.coreIdea.value?.slice(0, 500),
      limitations: m.fields.limitations.value?.slice(0, 400),
      datasets: m.conditions?.datasets.values.join('、') || m.fields.datasets.value,
      metrics: m.conditions?.metrics.values.join('、') || m.fields.metrics.value,
      experimentalSettings: m.conditions?.experimentalSettings.values.join('、'),
      computeResources: compute?.values.join('、'),
      computeStatus: compute?.status ?? 'not_extracted',
      computeStage: compute?.stage,
      computeScope: compute?.scopeDetail,
      missingFields,
    };
  });

  const { text } = await chat(
    {
      signal: cfg.signal,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages: [
        { role: 'system', content: decisionSystemPrompt() },
        { role: 'user', content: decisionUserPrompt(profile, materials) },
      ],
      temperature: 0.2,
      maxTokens: 6000,
      json: true,
      timeoutMs: cfg.timeoutMs ?? 120_000,
      maxAttempts: cfg.maxAttempts ?? 3,
      label: 'decision',
    },
    onTrace,
  );

  type RawCandidate = {
    methodId?: string;
    fit?: string;
    targetStage?: string;
    reasons?: { text?: string; basis?: string; evidenceRef?: { kind?: string; key?: string } }[];
    applicability?: string;
    missing?: string[];
    computeReported?: boolean;
  };
  type RawStep = RawReadingStep;

  const parsedObj = parseJsonObject(text, '阅读路线结果');
  /** candidates 是这次结果的核心：缺失或不是数组 = 明确失败，不能显示「完成，候选 0 个」 */
  const rawCandidates = requireArrayOfObjects(
    requireArrayField(parsedObj, 'candidates', '阅读路线结果'),
    '阅读路线结果.candidates',
  ) as unknown as RawCandidate[];
  /** 阅读顺序：接受 readingOrder 或 steps，但必须存在、是数组且至少一步 */
  const rawOrder = requireReadingSteps(parsedObj);
  const parsed = {
    candidates: rawCandidates,
    readingOrder: rawOrder,
    steps: rawOrder,
    conditionSensitivity: typeof parsedObj.conditionSensitivity === 'string' ? parsedObj.conditionSensitivity : undefined,
    notes: typeof parsedObj.notes === 'string' ? parsedObj.notes : undefined,
  };

  const methodById = new Map(methods.map((m) => [m.id, m]));
  const methodByPaper = new Map(methods.map((m) => [m.paperId, m]));

  const candidates: CandidateMethod[] = (parsed.candidates || [])
    .map((c) => {
      const method = c.methodId ? methodById.get(c.methodId) : undefined;
      if (!method) return null;
      const compute = method.conditions?.computeResources;
      const candidatePaper = papers.find((p) => p.id === method.paperId);
      // 用户目标对应的阶段（模型声明；未声明时按 unknown 处理，绝不默认成「预训练」）
      const stageRaw = (c.targetStage || '').toLowerCase();
      const targetStage: TrainingStage = (
        ['pretrain', 'finetune', 'inference', 'from_scratch', 'distill'] as const
      ).includes(stageRaw as never)
        ? (stageRaw as TrainingStage)
        : 'unknown';
      const modelFit = c.fit === 'suitable' ? 'suitable' : c.fit === 'conditional' ? 'conditional' : 'unknown';
      return {
        methodId: method.id,
        paperId: method.paperId,
        fit: modelFit,
        targetStage,
        reasons: (c.reasons || [])
          .filter((r) => r.text)
          .map((r) => {
            const basis = r.basis === 'profile' ? 'profile' : r.basis === 'gap' ? 'gap' : 'paper';
            const text = r.text as string;
            const declaredKey = typeof r.evidenceRef?.key === 'string' ? r.evidenceRef.key.trim() : undefined;
            const declaredKind =
              r.evidenceRef?.kind === 'condition' || r.evidenceRef?.kind === 'field' ? r.evidenceRef.kind : undefined;
            const ref = declaredKey ? { kind: declaredKind ?? 'field', key: declaredKey } : undefined;

            let evidence: Evidence | undefined;
            let stage: CandidateMethod['computeStage'];
            let bindingIssue: string | undefined;
            let resolvedKey: string | undefined;
            let resolvedKind: 'field' | 'condition' | undefined;

            // 常见中文标注 → 标准键名（模型偶尔会写中文，属于 kind/键名标注不精确）
            const keyAliases: Record<string, string> = {
              计算资源: 'computeResources',
              数据集: 'datasets',
              数据划分: 'dataSplits',
              评价指标: 'metrics',
              预训练语料: 'pretrainingCorpus',
              下游额外训练数据: 'downstreamExtraData',
              数据增强: 'dataAugmentation',
              预训练模型: 'pretrainedModel',
              实验设置: 'experimentalSettings',
            };

            if (basis === 'paper') {
              if (!declaredKey) {
                bindingIssue = '模型没有声明依据来源，拒绝自动绑定';
              } else {
                const normalizedKey = keyAliases[declaredKey] ?? declaredKey;
                if (normalizedKey !== declaredKey) bindingIssue = `引用标识「${declaredKey}」已规范化为「${normalizedKey}」`;

                const inFields = !!(method.fields as Record<string, unknown>)[normalizedKey];
                const inConditions = !!(method.conditions as Record<string, unknown>)[normalizedKey];

                // 第一步：确定唯一定位目标（两处都有时按模型声明消歧；完全无法判断才拒绝）
                let target: 'field' | 'condition' | undefined;
                if (inFields && inConditions) {
                  if (declaredKind === 'condition' || declaredKind === 'field') {
                    target = declaredKind;
                    bindingIssue = `「${normalizedKey}」在字段与条件中同时存在，已按模型声明的类型绑定到${target === 'condition' ? '条件条目' : '字段条目'}`;
                  } else {
                    bindingIssue = `「${normalizedKey}」同时存在于字段与条件中，且模型未声明类型，无法唯一定位，已拒绝自动绑定`;
                  }
                } else if (inFields || inConditions) {
                  target = inFields ? 'field' : 'condition';
                  if (declaredKind && declaredKind !== target) {
                    bindingIssue = `模型标注的类型（${declaredKind}）与实际位置（${target}）不一致，已按实际位置规范化`;
                  }
                } else {
                  bindingIssue = `引用标识「${normalizedKey}」在当前分析结果中不存在，已拒绝自动绑定`;
                }

                // 第二步：按定位目标取证据（必须通过校验，且必须属于本论文）
                if (target) {
                  const holder =
                    target === 'condition'
                      ? (method.conditions as Record<string, { evidence?: Evidence; stage?: CandidateMethod['computeStage'] }>)[normalizedKey]
                      : (method.fields as Record<string, { evidence?: Evidence }>)[normalizedKey];
                  if (holder?.evidence?.verified) {
                    if (holder.evidence.paperId && holder.evidence.paperId !== method.paperId) {
                      bindingIssue = '证据来自其它论文，已拒绝自动绑定';
                    } else {
                      resolvedKey = normalizedKey;
                      resolvedKind = target;
                      evidence = holder.evidence;
                      stage = (holder as { stage?: CandidateMethod['computeStage'] }).stage;
                    }
                  } else {
                    resolvedKey = normalizedKey;
                    resolvedKind = target;
                    bindingIssue = [bindingIssue, '该条目没有通过校验的引文，不挂载证据'].filter(Boolean).join('；');
                  }
                }
              }
            }

            const mentionsResource = /\b(GPU|TPU|V100|P100|A100|PF-days|hours?|days?)\b|算力|显卡|训练时长/i.test(text);

            // 「定位成功」与「支持该理由」分开判断
            const evidenceLocated = !!evidence;
            let evidenceSupportsReason: boolean | undefined;
            if (basis === 'paper') {
              if (!evidenceLocated) {
                evidenceSupportsReason = false;
              } else if (mentionsResource) {
                // 资源类理由：必须指向算力条件，且阶段要与用户目标一致
                evidenceSupportsReason = resolvedKey === 'computeResources' && stage === targetStage;
                if (!evidenceSupportsReason) {
                  bindingIssue = [
                    bindingIssue,
                    resolvedKey !== 'computeResources'
                      ? '该理由在讨论资源，但引用的是「' + resolvedKey + '」而不是算力条件，因此不作为支持证据'
                      : '引用的算力证据阶段与用户目标阶段不一致',
                  ]
                    .filter(Boolean)
                    .join('；');
                }
              } else {
                evidenceSupportsReason = resolvedKey !== 'computeResources';
              }
            }

            return {
              text,
              basis: basis as 'profile' | 'paper' | 'gap',
              evidenceRef: resolvedKey ? { kind: resolvedKind as 'field' | 'condition', key: resolvedKey, paperId: method.paperId, methodId: method.id } : ref,
              // 关键：只有「确实支持这条理由」的证据才会挂载。资源类理由引用非算力条件或阶段不一致时，
              // 即使该条目有引文也不作为支持证据（定位结果仍记录在 evidenceLocated 与 bindingIssue 中）。
              evidence: evidenceSupportsReason === false ? undefined : evidence,
              evidenceLocated,
              evidenceSupportsReason,
              evidenceMissing: basis === 'paper' ? !evidenceLocated || evidenceSupportsReason === false : undefined,
              bindingIssue,
              stage,
            };
          }),
        applicability: c.applicability || undefined,
        missing: (c.missing || []).filter(Boolean),
        computeReported: compute ? compute.status === 'verified' : !!c.computeReported,
        computeStage: compute?.stage ?? (compute?.status === 'verified' ? 'unknown' : undefined),
        computeScope: compute?.scopeDetail ?? undefined,
      } as CandidateMethod;
    })
    .filter(Boolean) as CandidateMethod[];

  // ---- 资源可行性：由程序判定，模型不能自行认证「资源已满足」----
  const userGpu = parseGpuCount(profile.compute);
  for (const cand of candidates) {
    const compute = methodById.get(cand.methodId)?.conditions?.computeResources;
    const paperGpu = parseGpuCount(compute?.values.join('；'));
    const sameStage = !!compute?.stage && compute.stage === cand.targetStage;

    let feasibility: ResourceFeasibility;
    if (!compute || compute.status !== 'verified') {
      feasibility = 'no_matching_stage_evidence';
    } else if (!sameStage) {
      feasibility = 'no_matching_stage_evidence';
    } else if (userGpu === null) {
      feasibility = 'user_scale_unknown';
    } else if (paperGpu === null) {
      feasibility = 'paper_count_unknown';
    } else if (userGpu >= paperGpu) {
      feasibility = 'stage_evidence_available';
    } else {
      feasibility = 'below_paper_scale';
    }
    cand.resourceFeasibility = feasibility;
    cand.feasibilityNote = FEASIBILITY_NOTES[feasibility];

    const computeEvidenceText = [compute?.values.join('；'), compute?.scopeDetail, compute?.note].filter(Boolean).join('；');
    const configEvidence = hasConfigEvidence(computeEvidenceText);

    // ---- 目标匹配：不受硬件门槛影响（阅读推荐不因预训练成本被阻断）----
    const relatedReasons = cand.reasons
      .filter((r) => r.basis !== 'gap' && r.text)
      .map((r) => r.text)
      .slice(0, 3);
    cand.goalMatch = {
      level: modelFitOf(cand) === 'unknown' ? 'worth_investigating' : 'recommended',
      reasons: relatedReasons.length
        ? relatedReasons
        : ['模型未给出与该论文目标匹配的具体理由，需要人工判断是否值得阅读。'],
    };

    // ---- 执行可行性：按「阅读 / 推理 / 微调 / 从头预训练」分别判断 ----
    const assessment: ExecutionAssessment[] = [];
    const computeStage = compute?.stage;
    const computePage = compute?.evidence?.page;
    const computeVerified = compute?.status === 'verified';
    const computeText = (compute?.values ?? []).join('、') || '未报告';

    // 阅读：只取决于论文文本是否可用，与硬件无关
    assessment.push({
      stage: 'reading',
      status: cand.reasons.some((r) => r.basis === 'paper') ? 'evidence_supported' : 'unverified',
      note: '阅读与理解方法只依赖论文文本，不受算力条件限制；本页字段与引文都可回溯到原文。',
    });

    // 推理：先看「权重/代码能不能拿到」，再看有没有推理阶段的算力
    // 注意：可获取 ≠ 能在用户设备上跑通，两者在文案里分开写
    const availability = findWeightsAvailability(papers.find((p) => p.id === cand.paperId) ?? papers[0]);
    if (computeVerified && computeStage === 'inference') {
      assessment.push({
        stage: 'inference',
        status: feasibility === 'stage_evidence_available' || feasibility === 'paper_count_unknown' ? 'evidence_supported' : 'known_gap',
        note:
          '论文报告了推理阶段算力（' +
          computeText +
          '）；这属于论文证据判断，仍需要你在本机确认环境与显存。',
        page: computePage,
      });
    } else if (availability.found) {
      assessment.push({
        stage: 'inference',
        status: 'insufficient_evidence',
        note:
          '论文原文声明权重/代码可获取（见下方引文，p.' +
          (availability.evidence?.page ?? '?') +
          '），因此拿到现有权重这条路径**有原文依据**；' +
          '但论文没有报告推理阶段的算力与资源需求，**能不能在你的设备上跑通仍未验证**（可获取 ≠ 可运行）。',
        page: availability.evidence?.page,
        evidence: availability.evidence,
      });
    } else {
      assessment.push({
        stage: 'inference',
        status: 'unverified',
        note: '全文未检索到「权重/检查点已发布」的表述，也没有报告推理阶段算力，因此该阶段无法判断。',
      });
    }

    // 微调：只看微调阶段的算力证据，绝不用预训练成本代替
    if (computeVerified && computeStage === 'finetune') {
      assessment.push({
        stage: 'finetune',
        status:
          feasibility === 'stage_evidence_available' || feasibility === 'paper_count_unknown'
            ? 'evidence_supported'
            : 'known_gap',
        note:
          feasibility === 'stage_evidence_available'
            ? '论文报告了微调阶段算力（' + computeText + '），与用户条件规模可比；仍需自行核对显存与并行配置。'
            : feasibility === 'paper_count_unknown'
              ? '论文报告了微调阶段算力（' + computeText + '），但没有给出可比的规模数字，请按自身环境评估。'
              : '论文报告的微调阶段算力高于用户可及资源（' + computeText + '）。',
        page: computePage,
      });
    } else {
      assessment.push({
        stage: 'finetune',
        status: 'insufficient_evidence',
        note: '论文没有报告微调阶段的算力；不能用预训练成本代替微调成本来判断。',
      });
    }

    // 从头预训练：只看预训练阶段的算力证据
    if (computeVerified && computeStage === 'pretrain') {
      assessment.push({
        stage: 'pretrain',
        status:
          feasibility === 'stage_evidence_available' && configEvidence
            ? 'evidence_supported'
            : feasibility === 'below_paper_scale'
              ? 'known_gap'
              : 'insufficient_evidence',
        note:
          feasibility === 'below_paper_scale'
            ? '论文报告的预训练规模为 ' + computeText + '，高于用户可及资源；缺少可缩放实现证据，不能用更长的可用时间反推可以复现。'
            : feasibility === 'stage_evidence_available'
              ? configEvidence
                ? '论文报告了预训练阶段算力与部分配置信息（' + computeText + '），规模与用户条件相近；这仍属于论文证据判断，未实际验证运行。'
                : '论文报告了预训练阶段算力（' + computeText + '），但缺少显存、并行策略或训练配置证据，无法判断能否复现。'
              : '论文报告了预训练阶段算力，但缺少可用于对照的规模信息（' + computeText + '）。',
        page: computePage,
      });
    } else if (computeVerified && computeStage === 'from_scratch') {
      assessment.push({
        stage: 'pretrain',
        status: 'insufficient_evidence',
        note: '论文报告的是「从头训练」阶段算力（' + computeText + '），未报告语言模型预训练阶段的算力。',
        page: computePage,
      });
    } else {
      assessment.push({
        stage: 'pretrain',
        status: 'insufficient_evidence',
        note: '论文没有报告预训练阶段的算力与训练时长，无法判断该阶段是否可执行。',
      });
    }

    cand.execution = assessment;

    // 认证「资源已满足、能够完成复现」需要三个条件同时成立：
    //   1) 论文报告的是与用户目标一致的阶段；2) 规模不低于论文；3) 论文给出了显存/并行/具体配置证据。
    // 任一不满足，即使模型给了 suitable，也降级为 conditional 并写明原因。

    if (modelFitOf(cand) === 'suitable' && (feasibility !== 'stage_evidence_available' || !configEvidence)) {
      const reason =
        feasibility === 'below_paper_scale'
          ? '论文报告的该阶段规模高于用户可及资源（不能用更长的可用时间反推可复现）'
          : feasibility === 'stage_evidence_available' && !configEvidence
            ? '论文报告了同阶段且规模可比的算力，但没有给出显存、并行策略或具体训练配置，无法据此认证「能够复现」'
            : '论文没有报告与用户目标阶段一致的可比算力';
      cand.fit = 'conditional';
      cand.fitAdjusted = '模型判定为条件匹配，程序按资源可行性证据修正为有条件可用：' + reason;
    }
    if (configEvidence) cand.computeScope = compute?.scopeDetail ?? cand.computeScope;
  }

  const orderRaw: { paperId?: string; methodId?: string; focus?: string; reason?: string; basis?: string; gap?: string }[] =
    parsed.readingOrder ?? parsed.steps ?? [];
  const steps: PlanStep[] = orderRaw
    .map((s) => {
      const paperId =
        s.paperId ?? (s.methodId ? methodById.get(s.methodId)?.paperId : undefined) ?? '';
      if (!paperId || !methodByPaper.has(paperId)) return null;
      return {
        paperId,
        order: 0,
        focus: s.focus || '未提供',
        reason: s.reason || '未提供',
        basis: (s.basis === 'profile' ? 'profile' : s.basis === 'gap' ? 'gap' : 'paper') as PlanStep['basis'],
        gap: s.gap || undefined,
      } as PlanStep;
    })
    .filter(Boolean) as PlanStep[];
  steps.forEach((s, i) => (s.order = i + 1));

  const questions: ResearchQuestion[] = [];

  return {
    profile,
    candidates,
    steps,
    questions,
    conditionSensitivity: parsed.conditionSensitivity || undefined,
    model: cfg.model,
    cached: false,
    generatedAt: Date.now(),
  };
}

/* ============================ 跨论文分歧 ============================ */

export async function findDivergences(
  papers: Paper[],
  methods: Method[],
  cfg: RunConfig,
  onTrace?: (t: CallTrace) => void,
): Promise<DivergenceReport> {
  // 分歧分析同样以人工修正后的有效值为依据
  methods = withEffectiveMethods(methods);
  const paperById = new Map(papers.map((p) => [p.id, p]));
  const report = compareConditions(papers, methods);

  const materials = methods.map((m) => {
    const p = paperById.get(m.paperId);
    return {
      paperId: m.paperId,
      title: p?.title ?? m.paperId,
      year: p?.year,
      methodName: m.fields.methodName.value,
      coreIdea: m.fields.coreIdea.value?.slice(0, 600),
      limitations: m.fields.limitations.value?.slice(0, 500),
      limitationQuote: m.fields.limitations.evidence?.verified
        ? m.fields.limitations.evidence.quote.slice(0, 400)
        : m.fields.limitations.value?.slice(0, 300),
      datasets: m.conditions?.datasets.values.join('、') || m.fields.datasets.value,
      metrics: m.conditions?.metrics.values.join('、') || m.fields.metrics.value,
      experimentalSettings: m.conditions?.experimentalSettings.values.join('、'),
    };
  });

  // 论文对级别的可比性：按论文对重新计算；checkedPairs 与比较页共用同一个 helper
  const titleOf = (id: string) => paperById.get(id)?.title ?? id;
  const checkedPairs = buildCheckedPairs(papers, methods, titleOf);
  const pairInfo: { pair: string; level: string; differences: string; a: string; b: string }[] = [];
  for (let i = 0; i < methods.length; i++) {
    for (let j = i + 1; j < methods.length; j++) {
      const a = methods[i].paperId;
      const b = methods[j].paperId;
      const level = pairLevel(papers, methods, a, b);
      const diffs = differingDimensions(papers, methods, a, b);
      pairInfo.push({
        pair: `${titleOf(a)} ↔ ${titleOf(b)}`,
        level: LEVEL_LABELS[level],
        differences: diffs.map((d) => `${d.label}（${d.detail}）`).join('；'),
        a,
        b,
      });
    }
  }

  const hints: string[] = [];
  let budget = 7000;
  const pushHint = (s: string) => {
    if (budget - s.length < 0) return;
    budget -= s.length;
    hints.push(s);
  };
  for (const m of methods) {
    const p = paperById.get(m.paperId);
    if (!p) continue;
    const lim = m.fields.limitations.evidence?.verified ? m.fields.limitations.evidence.quote : undefined;
    if (lim) {
      pushHint(`[PAPER: "${p.title}" | paperId=${p.id} | p.${m.fields.limitations.evidence!.page ?? '?'}]\n...${lim.slice(0, 500)}...\n`);
    }
  }

  const { text } = await chat(
    {
      signal: cfg.signal,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages: [
        { role: 'system', content: divergenceSystemPrompt() },
        { role: 'user', content: divergenceUserPrompt(materials, pairInfo, hints.join('\n')) },
      ],
      temperature: 0.2,
      maxTokens: 6000,
      json: true,
      timeoutMs: cfg.timeoutMs ?? 120_000,
      maxAttempts: cfg.maxAttempts ?? 3,
      label: 'divergence',
    },
    onTrace,
  );

  type RawFinding = {
    kind?: string;
    topic?: string;
    paperIds?: string[];
    sides?: { paperId?: string; claim?: string; quote?: string; page?: number }[];
    claimType?: string;
    commonScope?: string;
    conditionDifferences?: { dimension?: string; label?: string; detail?: string }[];
    explanation?: string;
    nextAction?: string;
    comparabilityLevel?: string;
  };

  const parsedObj = parseJsonObject(text, '分歧分析结果');
  /** findings 缺失或不是数组 = 明确失败（「没找到 JSON 数组」不等于「没有分歧」） */
  const rawFindings = requireArrayOfObjects(
    requireArrayField(parsedObj, 'findings', '分歧分析结果'),
    '分歧分析结果.findings',
  ) as unknown as RawFinding[];

  const findings: DivergenceFinding[] = [];

  for (const [i, f] of rawFindings.entries()) {
    // 规则复核统一在 divergenceRules.applyDivergenceRules 中实现，
    // 与 scripts/revalidate.mjs 的离线重算共用同一套判定，保证比较页/分歧页/缓存三者一致。
    findings.push(applyDivergenceRules(papers, methods, f, i));
  }

  if (!findings.length) {
    findings.push({
      id: 'dv_none',
      kind: 'none_found',
      topic: '当前材料未发现',
      paperIds: [],
      sides: [],
      explanation: '已按条件逐对检查，但没有找到可判定为结论分歧的内容；也可能是因为部分论文的局限与实验条件信息不足。',
      nextAction: '可导入更多同一问题的论文，或人工核对局限字段后重新分析。',
      comparabilityLevel: 'unknown',
      disclaimer: '未发现分歧不等于不存在分歧，也不代表领域内没有争议。',
    });
  }

  return {
    findings,
    checkedPairs,
    derivedFrom: {
      rulesVersion: RULES_VERSION,
      paperSignature: papers.map((p) => p.id).sort().join(','),
    },
    model: cfg.model,
    promptVersion: PROMPT_VERSION,
    cached: false,
    stale: false,
    generatedAt: Date.now(),
  };
}


/* ============================ 实验记录解析 ============================ */

const EXP_TASK_TAGS = ['classification', 'detection', 'segmentation', 'other'] as const;

function toStr(v: unknown, max = 300): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

/**
 * 解析模型给出的实验记录。
 *
 * 核查分两层，且分开记录：
 * 1. 「定位」：引文、表题、行标签是否能在原文中逐字找到；
 * 2. 「行列关系」：只有引文 + 表题 + 行标签都定位到，才认为该数值的行列对应已确认；
 *    否则标记待核查（不补猜），并在比较时按「信息不足」处理。
 */
export function parseExperimentRecords(paper: Paper, parsed: Record<string, unknown>): ExperimentRecord[] {
  // experiments 出现时必须是数组（写成字符串/对象说明模型没按结构返回 → 按失败处理）；
  // 整个键缺失时才允许 0 条，并在下方如实反映。
  const rawList = (optionalArrayField(parsed, 'experiments', '实验记录') ?? []) as Record<string, unknown>[];
  const out: ExperimentRecord[] = [];

  for (const [idx, item] of rawList.slice(0, 8).entries()) {
    if (!item || typeof item !== 'object') continue;
    const taskRaw = (toStr(item.taskTag, 20) ?? '').toLowerCase();
    const taskTag: TaskTag = (EXP_TASK_TAGS as readonly string[]).includes(taskRaw) ? (taskRaw as TaskTag) : 'other';

    const quote = toStr(item.quote, 1200);
    const evidence = quote ? buildEvidence(paper, { quote }) : undefined;

    const tableRaw = (item.table ?? {}) as Record<string, unknown>;
    const caption = toStr(tableRaw.caption, 300);
    const rowLabel = toStr(tableRaw.rowLabel, 200);
    const colLabel = toStr(tableRaw.colLabel, 200);
    const locator = toStr(tableRaw.locator, 120);

    // 表格语境核查：行标签/表题必须出现在引文附近（±1500 字符）才算成立。
    // 这样做有两个好处：允许 "Swin-T" 这类短标签；同时避免「整篇论文里出现过」被当成表格语境。
    const around = evidence?.start ?? 0;
    const locate = (x?: string): 'strict' | 'loose' | 'none' => {
      if (!x || x.length < 2) return 'none';
      const r = locateNear(paper.rawText, x, around, 1500);
      return r.found && r.near ? r.matchType : 'none';
    };
    const capMatch = locate(caption);
    const rowMatch = locate(rowLabel);
    const colMatch = locate(colLabel);
    const capLoc = capMatch !== 'none';
    const rowLoc = rowMatch !== 'none';
    const colLoc = colMatch !== 'none';

    const issues: string[] = [];
    if (!quote) issues.push('未提供引文');
    else if (!evidence?.verified) issues.push('引文未能在原文中定位（可能与表格错位或为改写）');
    if (!caption) issues.push('未给出表题，无法核查表格语境');
    else if (!capLoc) issues.push('表题未在引文附近定位到');
    if (!rowLabel) issues.push('未给出行标签，无法核查该行对应哪一列');
    else if (!rowLoc) issues.push('行标签未在引文附近定位到');
    if (colLabel && !colLoc) issues.push('列标签未在引文附近定位到');
    if (caption && capLoc) issues.push(`表题已在引文附近定位（${capMatch === 'strict' ? '逐字一致' : '归一化后一致'}）`);
    if (rowLabel && rowLoc) issues.push(`行标签已在引文附近定位（${rowMatch === 'strict' ? '逐字一致' : '归一化后一致'}）`);

    const rowColConfirmed = !!(evidence?.verified && capLoc && rowLoc);

    const pretrain = canonicalDatasetName(toStr(item.pretrainData, 120));
    const train = canonicalDatasetName(toStr(item.trainData, 120));
    const evalD = canonicalDatasetName(toStr(item.evalDataset, 120));
    const aliasNotes = [...new Set([...pretrain.notes, ...train.notes, ...evalD.notes])];

    const tpRaw = (item.throughput ?? {}) as Record<string, unknown>;
    const throughput =
      toStr(tpRaw.value) || toStr(tpRaw.hardware)
        ? {
            value: toStr(tpRaw.value, 60),
            unit: toStr(tpRaw.unit, 40),
            hardware: toStr(tpRaw.hardware, 120),
            batchSize: toStr(tpRaw.batchSize, 60),
            note: toStr(tpRaw.note, 200),
          }
        : undefined;

    out.push({
      id: `x_${paper.id}_${idx + 1}`,
      paperId: paper.id,
      taskTag,
      modelVariant: toStr(item.modelVariant, 120) ?? '（未报告模型名）',
      params: toStr(item.params, 60),
      flops: toStr(item.flops, 60),
      throughput,
      pretrainData: toStr(item.pretrainData, 120),
      trainData: toStr(item.trainData, 120),
      evalDataset: toStr(item.evalDataset, 120) ?? '未知',
      evalSplit: toStr(item.evalSplit, 80),
      inputResolution: toStr(item.inputResolution, 60),
      metricName: toStr(item.metricName, 80) ?? '未知指标',
      metricValue: toStr(item.metricValue, 40) ?? '',
      metricUnit: toStr(item.metricUnit, 20),
      extraData: toStr(item.extraData, 160),
      distillation: toStr(item.distillation, 160),
      testTimeAug: toStr(item.testTimeAug, 120),
      inferenceMode: toStr(item.inferenceMode, 80),
      evidence,
      table: { caption, rowLabel, colLabel, locator },
      verification: {
        quoteLocated: !!evidence?.verified,
        tableCaptionLocated: capLoc,
        rowLabelLocated: rowLoc,
        colLabelLocated: colLoc,
        rowColConfirmed,
        issues,
        matchTypes: { caption: capMatch, rowLabel: rowMatch, colLabel: colMatch },
      },
      aliasNotes: aliasNotes.length ? aliasNotes : undefined,
      note: toStr(item.note, 300),
    });
  }

  return out;
}
