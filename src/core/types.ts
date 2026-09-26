/**
 * 核心数据模型
 * 依据《LearnBuddy开发交接.md》§6 最小数据对象定义。
 * 原则：区分「论文作者的陈述 / 系统推断 / 用户修正」；证据缺失即标记缺失。
 */

export type ParseStatus = 'pending' | 'parsing' | 'ok' | 'failed';
export type JobStage = 'parse' | 'extract' | 'verify';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

/** 论文来源信息，用于导出引用 */
export interface PaperSource {
  /** 数据来源类型：上传文件 / arXiv / 手动粘贴 */
  kind: 'upload' | 'arxiv' | 'paste';
  /** 原始链接（如有），例如 https://arxiv.org/abs/1706.03762 */
  url?: string;
  /** 发表场所（如未在正文中明确识别则为 undefined，不猜测） */
  venue?: string;
}

export interface PageText {
  /** 页码，从 1 开始 */
  page: number;
  /** 该页原始文本（保留换行，便于展示上下文） */
  text: string;
  /** 该页首字符在 Paper.rawText 中的起始偏移 */
  offset: number;
}

/** 语料集标识：用于把「正式领域案例」与「旧的开发回归样例」隔离，避免混合生成关系与推荐 */
export type CorpusId = 'vision-classification' | 'nlp-dev' | 'user-import';

export interface Paper {
  /** 该论文属于哪个语料集 */
  corpusId?: CorpusId;
  id: string;
  title: string;
  /** 提取到的作者列表；未提取到则为空数组 */
  authors: string[];
  year?: number;
  source: PaperSource;
  /** 文件内容 SHA-256，用于去重与复用已有分析 */
  contentHash?: string;
  parseStatus: ParseStatus;
  parseError?: string;
  /** 每页文本 */
  pages: PageText[];
  /** 解析得到的页数；未知时为 undefined（界面必须显示「页数未知」，不能显示 0） */
  pageCount?: number;
  /** 拼接后的全文（按页顺序），用于证据定位 */
  rawText: string;
  charCount: number;
  /** 该论文是否来自预置样例（用于界面明确标注） */
  sample?: SampleTag;
  /** 是否为系统预置的缓存分析结果（非实时模型输出） */
  cached?: boolean;
  /** 标题来源：heuristic=从首页启发式识别；model-verified=模型给出且已在原文中验证；user=用户修正 */
  titleFrom?: 'heuristic' | 'model-verified' | 'unverified' | 'user';
  createdAt: number;
}

/** 样例标注：必须让用户能一眼看出哪些是预置样例、用途是什么 */
export interface SampleTag {
  /** 用途说明，例如「开发流程验证样例，非最终参赛领域」 */
  purpose: string;
  /** 数据来源与许可说明 */
  license?: string;
}

/** 证据定位方式：决定界面上能提供多精确的跳转 */
export type EvidenceLocator = 'page+offset' | 'page' | 'none';

export interface Evidence {
  paperId: string;
  /** 证据原文片段（必须能在论文全文中定位到，否则 verified=false） */
  quote: string;
  /** 页码（1 起）；无法确定时为 undefined */
  page?: number;
  /** 在 rawText 中的字符区间 */
  start?: number;
  end?: number;
  /** 章节名（启发式识别，可能为空） */
  section?: string;
  /** 定位精度 */
  locator: EvidenceLocator;
  /** 是否通过全文校验：quote 确实存在于对应论文中 */
  verified: boolean;
  /** 校验失败原因，用于「标记缺失而不是假装有证据」 */
  verifyNote?: string;
  /** 匹配方式：strict=直接匹配；loose=忽略标点/连字符后匹配；partial=只匹配到前段，不可信 */
  matchType?: 'strict' | 'loose' | 'partial';
  /** 实际匹配到的部分占引文的比例（partial 时用于说明尾部疑似被改写） */
  coverage?: number;
}

/** 方法抽取的结构化字段。缺失一律为 missing，不补猜。 */
export interface MethodFields {
  researchTask?: string;
  methodName?: string;
  coreIdea?: string;
  inputsConditions?: string;
  datasets?: string;
  metrics?: string;
  limitations?: string;
}

export const METHOD_FIELD_LABELS: Record<keyof MethodFields, string> = {
  researchTask: '研究任务',
  methodName: '方法名称',
  coreIdea: '核心思路',
  inputsConditions: '输入/训练条件',
  datasets: '数据集',
  metrics: '评价指标',
  limitations: '局限',
};

export type FieldKey = keyof MethodFields;

/**
 * 字段抽取状态（第二阶段口径，界面文案与本状态一一对应）：
 * - verified   : 有值，且引文已在论文全文中定位成功 —— 可核验
 * - unverified : 有值，但引文未通过定位校验 —— 待人工核对
 * - no_evidence: 有值，但模型没有给出任何原文引文 —— 未找到证据
 * - missing    : 论文未报告，或本次提供的片段中未提取到 —— 缺失（不补猜）
 */
export type FieldStatus = 'verified' | 'unverified' | 'no_evidence' | 'missing';

/** 状态到界面文案的唯一映射 */
export const FIELD_STATUS_TEXT: Record<FieldStatus, string> = {
  verified: '可核验',
  unverified: '待人工核对',
  no_evidence: '未找到证据',
  missing: '缺失',
};

export interface MethodFieldResult {
  value?: string;
  status: FieldStatus;
  evidence?: Evidence;
  /** 论文中确实未报告时由模型标注，用于区分「未报告」与「抽取失败」 */
  note?: string;
  /** 模型自称的页码：只作为待校验提示，不直接当作真页码展示 */
  claimedPage?: number;
  /** 该值是人工修正后的有效值（不是原文核验结果；见 core/effective.ts） */
  userCorrected?: boolean;
}

/* ============================ 实验条件（不可比检测的依据） ============================ */

export type ConditionDimension =
  | 'datasets'
  | 'dataSplits'
  | 'metrics'
  /** 预训练语料（论文级） */
  | 'pretrainingCorpus'
  /** 下游任务的额外训练数据（必须说明相对哪个实验/数据集） */
  | 'downstreamExtraData'
  /** 数据增强（必须说明相对哪个实验/数据集） */
  | 'dataAugmentation'
  | 'pretrainedModel'
  | 'experimentalSettings'
  | 'computeResources';

export const CONDITION_LABELS: Record<ConditionDimension, string> = {
  datasets: '数据集',
  dataSplits: '数据划分',
  metrics: '评价指标',
  pretrainingCorpus: '预训练语料',
  downstreamExtraData: '下游额外训练数据',
  dataAugmentation: '数据增强',
  pretrainedModel: '预训练模型',
  experimentalSettings: '实验设置',
  computeResources: '算力/训练时长',
};

export const CONDITION_DIMENSIONS: ConditionDimension[] = [
  'datasets',
  'dataSplits',
  'metrics',
  'pretrainingCorpus',
  'downstreamExtraData',
  'dataAugmentation',
  'pretrainedModel',
  'experimentalSettings',
  'computeResources',
];

/** 训练/运行阶段：用于区分「读论文 / 推理 / 微调 / 从头预训练」的成本 */
export type TrainingStage = 'pretrain' | 'finetune' | 'inference' | 'from_scratch' | 'distill' | 'unknown';

export const TRAINING_STAGE_LABELS: Record<TrainingStage, string> = {
  pretrain: '从头预训练',
  finetune: '微调',
  inference: '使用现有权重推理',
  from_scratch: '从随机初始化训练',
  distill: '蒸馏训练',
  unknown: '阶段未说明',
};

/** 单篇论文在某个条件维度上的情况 */
export interface ConditionValue {
  values: string[];
  /**
   * - verified     : 有引文且定位成功，且引文确实支撑该主张
   * - unverified   : 有内容但引文未通过校验，或引文不支撑该主张（如把局部实验描述当成整篇结论）
   * - not_reported : 论文明确表示不适用 / 没有使用
   * - not_extracted: 本次提供的片段中未提取到（不等于论文没有）
   * - unclear      : 无法确认
   */
  status: 'verified' | 'unverified' | 'not_reported' | 'not_extracted' | 'unclear';
  evidence?: Evidence;
  note?: string;
  claimedPage?: number;
  /** 该条目的适用范围：整篇论文 / 某个具体实验 */
  scope?: 'paper' | 'experiment' | 'unknown';
  /** scope=experiment 时说明是哪个实验（任务 / 数据集 / 表格） */
  scopeDetail?: string;
  /** 算力等条目的训练阶段 */
  stage?: TrainingStage;
  /** true = 由早期字段结构迁移得到，未按新结构重新抽取 */
  structureMigrated?: boolean;
}

export type ExperimentConditions = Record<ConditionDimension, ConditionValue>;

/* ============================ 程序校验问题 ============================ */

export type IssueCode =
  | 'field_missing'
  | 'evidence_missing'
  | 'evidence_not_located'
  | 'quote_too_short'
  | 'page_mismatch'
  | 'page_invalid'
  | 'condition_unconfirmed'
  | 'condition_not_extracted'
  | 'condition_structure_migrated'
  | 'evidence_scope_mismatch'
  | 'relation_downgraded'
  | 'relation_endpoint_unnamed'
  | 'relation_no_basis'
  | 'title_unverified'
  | 'page_count_unknown'
  | 'parse_warning';

export const ISSUE_CODE_TEXT: Record<IssueCode, string> = {
  field_missing: '字段缺失',
  evidence_missing: '未提供引文',
  evidence_not_located: '引文无法定位',
  quote_too_short: '引文过短',
  page_mismatch: '页码与定位结果不一致',
  page_invalid: '页码超出论文页数',
  condition_unconfirmed: '实验条件无法确认',
  condition_not_extracted: '本次片段中未提取到',
  condition_structure_migrated: '条件由早期结构迁移',
  evidence_scope_mismatch: '引文范围不支撑该主张',
  relation_downgraded: '关系可信度被自动降级',
  relation_endpoint_unnamed: '引文未指名关系端点',
  relation_no_basis: '关系缺少依据',
  title_unverified: '标题未确认',
  page_count_unknown: '页数未知',
  parse_warning: '解析告警',
};

export interface ValidationIssue {
  id: string;
  scope: 'paper' | 'method' | 'relation';
  refId: string;
  field?: string;
  code: IssueCode;
  severity: 'info' | 'warn' | 'error';
  message: string;
  /** 已做的自动处理，或需要人工做什么 */
  action: string;
  at: number;
}

export interface UserOverride {
  field: FieldKey;
  previousValue?: string;
  newValue: string;
  reason?: string;
  at: number;
}

export interface Method {
  id: string;
  /** 该分析结果属于哪个语料集 */
  corpusId?: CorpusId;
  paperId: string;
  fields: Record<FieldKey, MethodFieldResult>;
  /** 实验记录（一篇论文可有多条模型/设置组合，分类比较以实验为单位） */
  experiments?: ExperimentRecord[];
  /** 结构化实验条件，用于不可比检测 */
  conditions?: ExperimentConditions;
  /** 程序校验发现的问题（缺失、引文无法定位、页码异常、条件无法确认等） */
  validation?: ValidationIssue[];
  /** 用户对关键字段的修正记录（保留 AI 原值与修正值的区别） */
  overrides: UserOverride[];
  /** 生成该结果的模型与提示词版本，用于复现 */
  model?: string;
  promptVersion?: string;
  extractedAt?: number;
  /** true = 预置缓存结果，不是本次实时分析 */
  cached?: boolean;
  /** 模型给出的标题，且已通过「该标题确实出现在论文原文中」的校验 */
  paperTitleGuess?: string;
}

export type RelationType =
  | 'extends'       // 继承 / 基于
  | 'improves'      // 改进
  | 'combines'      // 组合
  | 'similar'       // 相似
  | 'unclear';      // 关系不明确

export const RELATION_LABELS: Record<RelationType, string> = {
  extends: '继承/基于',
  improves: '改进',
  combines: '组合',
  similar: '相似',
  unclear: '不明确',
};

/**
 * 关系可信度状态（不使用未校准的模型置信度百分比）：
 * - explicit : 论文明确说明（必须有定位成功的原文引文）
 * - inferred : 基于论文内容的系统推断（必须有推断理由）
 * - candidate: 仅供进一步核查的候选关系（依据薄弱或引文无法核实）
 */
export type RelationEvidenceState = 'explicit' | 'inferred' | 'candidate';

export const RELATION_STATE_LABELS: Record<RelationEvidenceState, string> = {
  explicit: '原文明示',
  inferred: '系统推断',
  candidate: '待核查',
};

export const RELATION_STATE_DESC: Record<RelationEvidenceState, string> = {
  explicit:
    '论文原文中有明确陈述该关系的句子，且该句已在原文中定位成功；同时该句必须提到被继承方法的名称（含简称/全称别名），并具备继承/改进措辞或引用标记',
  inferred: '论文没有明说，系统依据原文内容与方法构成推断得出，并附有推断理由',
  candidate: '依据不足或引文无法核实，仅作为候选列出，需要人工回到原文确认；这不代表系统断言该关系不存在',
};

export interface Relation {
  id: string;
  fromMethodId: string;
  toMethodId: string;
  type: RelationType;
  /** 可信度状态（权威字段） */
  evidenceState: RelationEvidenceState;
  /** 支撑当前判定的主证据（原文明示时为使判定成立的那一条） */
  evidence?: Evidence;
  /** 所有已定位到的相关片段（允许多个片段共同供人工判断） */
  evidenceList?: Evidence[];
  /** 推断理由或降级原因（不允许为空） */
  rationale?: string;
  /** 程序对证据是否足以支撑「原文明示」的判定说明（含查到了什么、缺什么） */
  evidenceAssessment?: string;
  /** 程序调整状态的记录（为什么从 X 变成 Y） */
  stateAdjusted?: { from: RelationEvidenceState; to: RelationEvidenceState; reason: string }[];
  /** 用户是否手工修正过 */
  userEdited?: boolean;
  /** AI 原始输出，便于与人工修正对照 */
  aiOriginal?: { type: RelationType; evidenceState: RelationEvidenceState; rationale?: string; evidenceQuote?: string };
  /** 已废弃：仅用于兼容第一阶段缓存数据 */
  assertedBy?: 'explicit' | 'inferred';
}

export interface AnalysisJob {
  id: string;
  paperId: string;
  stage: JobStage;
  status: JobStatus;
  /** 当前重试次数与上限 */
  attempts: number;
  maxAttempts: number;
  error?: string;
  model?: string;
  promptVersion?: string;
  startedAt?: number;
  finishedAt?: number;
}

/** 用户个人条件，用于生成阅读路线 */
export interface UserProfile {
  background: string;
  interest: string;
  /** 可投入时间（如 "2周，每天2小时"） */
  time?: string;
  /** 计算资源描述 */
  compute?: string;
  goal?: string;
}

/**
 * 推荐理由的证据绑定。
 *
 * 绑定由程序按 evidenceRef 完成，并且是**严格**的：
 * - 引用必须能唯一定位到「本文档 / 该分析结果 / 具体字段或条件」；
 * - 同名字段与条件并存、引用无效、指向其它论文时一律拒绝自动绑定并记录原因；
 * - 「定位成功」与「支持该理由」分别记录，不因为字段有值就算通过。
 */
export interface CandidateReason {
  text: string;
  basis: 'profile' | 'paper' | 'gap';
  /** 模型声明的依据指向（kind 仅代表模型标注，程序会做规范化） */
  evidenceRef?: { kind: 'field' | 'condition'; key: string; paperId?: string; methodId?: string };
  /** 程序按 evidenceRef 挂载的证据（仅当定位成功时才挂载） */
  evidence?: Evidence;
  /** 引文是否在原文中定位成功 */
  evidenceLocated?: boolean;
  /** 该证据是否支持这条理由（资源类理由要求阶段一致） */
  evidenceSupportsReason?: boolean;
  /** true = 该理由没有可核验证据，界面必须明确标出而不是展示无关引文 */
  evidenceMissing?: boolean;
  /** 绑定被拒绝或被规范化时的说明 */
  bindingIssue?: string;
  /** 证据对应的训练阶段（资源类理由专用） */
  stage?: TrainingStage;
}

/**
 * 目标匹配（回答「为什么值得研究」）：与用户的研究目标/兴趣是否匹配，**不受硬件门槛影响**。
 * - recommended        ：与用户目标直接相关，适合阅读与方法借鉴
 * - worth_investigating：值得进一步调查，但需要先确认某些前提
 * - background         ：作为背景材料阅读
 * - not_relevant       ：与用户目标关系不大
 */
export type GoalFitLevel = 'recommended' | 'worth_investigating' | 'background' | 'not_relevant';

export const GOAL_FIT_LABELS: Record<GoalFitLevel, string> = {
  recommended: '适合阅读与方法借鉴',
  worth_investigating: '值得进一步调查',
  background: '作为背景材料',
  not_relevant: '与目标关系不大',
};

/**
 * 执行可行性（回答「在我的条件下能做哪一步」）：**按用户操作分别判断**。
 *
 * 注意：这里全部是「基于论文证据的判断」。系统不会实际运行任何训练或推理，
 * 因此 evidence_supported 表示「论文给出了与该操作阶段相符、规模可比的算力证据」，
 * **不等于「已经验证能跑通」**；实际执行验证属于另一件事，界面上必须分开表达。
 */
export type ExecutionStage = 'reading' | 'inference' | 'finetune' | 'pretrain';

export const EXECUTION_STAGE_LABELS: Record<ExecutionStage, string> = {
  reading: '阅读与理解方法',
  inference: '使用现有权重推理',
  finetune: '在自有数据上微调',
  pretrain: '从头预训练',
};

export type ExecutionStatus =
  /** 论文给出了该阶段、规模可比的算力证据（仍需自行核对显存/并行/配置） */
  | 'evidence_supported'
  /** 论文没有报告该阶段的算力，无法判断 */
  | 'insufficient_evidence'
  /** 已知用户资源低于论文报告值 */
  | 'known_gap'
  /** 缺少必要条件，尚未验证 */
  | 'unverified';

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  evidence_supported: '论文证据支持该阶段',
  insufficient_evidence: '论文未报告该阶段算力',
  known_gap: '已知存在资源差距',
  unverified: '尚未验证',
};

export interface ExecutionAssessment {
  stage: ExecutionStage;
  status: ExecutionStatus;
  /** 判断说明：缺什么、依据是哪条算力条目 */
  note: string;
  /** 支撑该判断的证据所在页（若有） */
  page?: number;
  /** 支撑该判断的原文证据（例如「权重已发布」的原句） */
  evidence?: Evidence;
}

export interface GoalMatch {
  level: GoalFitLevel;
  /** 为什么值得研究（目标匹配理由） */
  reasons: string[];
}

/**
 * 资源可行性（**程序判定**，模型不能自行认证）：
 * - stage_evidence_available：论文报告了与用户目标阶段一致的算力，且用户算力规模不低于论文
 * - below_paper_scale：论文报告了同阶段算力，但用户规模更低（不能用更长时间反推可复现）
 * - user_scale_unknown：用户算力描述无法解析出规模
 * - paper_count_unknown：论文只给了时长/硬件类型，没有可比的规模
 * - no_matching_stage_evidence：论文没有报告用户目标阶段的算力
 * 注意：即使 stage_evidence_available，仍缺少显存/并行/训练配置/可缩放实现证据，可行性依然标为「未验证」。
 */
export type ResourceFeasibility =
  | 'stage_evidence_available'
  | 'below_paper_scale'
  | 'user_scale_unknown'
  | 'paper_count_unknown'
  | 'no_matching_stage_evidence';

export const FEASIBILITY_LABELS: Record<ResourceFeasibility, string> = {
  stage_evidence_available: '规模可比（可行性仍未验证）',
  below_paper_scale: '低于论文规模（可行性未验证）',
  user_scale_unknown: '用户资源规模无法解析',
  paper_count_unknown: '论文未给出可比的规模',
  no_matching_stage_evidence: '论文未报告该阶段的算力',
};

/** 单个候选方法的适用性判断 */
export interface CandidateMethod {
  methodId: string;
  paperId: string;
  /** 与用户条件的匹配程度 */
  fit: 'suitable' | 'conditional' | 'unknown';
  /** 推荐理由（必须指明依据来源；依据论文时必须带 evidenceRef） */
  reasons: CandidateReason[];
  /** 适用条件（论文中写明的适用范围） */
  applicability?: string;
  /** 需要用户注意的缺失信息 */
  missing: string[];
  /** 论文是否报告了算力/训练时长；false 表示无法确认可运行性 */
  computeReported: boolean;
  /** 该方法的算力信息所对应的阶段（预训练 / 微调 / 推理），未说明时为 unknown */
  computeStage?: TrainingStage;
  /** 算力证据的适用范围说明（模型配置与任务） */
  computeScope?: string;
  /** 用户目标对应的阶段（由模型声明，用于判断推荐是否落在同一阶段） */
  targetStage?: TrainingStage;
  /** 目标匹配（不受硬件门槛影响，回答「为什么值得研究」） */
  goalMatch?: GoalMatch;
  /** 按用户操作分别给出的执行可行性（回答「在我的条件下能做哪一步」） */
  execution?: ExecutionAssessment[];
  /** 资源可行性（程序判定；保留用于兼容与汇总） */
  resourceFeasibility?: ResourceFeasibility;
  /** 可行性说明：为什么未验证、还缺什么证据 */
  feasibilityNote?: string;
  /** 程序对 fit 的修正（模型判定 → 修正后）与原因；为空表示未修正 */
  fitAdjusted?: string;
}

export interface PlanStep {
  paperId: string;
  order: number;
  /** 阅读重点 */
  focus: string;
  /** 推荐理由 */
  reason: string;
  /** 支撑该推荐的理由类型：基于论文信息 / 基于用户条件 / 信息缺口 */
  basis: 'paper' | 'profile' | 'gap';
  /** 信息缺口说明（如论文未报告所需资源） */
  gap?: string;
}

export interface ResearchQuestion {
  id: string;
  question: string;
  /** 依据：引用哪篇论文的局限/分歧 */
  evidenceRefs: { paperId: string; quote?: string; page?: number }[];
  /** 待查方向 */
  nextSteps: string;
  /** 必须声明：这不是对研究空白或创新性的确认 */
  disclaimer: string;
}

export interface ReadingPlan {
  profile: UserProfile;
  /** 候选方法（第二阶段新增：先给候选与适用性，再给阅读顺序） */
  candidates?: CandidateMethod[];
  steps: PlanStep[];
  questions: ResearchQuestion[];
  /** 用户条件变化会如何改变推荐（用于自查「推荐是否随条件变化」） */
  conditionSensitivity?: string;
  model?: string;
  cached?: boolean;
  generatedAt: number;
}

/* ============================ 跨论文分歧与待调查问题 ============================ */

/**
 * 发现类型：
 * - conclusion_divergence : 条件一致时，不同论文的结论确实不同 —— 只有这种才可称为分歧
 * - condition_explained   : 表面冲突可由实验条件差异解释 —— 不是矛盾
 * - shared_limitation     : 多篇论文都提到同类局限 —— 只说明当前材料中存在待调查问题
 * - none_found            : 当前材料未发现
 */
export type DivergenceKind =
  | 'conclusion_divergence'
  | 'condition_confounded'
  | 'shared_limitation'
  | 'individual_limitations'
  | 'none_found';

export const DIVERGENCE_LABELS: Record<DivergenceKind, string> = {
  conclusion_divergence: '结论分歧（同一范围内）',
  condition_confounded: '条件不一致，无法归因于方法',
  shared_limitation: '共同提到的局限（同一对象）',
  individual_limitations: '各自局限（无共同对象，分别展示）',
  none_found: '当前材料未发现',
};

export interface DivergenceFinding {
  id: string;
  kind: DivergenceKind;
  /** 涉及的问题/主题 */
  topic: string;
  /** 涉及论文 */
  paperIds: string[];
  /**
   * 双方证据。
   * quote 必须经过 buildEvidence()/locateQuote() 定位校验：
   * - 定位成功：quoteEvidence.verified = true，page 来自真实定位结果；
   * - 定位失败（含「尚未取回全文」）：verified = false，**不填页码**，界面按「待核查」展示。
   */
  sides: {
    paperId: string;
    claim: string;
    quote?: string;
    page?: number;
    /** 定位校验结果（唯一来源，界面不得自行包装成 verified） */
    quoteEvidence?: Evidence;
    /** 未通过定位时的说明（模型改写 / 尚未取回全文等） */
    quoteNote?: string;
  }[];
  /** 主张类型：数值结果 / 定性主张 */
  claimType?: 'numeric' | 'qualitative';
  /** 双方主张的共同对象/范围（同一任务、同一数据集版本与划分、同一方法属性等） */
  commonScope?: string;
  /** 条件差异（kind=condition_confounded 时必填） */
  conditionDifferences?: { dimension: ConditionDimension; label: string; detail: string }[];
  /** 可能解释 */
  explanation: string;
  /** 下一步核查动作 */
  nextAction: string;
  /** 判断所依据的比较结论（由程序按论文对实时计算，与比较页同源） */
  comparabilityLevel: 'comparable' | 'limited' | 'not_comparable' | 'unknown';
  /** 程序复核记录（例如把「结论分歧」降级为「无法归因」的原因） */
  ruleNotes?: string[];
  /** 固定声明 */
  disclaimer: string;
}

export interface DivergenceReport {
  findings: DivergenceFinding[];
  /** 已检查但未发现分歧的论文对，用于说明「没有为了展示而造冲突」 */
  checkedPairs: { pair: string; result: string }[];
  /** 由程序按当前论文对实时重算的可比性（与比较页同源） */
  derivedFrom?: { rulesVersion: string; paperSignature: string };
  model?: string;
  promptVersion?: string;
  cached?: boolean;
  stale?: boolean;
  staleReasons?: string[];
  generatedAt: number;
}

/** 模型连接配置（仅存于本地，不写入仓库与导出文件） */
export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}



/** 论文实验的任务标签：分类实验才进入分类比较，检测/分割等保留自己的标签 */
export type TaskTag = 'classification' | 'detection' | 'segmentation' | 'other';

export const TASK_TAG_LABELS: Record<TaskTag, string> = {
  classification: '图像分类',
  detection: '目标检测',
  segmentation: '语义分割',
  other: '其它任务',
};

/** 吞吐量必须连同测量条件解释，不能跨设置直接排名 */
export interface ThroughputInfo {
  value?: string;
  unit?: string;
  /** 硬件（如 V100 / A100 / TPUv3） */
  hardware?: string;
  batchSize?: string;
  note?: string;
}

/**
 * 一条**实验记录**（不是整篇论文的标签）。
 * 用于回答「这些方法都报告 ImageNet 分类表现，能直接按准确率选最好的吗」。
 */
export interface ExperimentRecord {
  id: string;
  paperId: string;
  methodId?: string;
  taskTag: TaskTag;
  /** 模型变体，如 ResNet-50 / ViT-B/16 / DeiT-B / Swin-B / ConvNeXt-T */
  modelVariant: string;
  params?: string;
  flops?: string;
  throughput?: ThroughputInfo;
  pretrainData?: string;
  trainData?: string;
  evalDataset: string;
  evalSplit?: string;
  inputResolution?: string;
  metricName: string;
  metricValue: string;
  metricUnit?: string;
  extraData?: string;
  distillation?: string;
  testTimeAug?: string;
  inferenceMode?: string;
  /** 原文证据（应含该模型行的名称与数值） */
  evidence?: Evidence;
  /** 表格语境：标题、行标签、列标签，用于核查行列对应 */
  table?: { caption?: string; rowLabel?: string; colLabel?: string; locator?: string };
  /** 程序核查结果（定位与行列关系分开记录） */
  verification?: {
    quoteLocated: boolean;
    tableCaptionLocated?: boolean;
    rowLabelLocated?: boolean;
    colLabelLocated?: boolean;
    /** 只有引文、表题、行标签都在原文中定位到，才算行列关系已确认 */
    rowColConfirmed: boolean;
    issues: string[];
    /** 表题/行标签/列标签的匹配类型：strict（逐字）| loose（归一化后一致）| none（未定位到） */
    matchTypes?: { caption?: 'strict' | 'loose' | 'none'; rowLabel?: 'strict' | 'loose' | 'none'; colLabel?: 'strict' | 'loose' | 'none' };
  };
  /** 数据来源名是否经过规范化（如 ImageNet-22K → ImageNet-21K） */
  aliasNotes?: string[];
  note?: string;
}
