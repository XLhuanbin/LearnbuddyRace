import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DivergenceReport,
  Evidence,
  FieldKey,
  Method,
  ModelConfig,
  Paper,
  ReadingPlan,
  Relation,
  UserProfile,
} from './core/types';
import { DIVERGENCE_LABELS, METHOD_FIELD_LABELS, RELATION_LABELS, RELATION_STATE_LABELS } from './core/types';
import { hashFile, loadMeta, repo, saveMeta, appendUsage, isUsageRecordList, type UsageRecord } from './core/storage';
import { paperFromText, parsePdfFile } from './core/parse/pdfBrowser';
import {
  applyTitleCorrection,
  extractMethodWithProgress,
  findDivergences,
  generateDecision,
  inferRelations,
} from './core/model/analyze';
import { assertNoUrlCredentials, chat, describeModelError, redactUrl, type CallTrace } from './core/model/client';
import {
  assessCorpusStaleness,
  corpusBaseOfPaper,
  loadCorpusIndex,
  loadPaperText,
  hydratePaper,
  migrateMethod,
  migrateRelation,
  normalizeRestoredData,
  revalidateCachedRelations,
  FIELD_KEYS_ORDER,
} from './core/cache';
import { RULES_VERSION, looksLikeTitle } from './core/rules';
import { buildEvidence } from './core/evidence';
import { validateMethod } from './core/validate';
import { effectiveField, overriddenFieldLabels } from './core/effective';
import { PROMPT_VERSION } from './core/model/prompts';
import {
  CORPUS_META,
  asScopedSnapshot,
  collectPaperRemoval,
  collectScopeRemoval,
  danglingRelations,
  legacyCorpusPatches,
  readScopedSnapshot,
  mergeCachedMethods,
  isManualRelation,
  replaceRelationsInScope,
  scopeCorpus,
  scopeRelations,
  scopeKeyOf,
  scopeIdentityKey,
  type CorpusKey,
  type ScopeMode,
} from './core/corpus';
import { LibraryView, type JobState } from './ui/Library';
import { bumpSeq, seqIsCurrent } from './core/taskSeq';
import { CompareView } from './ui/Compare';
import { GraphView } from './ui/Graph';
import { DecisionView, downloadDecision } from './ui/PlanView';
import { DivergenceView } from './ui/Divergence';
import { ExperimentsView } from './ui/ExperimentsView';
import { HomeView } from './ui/HomeView';
import { LandingView } from './ui/LandingView';
import { MapView } from './ui/MapView';
import { AppBrandBar } from './ui/mapChrome';
import { UploadFlowView } from './ui/UploadFlowView';
import type { Queued, UploadPhase } from './ui/UploadFlowView';
import { ResultPageView } from './ui/ResultPageView';
import { MoreView } from './ui/MoreView';
import { SettingsView, StatusView, capabilitiesList, MODEL_ERROR_HINT } from './ui/SettingsView';
import { VersionView } from './ui/VersionView';
import { FutureView } from './ui/FutureView';
import { EvidencePopover, Banner } from './ui/common';
import {
  describeDependents,
  describeJobOutcome,
  describeOverrideDependents,
  mergeReanalysisResult,
} from './core/reanalysis';

type Tab =
  | 'landing'
  | 'map'
  | 'upload'
  | 'more'
  | 'home'
  | 'library'
  | 'result'
  | 'experiments'
  | 'compare'
  | 'graph'
  | 'decision'
  | 'divergence'
  | 'settings'
  | 'status'
  | 'version'
  | 'future';

/**
 * 动线返回链（2026-10-12 用户要求：每个页面都有「返回上一级」，不是所有页都回论文集合）。
 *
 * 层级：方法提取 → 论文集合 → 研究地图 →（跨论文比较 | 阅读路线）→ 待调查问题。
 * 顶栏右上角的返回链接按当前页取这里；没有登记的页面保持「返回论文集合」。
 */
const BACK_OF: Partial<Record<Tab, [string, Tab]>> = {
  upload: ['返回论文集合', 'library'],
  library: ['返回方法提取', 'upload'],
  map: ['返回论文集合', 'library'],
  graph: ['返回研究地图', 'map'],
  compare: ['返回研究地图', 'map'],
  decision: ['返回研究地图', 'map'],
  divergence: ['返回阅读路线', 'decision'],
  result: ['返回论文集合', 'library'],
  experiments: ['返回论文集合', 'library'],
  /**
   * 以下 6 个页面过去**没有登记**，顶栏的返回按钮是空的 ——
   * 用户点「返回」没有任何反应（P2：按钮必须兑现它的文案）。
   */
  home: ['返回首页', 'landing'],
  more: ['返回首页', 'landing'],
  settings: ['返回首页', 'landing'],
  status: ['返回首页', 'landing'],
  version: ['返回更多', 'more'],
  future: ['返回更多', 'more'],
};

/**
 * 逐文件的导入结果（2026-10-10）。
 * 草稿的「待处理队列」是按**文件**展示的（文件卡：图标 + 文件名 + 大小 • PDF + 删除），
 * 所以底层要把「这次提交的每个文件」和「它的真实结果」对上，界面才能按文件如实显示状态。
 */
export interface ImportResult {
  fileName: string;
  /** 真正入库的论文（解析失败时也有，parseStatus='failed'） */
  paper?: Paper;
  /** 没入库的原因（内容重复被去重 / 解析器没返回论文对象） */
  skipped?: string;
  /** skippedPaperId（2026-10-11）：内容重复被跳过时，指向库里已有的那篇论文 —— 上传页靠它把「已跳过」的文件卡对回真实论文，判断是否已完成梳理 */
  skippedPaperId?: string;
  /** 抛异常时的原因 */
  error?: string;
}

/** 三类由模型生成的分析任务（各自有 busy / 取消 / 请求版本保护） */
type TaskKind = 'relations' | 'plan' | 'divergence';

const EMPTY_CONFIG: ModelConfig = { baseUrl: '', apiKey: '', model: '' };

export default function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('rp.tab2') : null;
    const allowed: Tab[] = [
      'landing', 'map', 'upload', 'more',
      'library', 'result', 'experiments', 'compare', 'graph', 'decision', 'divergence', 'settings', 'status', 'version', 'future',
    ];
    return saved && (allowed as string[]).includes(saved) ? (saved as Tab) : 'landing';
  });
  /**
   * 「分析结果页」正在看哪一篇论文（从论文集合点「查看分析结果」进来）。
   *
   * ⚠️ 必须和 `tab` 一起持久化（P2）：旧实现只恢复了 `tab='result'`，没有恢复论文 ID，
   * 于是刷新后停在结果页但**正文空白**，用户以为分析结果丢了。
   */
  const [resultPaperId, setResultPaperId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('rp.resultPaper');
    } catch {
      return null;
    }
  });
  /** 记录来源：从「论文集合」进的还是从「研究地图/待调查」进的，用于返回按钮与恢复提示 */
  React.useEffect(() => {
    try {
      if (resultPaperId) localStorage.setItem('rp.resultPaper', resultPaperId);
      else localStorage.removeItem('rp.resultPaper');
    } catch {
      /* 忽略 */
    }
  }, [resultPaperId]);
  /**
   * 每次从顶栏「目录」点进研究地图就自增一次，用来把研究地图的子视图复位到「方法地图」。
   * 不带 signal 的话，子视图（关系与比较 / 阅读起点）是页面内部状态，再点一次目录也回不去。
   */
  const [mapResetSeq, setMapResetSeq] = useState(0);
  /** 统一入口：去研究地图就带上复位信号，其余页面直接切 */
  const goTab = (t: string) => {
    if (t === 'map') setMapResetSeq((n) => n + 1);
    setTab(t as Tab);
  };
  // 记录当前页面：刷新后回到原处，避免新用户以为数据丢了
  React.useEffect(() => {
    try {
      localStorage.setItem('rp.tab2', tab);
    } catch {
      /* 忽略 */
    }
  }, [tab]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [methods, setMethods] = useState<Method[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [plan, setPlan] = useState<ReadingPlan | undefined>();
  const [divergence, setDivergence] = useState<DivergenceReport | undefined>();
  const [sampleProfile, setSampleProfile] = useState<UserProfile | undefined>();
  const [staleNotes, setStaleNotes] = useState<string[]>([]);
  /** 实验记录条数（导航与首页的状态提示用） */
  /** 实验比较页回报的选择与比较状态（仅用于顶部进度提示，不影响数据） */
  /** 从论文库「查看实验」进入时聚焦的论文（仅影响筛选默认值） */
  const [expFocus, setExpFocus] = useState<string | null>(null);
  /** 语料加载状态：用于按钮禁用与「加载中/完成/失败」反馈 */
  const [corpusLoading, setCorpusLoading] = useState<CorpusKey | null>(null);

  const [loadResult, setLoadResult] = useState<
    { key: CorpusKey; ok: boolean; papers: number; experiments: number; relations: number; message: string; at: number } | undefined
  >();
  /** 当前语料集：正式领域案例（视觉分类）或旧的开发回归样例（NLP）——两者隔离，不混合生成关系与推荐 */
  const [corpus, setCorpus] = useState<'vision' | 'nlp-dev'>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('rp.corpus') : null;
    return saved === 'nlp-dev' ? 'nlp-dev' : 'vision';
  });

  const corpusIdOf = (k: CorpusKey) => CORPUS_META[k].id;
  /**
   * 当前集合模式：'case' 只看当前案例的预置数据，'own' 只看我自己上传的论文。
   * 它是**当前分析范围的一部分**——关系、比较、阅读路线、分歧、统计、导出全都跟着它走。
   */
  const [mapMode, setMapMode] = useState<ScopeMode>('case');
  const scope = useMemo(() => scopeCorpus(papers, methods, corpus, mapMode), [papers, methods, corpus, mapMode]);

  /**
   * 「最新状态」引用（异步任务提交前必须读这里，不能读渲染闭包）。
   *
   * 背景（P1）：抽取/导入/加载这类异步任务在 `await` 之后拿到的闭包变量是**发起那一刻**的快照。
   * 于是出现了两类真实错误：
   * ① 抽取返回时论文已被删除或重新解析，旧结果仍然写回，复活出「孤儿方法」；
   * ② 用发起前缓存的 `prev` 合并，把等待期间用户新增的人工修正（overrides / userSupplemented）覆盖掉。
   * 所有跨 await 的提交校验一律读这些 ref。
   */
  const papersRef = useRef<Paper[]>(papers);
  papersRef.current = papers;
  const methodsRef = useRef<Method[]>(methods);
  methodsRef.current = methods;
  const relationsRef = useRef<Relation[]>(relations);
  relationsRef.current = relations;
  const corpusRef = useRef<CorpusKey>(corpus);
  corpusRef.current = corpus;
  const mapModeRef = useRef<ScopeMode>(mapMode);
  mapModeRef.current = mapMode;
  /**
   * 本次会话里「用户选过的 PDF」：内容哈希 → File。
   *
   * 浏览器不会长期保存用户选过的文件（刷新即失效），所以：
   * - 这份缓存还在 → 「重新解析」可以真的重新跑一次 PDF 解析；
   * - 缓存没了 → 必须请用户**重新选一次文件**，绝不能拿模型抽取冒充 PDF 解析。
   */
  const fileCacheRef = useRef<Map<string, File>>(new Map());
  /** 重新解析：待接收文件的那篇论文（点击按钮后由隐藏 input 的 onChange 接手） */
  const reparseInputRef = useRef<HTMLInputElement | null>(null);
  const reparseTargetRef = useRef<string | null>(null);
  /** 刚刚导入的论文 id：方法提取页据此自动选中并给出「查看刚导入的论文」 */
  const [lastImportedId, setLastImportedId] = useState<string | null>(null);
  /**
   * 上传页的「待处理队列 / 阶段」提升到 App（2026-10-11）：
   * 放在 UploadFlowView 内部时，切到其他页组件被卸载、状态清零 —— 用户实测切页回来队列就空了。
   * App 常驻不卸载，队列（含 File 对象）在会话内一直保留。
   */
  const [uploadQueue, setUploadQueue] = useState<Queued[]>([]);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  /**
   * 各语料集**预置缓存里到底有什么**（论文数 / 实验记录数）。
   * 实验可比性页据此如实说明「这份语料有没有实验记录」，
   * 不再无脑承诺「重新加载就能补齐实验记录」。
   */
  const [sampleStats, setSampleStats] = useState<Record<string, { papers: number; experiments: number; at: number }>>({});
  /** sampleStats 的同步引用：案例加载要把新值写进同一个事务，不能等渲染后的 setState */
  const sampleStatsRef = useRef(sampleStats);
  sampleStatsRef.current = sampleStats;
  const scopedRelations = useMemo(() => scopeRelations(relations, scope), [relations, scope]);
  /**
   * **当前分析范围的完整身份 key**（模式 + 语料集 + 论文集合 + 方法集合）。
   *
   * 分析产物（阅读路线 / 分歧 / 示例条件 / 语料元信息）一律按这个 key 归档与校验，
   * 过去只按 corpusId 归档，导致 case/own 的产物互相串（详见 `core/corpus.ts` 的 ScopeIdentity）。
   */
  const scopeKey = useMemo(() => scopeKeyOf(scope), [scope]);
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  /**
   * **同步**的任务锁（P1/P2）。
   *
   * 为什么不能用 state 判断：React 的 setState 是异步的，双击按钮的两次调用读到的
   * `relationBusy` 都是 `false`，于是同一任务被发起两次（关系分析会重复消耗模型额度、
   * 抽取会重复入库）。这些 ref 在**调用的同一 tick** 内就能读到，是真正的互斥。
   */
  const locks = useRef({
    /** 正在导入文件（并发导入会重复入库，见 importFiles） */
    import: false,
    /** 正在抽取的论文 id（同篇抽取必须互斥，否则取消句柄会被第二个任务覆盖） */
    extract: new Set<string>(),
    /**
     * 批次级互斥（2026-10-13 用户实测「提取卡住」的根因之一）：
     * 反复点「开始梳理 / 提取方法字段」会起**多个重叠批次**。单篇锁只挡住同一篇的重复调用，
     * 挡不住批次；而每个批次的 finally 都会把进度阶段置回 done ——
     * 于是出现「本轮分析已结束」与「步骤 03 提取中」同时成立的假卡死状态。
     */
    batchExtract: false,
    relations: false,
    plan: false,
    divergence: false,
    /** 正在加载语料（切换语料期间的旧加载结果不得写入） */
    corpusLoad: false,
  });
  /** 抽取任务的版本号：paperId → 版本号。返回时版本不符 → 结果作废 */
  const extractSeq = useRef<Record<string, number>>({});
  /**
   * 已被移除的论文 id（墓碑）。
   *
   * 用途：抽取是长异步，返回时若论文已被删除，旧响应绝不能写回（会复活出孤儿方法）。
   * 为什么不直接看 `papersRef` 里还有没有这篇：`analyzeFiles` 会在 `setPapers` 之后**立刻**调 extract，
   * 此时 ref 还没反映到新导入的论文 —— 只看 ref 会误判「论文不存在」而丢掉正常的抽取结果。
   * 墓碑只由显式的移除动作写入，语义精确。
   */
  const removedPaperIds = useRef<Set<string>>(new Set());
  /** 语料加载任务版本号：慢加载返回时若已被更新的加载取代，结果作废 */
  const loadSeq = useRef(0);
  /** 正在进行中的抽取调用的取消句柄（只停止本地等待） */
  const cancelHandles = useRef<Record<string, AbortController>>({});
  /** 重新分析/人工修正后，需要重新生成的下游结果（关系/决策）；比较页按当前数据实时重算 */
  const [pendingDependents, setPendingDependents] = useState<
    { paperId: string; at: number; reason?: 'reanalyze' | 'override'; fields?: string[] }[]
  >([]);
  /**
   * 三类模型任务的真实运行状态（过去一律传 busy={false}，按钮点了没有任何反馈，也无法停止）。
   * 另有：按语料批量取回全文的加载状态 —— 关系分析前必须先补齐全文，不能静默成功。
   */
  const [relationBusy, setRelationBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [divergenceBusy, setDivergenceBusy] = useState(false);
  const [hydratingScope, setHydratingScope] = useState(false);
  /**
   * 「梳理完成后自动跑一次关系分析」的触发器（2026-10-12 用户实测要求）。
   * 用计数器 + effect 而不是在 analyzeFiles 里直接调 genRelations：抽取过程里
   * setPapers/setMethods 是异步的，直接调会拿到导入前的空范围而静默中止；
   * effect 在最新提交后运行，且 400ms 防抖把批量/重试的多次触发合并成一次。
   */
  const [relationsAutoTick, setRelationsAutoTick] = useState(0);
  const taskHandles = useRef<Record<TaskKind, AbortController | null>>({ relations: null, plan: null, divergence: null });
  /**
   * 请求版本号：旧请求返回时不能覆盖新案例 / 新论文 / 人工修正后的状态。
   * 每次发起任务自增；语料切换、论文变化、人工修正时也自增，使在途结果直接作废。
   */
  const requestSeq = useRef<Record<TaskKind, number>>({ relations: 0, plan: 0, divergence: 0 });
  /**
   * 初始化（从本机 IndexedDB 恢复）的真实状态。
   *
   * 过去这个异步过程**没有 catch**：任一步抛错（IndexedDB 被禁用、数据损坏、配额异常）
   * 都会变成未处理的 Promise rejection，界面停在「0 篇论文」—— 和「本来就是空库」长得一模一样，
   * 用户会以为数据丢了。现在区分三态，失败时给出明确错误与「重试恢复」入口。
   */
  const [initState, setInitState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [initError, setInitError] = useState('');
  /** 恢复次数：点击「重试恢复」时递增，触发下面的恢复 effect 重跑 */
  const [initRetry, setInitRetry] = useState(0);
  const [config, setConfig] = useState<ModelConfig>(EMPTY_CONFIG);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  /** 最近一次移除的数据（撤销移除用）：移除入口已迁到分析结果页，撤销条必须挂在全局 */
  const [lastRemoved, setLastRemoved] = useState<{ paper: Paper; methods: Method[]; relations: Relation[] } | null>(null);
  const [evidence, setEvidence] = useState<{ e: Evidence; label: string; paper?: Paper } | null>(null);
  React.useEffect(() => {
    if (!lastRemoved) return;
    const t = window.setTimeout(() => setLastRemoved(null), 12000);
    return () => window.clearTimeout(t);
  }, [lastRemoved]);
  const [corpusMeta, setCorpusMeta] = useState<{ generatedAt: string; model?: string; promptVersion?: string; domain?: string; samplesAreDevOnly?: boolean; purpose?: string } | undefined>();
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | undefined>();
  const [testing, setTesting] = useState(false);
  const [, setTick] = useState(0);
  /** 品牌栏使用衬线字体：字体就绪前不显示，避免加载时字体跳变 */
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setFontsReady(true);
    };
    const timer = window.setTimeout(finish, 700);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) fonts.ready.then(finish).catch(finish);
    else finish();
    return () => window.clearTimeout(timer);
  }, []);

  /** 「使用说明」：把地图上方的三步引导滚到视野内并短暂强调（不改变任何数据） */
  const showMapHelp = useCallback(() => {
    const el = document.querySelector<HTMLElement>('.mapguide');
    if (!el) return;
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.classList.add('in');
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    el.classList.add('attn');
    window.setTimeout(() => el.classList.remove('attn'), 1600);
  }, []);

  const log = useCallback((line: string) => {
    setLogLines((prev) => [...prev.slice(-300), `[${new Date().toLocaleTimeString('zh-CN')}] ${line}`]);
  }, []);
  const logRef = useRef(log);
  logRef.current = log;
  /** 关系分析运行态的最新引用：effect 的防抖回调里要读「此刻」是否在跑，不能读渲染时的旧值 */
  const relationBusyRef = useRef(relationBusy);
  relationBusyRef.current = relationBusy;

  const modelReady = !!(config.baseUrl && config.apiKey && config.model);

  /**
   * 任务版本保护：
   * - `begin` 自增版本号并登记取消句柄，返回 `isLatest()`；
   * - 结果回来时若 `isLatest()` 为 false（期间又发起了新任务，或语料/论文/人工修正变化使版本作废），
   *   一律丢弃结果，**不允许覆盖当前状态**；
   * - `invalidateAll` 在语料切换、论文增删、人工修正时调用。
   */
  const beginTask = useCallback((kind: TaskKind) => {
    const seq = ++requestSeq.current[kind];
    taskHandles.current[kind]?.abort();
    const controller = new AbortController();
    taskHandles.current[kind] = controller;
    return { seq, signal: controller.signal, isLatest: () => requestSeq.current[kind] === seq };
  }, []);
  const endTask = useCallback((kind: TaskKind) => {
    taskHandles.current[kind] = null;
  }, []);
  const cancelTask = useCallback((kind: TaskKind, label: string) => {
    const h = taskHandles.current[kind];
    taskHandles.current[kind] = null;
    requestSeq.current[kind] += 1;
    h?.abort();
    logRef.current(`已请求停止等待：${label}（本次调用未完成，原结果保持不变；不代表服务端已停止计算或不再计费）`);
  }, []);
  /** 语料集/论文/人工修正发生变化时，让在途的模型任务结果失效 */
  const invalidateTasks = useCallback(() => {
    for (const k of ['relations', 'plan', 'divergence'] as const) requestSeq.current[k] += 1;
  }, []);

  /**
   * 「当前分析范围」变了（切 case/own、切语料、增删论文、方法集合变化）时：
   * 1. 让在途的模型任务结果**作废**（版本号自增）；
   * 2. 中断本地等待并复位 busy / 同步锁 —— 否则旧任务的 finally 会与新一轮任务互相打架；
   * 3. 分析产物由下面的 scopeKey effect 按新范围重新读取（属于新范围的就恢复，不属于的不显示）。
   *
   * 这是「请求途中切换范围不能显示或写入其他范围产物」的兜底：任何一个入口改范围，在途任务一律失效，
   * 不需要每个入口自己记得清理（旧实现只有 switchCorpus 做了这件事）。
   */
  useEffect(() => {
    invalidateTasks();
    for (const k of ['relations', 'plan', 'divergence'] as const) {
      taskHandles.current[k]?.abort();
      taskHandles.current[k] = null;
    }
    locks.current.relations = false;
    locks.current.plan = false;
    locks.current.divergence = false;
    setRelationBusy(false);
    setPlanBusy(false);
    setDivergenceBusy(false);
  }, [scopeKey, invalidateTasks]);

  /** 记录一次模型任务的真实调用轨迹，用于 usage 证据（不再写死 0） */
  const traceRecorder = useCallback(() => {
    const acc = { ms: 0, promptChars: 0, completionChars: 0, attempts: 0, calls: 0, error: '' };
    return {
      onTrace: (t: CallTrace) => {
        acc.calls += 1;
        acc.attempts = Math.max(acc.attempts, t.attempt ?? 1);
        acc.ms += t.ms ?? 0;
        acc.promptChars += t.promptChars ?? 0;
        acc.completionChars += t.completionChars ?? 0;
        if (t.error) acc.error = t.error;
      },
      totals: () => acc,
    };
  }, []);

  /* ---------- 初始化：恢复设置与已保存数据 ---------- */
  useEffect(() => {
    let cancelled = false;
    setInitState('loading');
    setInitError('');
    (async () => {
      try {
        const cfg = await loadMeta<ModelConfig>('modelConfig');
        if (cfg) setConfig(cfg);
        const ps = await repo.listPapers();
        const ms = await repo.listMethods();
        const rs = await repo.listRelations();
        // 历史数据归位：早期记录没有 corpusId，按论文 ID 判定其真实归属，
        // 否则会把旧 NLP 数据静默算进「正式视觉案例」的数量里。
        const patches = legacyCorpusPatches(ps, ms);
        for (const x of patches.papers) await repo.savePaper(x);
        for (const x of patches.methods) await repo.saveMethod(x);
        const paperPatched = new Map(patches.papers.map((x) => [x.id, x]));
        const methodPatched = new Map(patches.methods.map((x) => [x.id, x]));
        const psFixed = ps.map((x) => paperPatched.get(x.id) ?? x);
        const msFixed = ms.map((x) => methodPatched.get(x.id) ?? x);
        if (patches.papers.length || patches.methods.length) {
          logRef.current(
            `历史数据归位：${patches.papers.length} 篇论文、${patches.methods.length} 条方法分析已按语料集身份标记（避免不同语料集混算）。`,
          );
        }
        if (psFixed.length) {
          setPapers(psFixed);
          logRef.current(`恢复本机已有数据：${psFixed.length} 篇论文、${msFixed.length} 条方法分析`);
        }
        // 兼容第一阶段遗留数据：迁移 + **按当前规则重跑关系证据校验**（刷新恢复也要过证据校验）
        const restoredInit = normalizeRestoredData(msFixed, rs, psFixed);
        setMethods(restoredInit.methods);
        setRelations(restoredInit.relations);
        // 使用记录带运行时结构校验：坏数据按「没有」处理，不让一条脏记录带崩状态页
        const u = await loadMeta<UsageRecord[]>('usage', isUsageRecordList);
        if (u) setUsage(u);
        const ss = await loadMeta<Record<string, { papers: number; experiments: number; at: number }>>('sampleStats');
        if (ss) setSampleStats(ss);
        if (cancelled) return;
        setInitState('ready');
      } catch (e) {
        /**
         * 恢复失败必须显式说出来。
         * 这里**不能**假装成空库：用户本机明明有数据，界面却显示「0 篇论文」，
         * 是最容易被误读成「数据丢了」的情形。给出错误与重试入口，不做任何自作主张的清理。
         */
        const msg = (e as Error)?.message ?? String(e);
        setInitError(msg);
        setInitState('error');
        logRef.current(`本机数据恢复失败：${msg}（已有数据仍在浏览器里，可点「重试恢复」；不会自动清理任何内容）`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initRetry]);

  /**
   * 分析产物（语料元信息 / 分歧 / 阅读路线 / 示例条件）按**范围身份**恢复。
   *
   * 与初始化的分工：初始化只恢复论文/方法/关系/设置；这些产物依赖「当前范围」，
   * 必须等 scope 算出来之后按 `scopeKey` 读取 —— 于是 case ↔ own 切换后**自动换回属于该范围的产物**，
   * 不会把上一个范围的结果留在界面上。范围不一致（或老格式没有 scopeKey）时一律不复用，
   * 界面显示「尚未生成」，而不是显示别人的结论。
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cm, dv, pl, sp] = await Promise.all([
          loadMeta<typeof corpusMeta>('corpusMeta'),
          loadMeta<DivergenceReport>('divergence'),
          loadMeta<ReadingPlan>('decision'),
          loadMeta<UserProfile>('demoProfile'),
        ]);
        if (cancelled) return;
        setCorpusMeta(readScopedSnapshot<typeof corpusMeta>(cm, scopeKey));
        setDivergence(readScopedSnapshot<DivergenceReport>(dv, scopeKey));
        setPlan(readScopedSnapshot<ReadingPlan>(pl, scopeKey));
        setSampleProfile(readScopedSnapshot<UserProfile>(sp, scopeKey));
      } catch (e) {
        logRef.current(`分析产物恢复失败：${(e as Error).message}（按「尚未生成」显示，不会用别的结果冒充）`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  const refreshUsage = async () => {
    const u = (await loadMeta<UsageRecord[]>('usage')) || [];
    setUsage([...u]);
  };

  /* ---------- 导入 ---------- */
  /**
   * 导入串行队列（P1/P2）。
   *
   * 两个入口可以并发触发导入（上传页「开始梳理脉络」与论文集合页的导入按钮），
   * 而 `importFiles` 内部有 `await`（算哈希、解析 PDF）。若直接并发：
   * ① 两边各自的 `seenHashes` 都不含对方的论文 → 同一个文件入库两次；
   * ② 两边同时 `repo.savePaper` + `setPapers`，后写的把先写的覆盖成旧数组 → 凭空少一篇。
   * 这里用一条 Promise 链把导入**串行化**：后来的排队，不会与正在跑的重叠。
   */
  const importQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const importFiles = useCallback(
    (files: FileList | File[]): Promise<ImportResult[]> => {
      const run = importQueueRef.current.then(
        () => runImport(Array.from(files)),
        () => runImport(Array.from(files)),
      );
      // 队列本身不能被某一次失败打断：失败时只把结果传出去，链上换成已落地的 Promise
      importQueueRef.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    // runImport 每次渲染都是新闭包（要读最新的 papersRef / locks），这里靠 ref 读最新值
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const runImport = async (files: File[]): Promise<ImportResult[]> => {
    /**
     * 本轮批次的哈希去重集合：开始时装入**当前最新**的哈希（读 ref，不读渲染闭包），
     * 每导入一个就加进去。
     *
     * 不能只依赖 `papers` 闭包：setState 是异步的，一次选多个文件时闭包里的 papers 始终是旧的，
     * 同一个文件（或内容相同的两个文件）会被重复导入。
     */
    const latestPapers = papersRef.current;
    const seenHashes = new Set<string>(latestPapers.map((p) => p.contentHash).filter(Boolean) as string[]);
    const titleByHash = new Map<string, string>(
      latestPapers.filter((p) => p.contentHash).map((p) => [p.contentHash as string, p.title]),
    );
    /** 同上，但记 id：跳过重复时上传页要把文件卡对回库里这篇论文 */
    const idByHash = new Map<string, string>(
      latestPapers.filter((p) => p.contentHash).map((p) => [p.contentHash as string, p.id]),
    );
    /** 本次真正写进库里的论文（去重跳过的不算），用于导入后切范围与给出入口 */
    const added: Paper[] = [];
    /** 逐文件结果（2026-10-10）：草稿的「待处理队列」是按**文件**展示的，界面需要把每个文件对上它的真实结果 */
    const results: ImportResult[] = [];
    for (const file of files) {
      log(`导入文件：${file.name}（${(file.size / 1024 / 1024).toFixed(1)} MB）`);
      try {
        const hash = await hashFile(file);
        // 只要用户在**本次会话里**还留着这份文件，就记住它，便于真正「重新解析」
        fileCacheRef.current.set(hash, file);
        if (seenHashes.has(hash)) {
          log(
            `  跳过：与已导入的「${titleByHash.get(hash) ?? file.name}」内容相同（按内容哈希去重，不重复消耗模型额度）`,
          );
          results.push({ fileName: file.name, skipped: `内容与「${titleByHash.get(hash) ?? ''}」相同，已跳过（不重复消耗额度）`, skippedPaperId: idByHash.get(hash) });
          continue;
        }
        seenHashes.add(hash);
        titleByHash.set(hash, file.name);
        // 重新读取一遍字节用于解析（File.arrayBuffer 可重复调用）
        const outcome = await parsePdfFile(file, {
          contentHash: hash,
          sample: {
            purpose: '用户导入的真实文件',
            license: '版权归原作者，仅在本机解析用于个人阅读',
          },
        });
        if (!outcome.paper) {
          results.push({ fileName: file.name, skipped: '解析器没有返回论文对象' });
          continue;
        }
        /**
         * 标题状态必须如实：PDF 首页排版多变，实测会把摘要句抓成标题。
         * 不像标题的一律先标「待确认」，等模型在原文里核验出真标题再改写。
         *
         * 2026-10-12 用户实测补充：启发式还会抓到期刊页眉（"JOURNAL OF LATEX CLASS
         * FILES, VOL. 14, NO. 8, AUGUST 2021"）、作者行（"Charles R. Qi Li Yi Hao Su
         * Leonidas J. Guibas"）和摘要片段。抓得不像标题时用**文件名**顶上 ——
         * 用户自己的文件名通常比这些垃圾片段更像标题；依旧标 unverified（界面显示
         * 「标题待确认」），模型抽取成功后会按原文核验替换。
         */
        const fileTitle = file.name.replace(/\.pdf$/i, '').trim();
        const guessOk = looksLikeTitle(outcome.paper.title);
        const useFileTitle = !guessOk && looksLikeTitle(fileTitle) && fileTitle.length >= 6;
        const paper: Paper = {
          ...outcome.paper,
          title: guessOk ? outcome.paper.title : useFileTitle ? fileTitle : outcome.paper.title,
          titleFrom: guessOk ? 'heuristic' : 'unverified',
        };
        outcome.warnings.forEach((w) => log(`  提示：${w}`));
        if (!outcome.ok) {
          log(`  失败：${outcome.error}`);
          await repo.savePaper(paper);
          setPapers((p) => [...p, paper]);
          added.push(paper);
          results.push({ fileName: file.name, paper });
          continue;
        }
        log(`  解析成功：标题「${paper.title}」，${paper.pages.length} 页，${paper.charCount} 字符`);
        if (paper.titleFrom === 'unverified') {
          log('  注意：从首页猜出来的标题不像论文标题，已标记为「标题待确认」（模型抽取后会用原文核验的真标题替换）');
        }
        await repo.savePaper(paper);
        setPapers((p) => [...p, paper]);
        added.push(paper);
        results.push({ fileName: file.name, paper });
      } catch (err) {
        log(`  异常：${(err as Error).message}`);
        results.push({ fileName: file.name, error: (err as Error).message });
      }
    }
    if (added.length) {
      /**
       * 导入后**必须让用户找得到这篇论文**：
       * 用户导入的论文属于「我上传的论文」集合，而案例模式的列表只显示预置 5 篇，
       * 旧实现不切换范围也没入口 → 论文在库里但整页看不见（实测问题 1）。
       */
      const last = added[added.length - 1];
      setLastImportedId(last.id);
      const ownCount =
        papersRef.current.filter((p) => (p.corpusId ?? 'user-import') === 'user-import').length + added.length;
      if (mapMode !== 'own') {
        setMapMode('own');
        log(`已切到「我上传的论文」范围（共 ${ownCount} 篇），列表与计数都已指向这个集合；案例数据不受影响，可随时切回。`);
      }
    }
    setTick((t) => t + 1);
    // 论文集合变了：在途分析结果不再对应当前数据
    invalidateTasks();
    // 逐文件结果：供「待处理队列」按文件如实显示状态
    return results;
  };

  /**
   * 一键分析（2026-10-10 适配 Superdesign 草稿的前端逻辑）：
   * 草稿是「先把文件攒在待处理队列 → 点『开始梳理脉络』→ 一次性分析」，
   * 所以底层把这个动作串起来：**导入并解析全部文件 → 已配置模型时逐篇抽取**。
   * 串行抽取是为了让「分析中」的进度可读，也避免并发打爆用户自配的接口。
   *
   * 2026-10-12（用户实测要求）：梳理的产出**包含方法关系** —— 字段抽完后自动接一次关系分析。
   * 「点了开始梳理脉络，它就应该直接触发给我们结果，而不是再去找一个入口点第二次」。
   * 触发走 state + effect（见 relationsAutoTick），不在这个闭包里直接调 genRelations：
   * 这里的 scope/relations 还是导入前的快照，直接调会因集合为空而静默中止。
   */
  const analyzeFiles = async (files: File[]) => {
    const results = await importFiles(files);
    if (!modelReady) {
      log('未配置模型接口：已完成解析并把论文放进「论文集合」；「提取方法字段」需要先在设置里配置模型。');
      return results;
    }
    /**
     * 批次级互斥（2026-10-13）：重复点击会起多个重叠批次 —— 单篇锁只挡同篇重复，
     * 挡不住批次，而且每个批次的 finally 都会把阶段置回 done，界面就会在还在抽取时
     * 显示「本轮分析已结束」。这里直接不让第二个批次进来。
     */
    if (locks.current.batchExtract) {
      log('已有一批「提取方法字段」在进行中：本次重复触发已忽略（重复点击不会加速，等它跑完即可）。');
      return results;
    }
    locks.current.batchExtract = true;
    let extracted = 0;
    try {
      for (const r of results) {
      /**
       * 被去重跳过的文件也要参与提取（2026-10-12 用户实测）：
       * 论文已在库里（上次导入过），若还没有方法框架就补上。
       * 旧实现只处理 `r.paper`，跳过项全是 undefined → 用户重新上传「之前处理过的论文」时
       * 全部命中重复跳过、什么都不发生，界面只剩一个「重新提取方法字段」，看着就是卡住。
       * extract 内部有「已有实时分析结果就跳过」的保护，不会重复消耗额度。
       */
        const target = r.paper ?? (r.skippedPaperId ? papers.find((p) => p.id === r.skippedPaperId) : undefined);
        if (!target || target.parseStatus !== 'ok') continue;
        // 必须把 paper 对象带上：此刻 setPapers 还没反映到闭包，extract 内部按 id 找不到刚导入的论文
        const m = await extract(target.id, false, target);
        if (m) extracted += 1;
      }
    } finally {
      // 无论成功、失败还是抛错都必须释放批次锁 —— 否则这一页再也提取不了（比"重复点击"更糟）
      locks.current.batchExtract = false;
    }
    // 只有真的抽出了新方法才自动跑关系：全是重复跳过时不再重复花一次模型额度
    // （此时若关系仍为空，地图/关系页有手动入口）
    if (extracted > 0) setRelationsAutoTick((t) => t + 1);
    return results;
  };

  /**
   * 真正重新解析一份 PDF（用户实测问题 2）。
   *
   * 旧实现把「重试解析」接到了模型抽取上 —— 那是完全不同的动作：PDF 都没解析出文本，
   * 抽取只会再失败一次，用户还以为是「解析重试」。这里分两种情况：
   * - 本次会话还留着这份 File → 直接重跑 PDF 解析；
   * - 已经不在了（刷新过 / 换了文件）→ 打开文件选择器请用户重新选一次，再真正解析。
   */
  const reparsePaper = async (paperId: string, picked?: File) => {
    const target = papersRef.current.find((p) => p.id === paperId);
    if (!target) {
      log('重新解析中止：找不到这篇论文（可能已被移除）。');
      return;
    }
    /**
     * 重新解析意味着「这篇论文的全文要换了」：在途抽取的旧响应必须失效，
     * 否则它会用旧全文的结果覆盖掉新解析出来的内容（P1）。
     * 取消句柄也一起中断，避免白等。
     */
    bumpSeq(extractSeq.current, paperId);
    cancelHandles.current[paperId]?.abort();
    delete cancelHandles.current[paperId];
    let file = picked;
    if (!file) {
      file = target.contentHash ? fileCacheRef.current.get(target.contentHash) : undefined;
    }
    if (!file) {
      // 请用户重新选文件：由隐藏的 input 接手，选完再回到这里
      reparseTargetRef.current = paperId;
      log(`需要重新选择「${target.title}」对应的 PDF 文件（浏览器不会长期保留你选择过的文件，我们不拿模型抽取冒充解析重试）。`);
      reparseInputRef.current?.click();
      return;
    }
    const hash = await hashFile(file);
    if (picked && target.contentHash && hash !== target.contentHash) {
      // 用户重新选的其实是**另一份文件**：按新论文导入，绝不覆盖原来那条记录
      log('重新选择的是另一份文件（内容哈希与原来不同），按新论文导入，不覆盖原有记录。');
      await importFiles([file]);
      return;
    }
    fileCacheRef.current.set(hash, file);
    log(`重新解析 PDF：${file.name}（${(file.size / 1024 / 1024).toFixed(1)} MB）…`);
    try {
      const outcome = await parsePdfFile(file, {
        contentHash: hash,
        sample: { purpose: '用户导入的真实文件（重新解析）', license: '版权归原作者，仅在本机解析用于个人阅读' },
      });
      if (!outcome.paper) {
        log('  重新解析失败：解析器没有返回论文对象。');
        return;
      }
      // 标题兜底与导入路径一致：猜得不像标题时用文件名顶上，标 unverified（标题待确认）
      const fileTitle = file.name.replace(/\.pdf$/i, '').trim();
      const guessOk = looksLikeTitle(outcome.paper.title);
      const useFileTitle = !guessOk && looksLikeTitle(fileTitle) && fileTitle.length >= 6;
      const next: Paper = {
        ...outcome.paper,
        // 沿用原来的 id，避免同一篇论文出现两条记录（方法/关系的关联也不会断）
        id: target.id,
        title: guessOk ? outcome.paper.title : useFileTitle ? fileTitle : outcome.paper.title,
        titleFrom: guessOk ? 'heuristic' : 'unverified',
      };
      outcome.warnings.forEach((w) => log(`  提示：${w}`));
      if (outcome.ok) {
        log(`  重新解析成功：标题「${next.title}」，${next.pages.length} 页，${next.charCount} 字符`);
      } else {
        log(`  重新解析仍然失败：${outcome.error}`);
      }
      await repo.savePaper(next);
      setPapers((ps) => ps.map((p) => (p.id === next.id ? next : p)));
      setLastImportedId(next.id);
      setTick((t) => t + 1);
      invalidateTasks();
    } catch (err) {
      log(`  重新解析异常：${(err as Error).message}`);
    }
  };

  /**
   * 这份 PDF 现在能不能**直接**重解析（不需要用户再选一次文件）。
   * 本次会话里选过就还在内存缓存里；刷新过就没了 —— 界面据此给出不同的按钮文案，
   * 不让用户以为点了「重新选择」却没有选择框弹出。
   */
  const canReparseInPlace = useCallback(
    (paperId: string) => {
      const p = papers.find((x) => x.id === paperId);
      return Boolean(p?.contentHash && fileCacheRef.current.has(p.contentHash));
    },
    [papers],
  );

  /** 隐藏 input 的回调：用户重新选完文件后真正执行解析 */
  const onReparseFilePicked = async (files: FileList | null) => {
    const paperId = reparseTargetRef.current;
    reparseTargetRef.current = null;
    if (reparseInputRef.current) reparseInputRef.current.value = '';
    if (!paperId || !files || !files.length) return;
    await reparsePaper(paperId, files[0]);
  };

  const importPaste = async (title: string, text: string) => {
    const paper = paperFromText(title, text, { sample: { purpose: '用户粘贴文本导入' } });
    paper.titleFrom = 'heuristic';
    await repo.savePaper(paper);
    setPapers((p) => [...p, paper]);
    invalidateTasks();
    log(`粘贴导入：${paper.title}（${paper.charCount} 字符）`);
  };

  /**
   * 移除论文：论文本体 + **该论文的全部方法** + 这些方法参与的全部关系。
   *
   * 不再假设方法 ID 是 `m_${paperId}`（历史数据与重新分析后的 ID 不一定长这样），
   * 否则会留下「论文没了、方法和关系还挂着」的悬挂数据。
   * 先写库、再改内存状态；写库失败就从本机重新读一遍，避免界面与存储不一致。
   */
  const removePaper = async (id: string) => {
    // 立墓碑 + 让在途抽取作废：删除后返回的旧响应不得写回（否则复活出孤儿方法）
    removedPaperIds.current.add(id);
    bumpSeq(extractSeq.current, id);
    // 一律按**最新**状态计算（读 ref），不用渲染闭包：并发删除时闭包里的数组可能是过期的
    const next = collectPaperRemoval(papersRef.current, methodsRef.current, relationsRef.current, id);
    // 记录被移除的数据供「撤销移除」用：移除入口已迁到分析结果页（2026-10-11 表格化），
    // 撤销条不能再挂在论文集合的局部状态里，否则从结果页移除后无处可撤销
    const removedPaper = papersRef.current.find((p) => p.id === id);
    /**
     * 「删论文 + 删方法 + 删关系」放在**同一个 IndexedDB 事务**里（P1）。
     *
     * 旧实现是三次独立调用：删完关系、删方法时如果失败，论文还在、方法没了 ——
     * 界面上就是「论文还在但分析结果凭空消失」的部分删除状态，而且错误提示还写着
     * 「未做任何丢失性操作」，与真实结果相反。现在要么整体提交，要么整体回滚。
     */
    try {
      await repo.applyAtomic([
        ...next.removedRelations.map((r) => ({ store: 'relations' as const, kind: 'delete' as const, key: r.id })),
        ...next.removedMethods.map((m) => ({ store: 'methods' as const, kind: 'delete' as const, key: m.id })),
        { store: 'papers' as const, kind: 'delete' as const, key: id },
      ]);
    } catch (e) {
      // 事务已整体回滚，本机数据仍是原样 —— 提示必须如实这么说（不再声称「未做丢失性操作」）
      // 墓碑也要撤回：论文实际还在，后续对它的抽取不该被误判为「已删除」
      removedPaperIds.current.delete(id);
      log(`移除失败：${(e as Error).message}（本次删除已整体回滚，本机数据保持原样，可重试）`);
      try {
        const psBack = await repo.listPapers();
        const restoredBack = normalizeRestoredData(await repo.listMethods(), await repo.listRelations(), psBack);
        setPapers(psBack);
        setMethods(restoredBack.methods);
        setRelations(restoredBack.relations);
      } catch (e2) {
        log(`移除失败后重新读取本机数据也失败：${(e2 as Error).message}（界面显示的可能不是最新状态，请刷新页面）`);
      }
      return;
    }
    setPapers(next.papers);
    setMethods(next.methods);
    setRelations(next.relations);
    setSelected((s) => s.filter((x) => x !== id));
    // 论文集合变了：在途分析结果不再对应当前数据
    invalidateTasks();
    if (removedPaper) setLastRemoved({ paper: removedPaper, methods: next.removedMethods, relations: next.removedRelations });
    // 结果页正看着这篇论文时，它被移除了 → 清掉目标，否则正文消失、页面空白
    setResultPaperId((cur) => (cur === id ? null : cur));
    log(
      `移除论文 ${id}：同时删除该论文的 ${next.removedMethods.length} 条方法分析、` +
        `${next.removedRelations.length} 条关联关系（同一事务提交，不留悬挂关系）`,
    );
  };

  /** 撤销移除：把论文、方法分析与关联关系一起写回本机（用户数据一律不丢，不重新调用模型） */
  const restorePaper = async (paper: Paper, method?: Method, allMethods?: Method[], relationsToRestore?: Relation[]) => {
    const methodsBack = allMethods && allMethods.length ? allMethods : method ? [method] : [];
    const relsBack = relationsToRestore ?? [];
    /**
     * 与 removePaper 对称：**同一个事务**写回。
     * 旧实现逐条 save，中途失败会留下「论文回来了、方法/关系没回来」的部分恢复状态，
     * 而日志却写着「都已写回本机」。
     */
    try {
      await repo.applyAtomic([
        { store: 'papers' as const, kind: 'put' as const, value: paper },
        ...methodsBack.map((m) => ({ store: 'methods' as const, kind: 'put' as const, value: m })),
        ...relsBack.map((r) => ({ store: 'relations' as const, kind: 'put' as const, value: r })),
      ]);
      // 论文回到库里：撤销墓碑，后续可以正常抽取
      removedPaperIds.current.delete(paper.id);
    } catch (e) {
      log(`撤销移除失败：${(e as Error).message}（本次恢复已整体回滚，本机数据保持移除后的状态，可重试）`);
      try {
        const psBack = await repo.listPapers();
        const restoredBack = normalizeRestoredData(await repo.listMethods(), await repo.listRelations(), psBack);
        setPapers(psBack);
        setMethods(restoredBack.methods);
        setRelations(restoredBack.relations);
      } catch {
        /* 读取也失败时保持现状，至少日志已经如实说明 */
      }
      return;
    }
    setPapers((p) => (p.some((x) => x.id === paper.id) ? p : [...p, paper]));
    if (methodsBack.length) {
      const backIds = new Set(methodsBack.map((m) => m.id));
      setMethods((ms) => [...ms.filter((m) => !backIds.has(m.id)), ...methodsBack]);
    }
    if (relsBack.length) {
      const backRelIds = new Set(relsBack.map((r) => r.id));
      setRelations((rs) => [...rs.filter((r) => !backRelIds.has(r.id)), ...relsBack]);
    }
    log(
      `已撤销移除：${paper.title.slice(0, 30)}（论文、${methodsBack.length} 条方法分析、` +
        `${relsBack.length} 条关联关系都已在同一事务写回本机，不会重新调用模型）`,
    );
  };

  /* ---------- 加载预置样例语料（明确标注为缓存） ---------- */
  /** 语料集 → 缓存目录与 corpusId（两者隔离，避免混合生成关系与推荐） */
  const corpusConfig = (c: 'vision' | 'nlp-dev') =>
    c === 'vision'
      ? { base: './samples-vision/', id: 'vision-classification' as const, label: '正式案例：图像分类（CNN vs 视觉 Transformer，5 篇）' }
      : { base: './samples/', id: 'nlp-dev' as const, label: '开发回归样例：NLP（5 篇，旧）' };

  /**
   * 切换语料集：**替换而不是叠加**。
   * 依据用户要求「不要用叠加来实现切换」：切换时把上一套语料集的预置论文与方法从
   * 状态与 IndexedDB 中都移除（它们随时可以从预置缓存重新加载），用户自己上传的论文不受影响。
   */
  const switchCorpus = async (next: 'vision' | 'nlp-dev') => {
    if (next === corpus) return;
    if (locks.current.corpusLoad) {
      log('正有语料加载任务在进行，切换已忽略（避免加载结果写进刚切走的语料）。');
      return;
    }
    const outgoing = CORPUS_META[corpus];
    /**
     * 一次性算出「论文 + 方法 + **关系**」，再用**同一个事务**删（P1）。
     *
     * 旧实现只删论文与方法、逐条 delete：
     * ① 中途失败会留下「删了一半」的中间态，而日志却说「已移除」；
     * ② 更关键的是**关系一条都没删** —— 切换后关系表里仍留着指向已删方法的悬挂关系，
     *    切回来或刷新后关系图会出现找不到端点的边。
     */
    const removal = collectScopeRemoval(
      papersRef.current,
      methodsRef.current,
      relationsRef.current,
      new Set(papersRef.current.filter((x) => x.corpusId === outgoing.id).map((x) => x.id)),
    );
    try {
      await repo.applyAtomic([
        ...removal.removedRelations.map((r) => ({ store: 'relations' as const, kind: 'delete' as const, key: r.id })),
        ...removal.removedMethods.map((m) => ({ store: 'methods' as const, kind: 'delete' as const, key: m.id })),
        ...removal.removedPapers.map((p) => ({ store: 'papers' as const, kind: 'delete' as const, key: p.id })),
      ]);
    } catch (e) {
      log(
        `切换语料失败：${(e as Error).message}（删除已整体回滚，仍停留在「${outgoing.label}」，可重试）`,
      );
      try {
        const psBack = await repo.listPapers();
        const restoredBack = normalizeRestoredData(await repo.listMethods(), await repo.listRelations(), psBack);
        setPapers(psBack);
        setMethods(restoredBack.methods);
        setRelations(restoredBack.relations);
      } catch {
        /* 保持现状，日志已如实说明 */
      }
      return;
    }
    setPapers(removal.papers);
    setMethods(removal.methods);
    setRelations(removal.relations);
    setCorpus(next);
    try {
      localStorage.setItem('rp.corpus', next);
    } catch {
      /* 忽略 */
    }
    setLoadResult(undefined);
    setExpFocus(null);
    /**
     * 上一个案例的分析产物（阅读路线 / 分歧 / 过期提示 / 语料元信息 / 待复核队列 / 已勾选论文）
     * 必须一起下线：它们属于**那个案例**，留在界面上会被误读成当前案例的结论。
     * 本机存档带语料集身份（asScopedSnapshot），因此切换后刷新也不会把旧案例的结果读回来。
     */
    setDivergence(undefined);
    setPlan(undefined);
    setSampleProfile(undefined);
    setStaleNotes([]);
    setCorpusMeta(undefined);
    setPendingDependents([]);
    setSelected([]);
    setMapMode('case');
    // 在途的模型任务属于上一个案例：让它们的结果作废，并停止本地等待
    invalidateTasks();
    for (const k of ['relations', 'plan', 'divergence'] as const) {
      taskHandles.current[k]?.abort();
      taskHandles.current[k] = null;
    }
    setRelationBusy(false);
    setPlanBusy(false);
    setDivergenceBusy(false);
    // 本机存档**不覆盖**：它们各自带着 corpusId，只有当前语料集一致时才会被读回来，
    // 因此既不会串到别的案例，也不会因为切换而丢掉自己那份个性化结果。
    log(
      `已切换到「${CORPUS_META[next].label}」：上一套语料（${outgoing.label}）的 ${removal.removedPapers.length} 篇论文、` +
        `${removal.removedMethods.length} 条方法分析与 ${removal.removedRelations.length} 条关系已在同一事务中移除（不做叠加，不留悬挂关系）；` +
        '两套语料各自独立计算关系与推荐；上一个范围的阅读路线、分歧与过期提示已一起清理，不会被带过来。',
    );
  };

  /**
   * 加载预置语料：**按语料集幂等替换**。
   *
   * 行为约定（修复「5 篇变 10 篇」）：
   * 1. 只替换当前语料集范围内的论文与方法，用户自己上传的论文不受影响；
   * 2. 重复点击不会重复添加（同 ID 覆盖写入，且不再做「追加合并」）；
   * 3. 失败时保留已有数据，并给出可重试的提示；
   * 4. 完成后回报「论文数 / 实验记录数 / 关系数」，界面只显示当前语料集的数字。
   */
  const loadSample = async (key: CorpusKey = corpus) => {
    /**
     * 同步锁 + 任务版本号（P1）。
     *
     * 同步锁：`corpusLoading` 是 state，双击时两次调用读到的都是 null，会同时发起两次加载
     * （两次网络请求、两次写入，后一次覆盖前一次）。
     * 任务版本号：加载是**慢异步**（下载 index + 全文），期间用户可能切换语料或切换模式，
     * 旧加载返回时若还照写，就会把 A 案例的数据写进 B 案例的范围。返回时版本不符 → 结果作废。
     */
    if (locks.current.corpusLoad) {
      log('已有加载任务在进行中，已忽略本次点击（避免重复写入）。');
      return;
    }
    const seq = ++loadSeq.current;
    const stillCurrent = () => loadSeq.current === seq && corpusRef.current === key;
    locks.current.corpusLoad = true;
    const cfg = CORPUS_META[key];
    setCorpusLoading(key);
    try {
      log(`加载语料：${cfg.label}（离线真实模型生成，非本次实时分析）…`);
      const { index, formatMismatch } = await loadCorpusIndex(cfg.base);
      if (!stillCurrent()) {
        log('加载语料：期间已切换语料集，本次结果作废（不写入本机）。');
        return;
      }
      const corpusId = cfg.id;
      const hyd = index.papers.map((m) => ({ ...hydratePaper(m), corpusId, cached: true as const }));
      const cachedMethods = index.methods.map((m) => ({ ...m, cached: true, corpusId }));
      const cachedRelationsRaw = index.relations.map(
        (r) => ({ ...migrateRelation(r), cached: true } as Relation & { cached: boolean }),
      );
      /**
       * 缓存里的 evidenceState 是生成缓存那一刻的结论，规则版本变化后不能继续冒充当前结论。
       * 这里按**当前规则**重新跑一遍关系证据判定；规则版本不一致时降级为「待核查」。
       */
      const relCheck = revalidateCachedRelations(cachedRelationsRaw, cachedMethods, hyd, {
        cachedRulesVersion: index.rulesVersion,
        rulesVersionChanged: !!index.rulesVersion && index.rulesVersion !== RULES_VERSION,
      });
      const cachedRelations = relCheck.relations;

      /**
       * 幂等替换该语料集已有记录：**先写新的、再删被替换掉的旧的**，中途失败时旧数据仍在。
       *
       * 两个数据安全要点（2026-09-26 实测修复）：
       * ① 同 ID 覆盖写方法时必须**合并人工修正** —— 缓存里永远没有 overrides，
       *    直接覆盖就会把用户逐字段核对过的修正丢掉（实测：重载后 1 → 0）；
       * ② 论文 / 方法 / 关系的所有写入与删除必须在**同一个 IndexedDB 事务**里提交，
       *    否则「原子替换」只是说法：中途失败会留下半新半旧的中间态。
       */
      // 一律按**最新**状态算（读 ref）：加载期间的导入/删除不能被这次加载的旧快照覆盖
      const prevScopePaperIds = papersRef.current.filter((x) => x.corpusId === corpusId).map((x) => x.id);
      const prevScopeMethodIds = methodsRef.current.filter((x) => x.corpusId === corpusId).map((x) => x.id);
      const mergedMethods = mergeCachedMethods(cachedMethods, methodsRef.current);
      const newPaperIds = new Set(hyd.map((x) => x.id));
      const newMethodIds = new Set(mergedMethods.map((m) => m.id));
      const paperDeleteIds = prevScopePaperIds.filter((id) => !newPaperIds.has(id));
      const methodDeleteIds = prevScopeMethodIds.filter((id) => !newMethodIds.has(id));
      /**
       * 关系按范围替换：只替换「两端都属于本次加载语料的方法」的关系。
       * 落库写的是 `relSwap.write`（已剔除与人工关系撞 ID 的缓存版本），**不是原始缓存数组** ——
       * 直接写缓存数组会把人工修正覆盖掉：内存里保住了、库里丢了，一刷新就现形。
       */
      const loadedMethodIds = new Set<string>(mergedMethods.map((m) => m.id));
      const relSwap = replaceRelationsInScope(relationsRef.current, cachedRelations, loadedMethodIds);
      if (!stillCurrent()) {
        log('加载语料：期间已切换语料集，本次结果作废（未写入本机）。');
        return;
      }

      /**
       * 案例加载的**完整提交协议**（P1）。
       *
       * 旧实现把「主体（论文/方法/关系）」和「配套产物（路线 / 分歧 / 示例条件 / 语料元信息 /
       * 缓存摘要）」分成两个commit：主体提交之后又分别 `saveMeta`，
       * 中途任一步失败就会形成「新的论文已入库、路线还是上一个案例的」这种**新旧混合状态**。
       *
       * meta 本身也是 IndexedDB 里的一个 store，因此这里把它们**全部放进同一个事务**：
       * 要么整套一起提交，要么整套一起回滚。
       */
      const nextScopeKey = scopeIdentityKey({
        mode: 'case',
        corpusId,
        paperIds: hyd.map((x) => x.id),
        methodIds: mergedMethods.map((m) => m.id),
      });
      const paperCount = hyd.length;
      const cachedDiv = index.divergences ? ({ ...index.divergences, cached: true } as DivergenceReport) : null;
      const cachedPlan = index.decisionSample ? ({ ...index.decisionSample, cached: true } as ReadingPlan) : null;
      const nextStats = {
        ...sampleStatsRef.current,
        [key]: { papers: hyd.length, experiments: cachedMethods.reduce((a, m) => a + (m.experiments?.length ?? 0), 0), at: Date.now() },
      };
      await repo.applyAtomic([
        ...hyd.map((value) => ({ store: 'papers' as const, kind: 'put' as const, value })),
        ...paperDeleteIds.map((key) => ({ store: 'papers' as const, kind: 'delete' as const, key })),
        ...mergedMethods.map((value) => ({ store: 'methods' as const, kind: 'put' as const, value })),
        ...methodDeleteIds.map((key) => ({ store: 'methods' as const, kind: 'delete' as const, key })),
        ...relSwap.write.map((value) => ({ store: 'relations' as const, kind: 'put' as const, value })),
        ...relSwap.deleteIds.map((key) => ({ store: 'relations' as const, kind: 'delete' as const, key })),
        // ↓ 配套产物与主体同事务提交
        {
          store: 'meta' as const,
          kind: 'put' as const,
          value: { id: 'divergence', key: 'divergence', value: asScopedSnapshot(nextScopeKey, corpusId, cachedDiv, paperCount) } as never,
        },
        {
          store: 'meta' as const,
          kind: 'put' as const,
          value: { id: 'decision', key: 'decision', value: asScopedSnapshot(nextScopeKey, corpusId, cachedPlan, paperCount) } as never,
        },
        {
          store: 'meta' as const,
          kind: 'put' as const,
          value: {
            id: 'demoProfile',
            key: 'demoProfile',
            value: asScopedSnapshot(nextScopeKey, corpusId, index.demoProfile ?? null, paperCount),
          } as never,
        },
        {
          store: 'meta' as const,
          kind: 'put' as const,
          value: { id: 'corpusMeta', key: 'corpusMeta', value: asScopedSnapshot(nextScopeKey, corpusId, index.meta, paperCount) } as never,
        },
        {
          store: 'meta' as const,
          kind: 'put' as const,
          value: { id: 'sampleStats', key: 'sampleStats', value: nextStats } as never,
        },
      ]);
      if (!stillCurrent()) {
        log('加载语料：写入期间已切换语料集，已重新读取本机数据以保持一致。');
        const psBack = await repo.listPapers();
        const restoredBack = normalizeRestoredData(await repo.listMethods(), await repo.listRelations(), psBack);
        setPapers(psBack);
        setMethods(restoredBack.methods);
        setRelations(restoredBack.relations);
        return;
      }
      const keptOverrides = mergedMethods.reduce((a, m) => a + (m.overrides?.length ?? 0), 0);

      setPapers((prev) => [...prev.filter((x) => x.corpusId !== corpusId), ...hyd]);
      setMethods((prev) => [...prev.filter((m) => m.corpusId !== corpusId), ...mergedMethods]);
      setRelations(relSwap.next);
      if (keptOverrides) {
        log(`已保留 ${keptOverrides} 处人工字段修正（按同 ID 合并写入，重新加载案例不会覆盖你的修正）`);
      }
      const keptManualRels = relSwap.keep.filter((r) => r.userEdited).length;
      if (keptManualRels) {
        log(`已保留 ${keptManualRels} 条人工修正关系（缓存结果不覆盖人工修正）`);
      }
      setMapMode('case');
      setCorpusMeta(index.meta);

      const inputsSignature = index.papers.map((x) => x.id).sort().join(',');
      const staleness = assessCorpusStaleness(
        {
          cacheVersion: index.cacheVersion,
          meta: index.meta,
          rulesVersion: index.rulesVersion,
          inputsSignature: index.inputsSignature,
        },
        PROMPT_VERSION,
        inputsSignature,
      );
      const notes = [...staleness.notes, ...relCheck.notes];
      if (formatMismatch) notes.push(formatMismatch);
      setStaleNotes(notes);
      if (staleness.stale) log('过期提示：' + staleness.notes.join(' / '));
      if (relCheck.downgraded) {
        log(`关系重校验：${relCheck.downgraded} 条缓存关系未能通过当前规则判定，已降级为「待核查」（不删除数据，只降可信度）。`);
      }

      /**
       * 分析产物已在上面的**同一事务**里落库（divergence / decision / demoProfile / corpusMeta / sampleStats），
       * 这里只更新内存状态 —— 不再有「主体提交完了、存档还没写完」的混合状态窗口。
       * 全部按 `nextScopeKey` 归档：切到别的范围后刷新不会把本范围的结论读成当前范围的。
       */
      setDivergence(cachedDiv ?? undefined);
      setPlan(cachedPlan ?? undefined);
      setSampleProfile(index.demoProfile);

      const experiments = cachedMethods.reduce((a, m) => a + (m.experiments?.length ?? 0), 0);
      setLoadResult({
        key,
        ok: true,
        papers: hyd.length,
        experiments,
        relations: cachedRelations.length,
        message: `已加载 ${hyd.length} 篇论文、${experiments} 条实验记录、${cachedRelations.length} 条方法关系`,
        at: Date.now(),
      });
      /**
       * 记下「这份语料的预置缓存里到底有什么」。
       * 实验可比性页要靠它如实说明有没有实验记录 —— 否则会出现
       * 「重载以补齐实验记录」这种对 NLP 样例根本不可能成立的承诺（实测问题 3）。
       * 落库已在上面的同一事务里完成（用 nextStats），这里只更新内存状态。
       */
      setSampleStats(nextStats);
      log(`已加载 ${hyd.length} 篇论文、${experiments} 条实验记录、${cachedRelations.length} 条关系（语料集：${cfg.label}）`);
      log(`缓存生成信息：模型 ${index.meta.model}，提示词 ${index.meta.promptVersion}，时间 ${index.meta.generatedAt}`);
      if (index.divergences) log(`同时载入预置分歧分析：${index.divergences.findings.length} 条发现`);
      if (index.decisionSample) log(`同时载入预置示例决策：候选 ${index.decisionSample.candidates?.length ?? 0} 个`);
      log(`注意：${index.notice}`);
    } catch (e) {
      const msg = (e as Error).message;
      log(`加载语料失败：${msg}（本次写入已整体回滚，当前已有数据保持原样，可稍后重试）`);
      setLoadResult({ key, ok: false, papers: 0, experiments: 0, relations: 0, message: `加载失败：${msg}`, at: Date.now() });
    } finally {
      locks.current.corpusLoad = false;
      setCorpusLoading(null);
    }
  };

  /** 清理其它语料集的残留数据（明确动作，不做静默合并） */
  const clearForeignCorpus = async () => {
    const foreignPapers = papersRef.current.filter(
      (x) => x.corpusId && x.corpusId !== corpusIdOf(corpus) && x.corpusId !== 'user-import',
    );
    const removal = collectScopeRemoval(
      papersRef.current,
      methodsRef.current,
      relationsRef.current,
      new Set(foreignPapers.map((x) => x.id)),
    );
    /** 与 switchCorpus 同一口径：论文 / 方法 / 关系在同一事务里删，避免留下悬挂关系与部分清理 */
    try {
      await repo.applyAtomic([
        ...removal.removedRelations.map((r) => ({ store: 'relations' as const, kind: 'delete' as const, key: r.id })),
        ...removal.removedMethods.map((m) => ({ store: 'methods' as const, kind: 'delete' as const, key: m.id })),
        ...removal.removedPapers.map((p) => ({ store: 'papers' as const, kind: 'delete' as const, key: p.id })),
      ]);
    } catch (e) {
      log(`清理其它语料集失败：${(e as Error).message}（已整体回滚，可重试）`);
      try {
        const psBack = await repo.listPapers();
        const restoredBack = normalizeRestoredData(await repo.listMethods(), await repo.listRelations(), psBack);
        setPapers(psBack);
        setMethods(restoredBack.methods);
        setRelations(restoredBack.relations);
      } catch {
        /* 保持现状 */
      }
      return;
    }
    setPapers(removal.papers);
    setMethods(removal.methods);
    setRelations(removal.relations);
    log(
      `已清理其它语料集数据：${removal.removedPapers.length} 篇论文、${removal.removedMethods.length} 条方法分析、` +
        `${removal.removedRelations.length} 条关系（同一事务提交，不影响当前语料与自传论文）`,
    );
  };


  /* ---------- 抽取 ---------- */
  /** 停止等待：仅终止本地等待，不保证服务端已停止计算或不再计费 */
  const cancelExtract = (paperId: string) => {
    const h = cancelHandles.current[paperId];
    if (h) {
      h.abort();
      delete cancelHandles.current[paperId];
    }
    log('已请求停止等待：' + paperId + '（原结果保持不变；不代表服务端已停止计算或不再计费）');
  };
  /**
   * paperObj（2026-10-11）：`analyzeFiles` 在 `setPapers` 之后**立刻**调用 extract，
   * 此时闭包里的 `papers` 还是旧的（不含刚导入的论文），`papers.find` 会找不到并静默 return ——
   * 实测症状就是全部文件停在「已解析，等待提取」、进度 40% 不动。所以允许调用方把论文对象直接传进来。
   *
   * 返回值（2026-10-12）：本次是否真的抽出了方法（跳过重复 / 未配模型 / 失败都返回 undefined）。
   * 调用方据此决定「梳理完成后是否自动接一次关系分析」——没抽出新东西就不重复花模型额度。
   */
  const extract = async (paperId: string, force = false, paperObj?: Paper): Promise<Method | undefined> => {
    const paper = paperObj ?? papersRef.current.find((p) => p.id === paperId);
    if (!paper) return undefined;

    /**
     * 同篇抽取的**同步互斥**（P1）。
     *
     * 旧实现每次调用都 `cancelHandles.current[paperId] = controller` —— 第二次发起会把第一次的
     * 取消句柄**直接覆盖掉**：第一次再也取消不了，两次的结果又都会写库（后写覆盖先写）。
     * 实测触发路径：「论文集合」就地提取与「分析结果页」的重试按钮先后点同一篇。
     */
    if (locks.current.extract.has(paperId)) {
      log(`该论文已有一次抽取在进行中，本次忽略（避免重复入库与重复消耗额度）：${paper.title.slice(0, 30)}`);
      return undefined;
    }
    locks.current.extract.add(paperId);
    /**
     * 每篇论文的任务版本号：返回时版本不符 → 说明期间发生了「删除 / 重新解析 / 再次抽取」，
     * 旧响应一律作废，绝不写回孤儿方法。
     *
     * ⚠️ 2026-10-13 修掉一个**把功能整个打死**的写法：原来是 `++extractSeq.current[paperId]`。
     * 新论文第一次抽取时该键是 `undefined`，`++undefined` ⇒ **NaN**；于是
     * `stillLatest()` 里的 `NaN === NaN` 恒为 false ⇒ **每一次首次抽取都被判「已失效」丢弃**，
     * 模型明明 10 秒就返回了结果（日志里能看到「校验：字段有值 6/7…」），界面却永远停在
     * 「提取中」——这正是用户报的「提取卡住、反复点一样」。另两处（重新解析 / 移除）用的是
     * `(值 ?? 0) + 1`，一直是对的；这里必须与它们一致。
     */
    const seq = bumpSeq(extractSeq.current, paperId);
    const stillLatest = () => seqIsCurrent(extractSeq.current, paperId, seq);

    if (!modelReady) {
      const msg = '未配置模型接口：缺少 baseUrl / API Key / 模型名。抽取已取消，未产生任何替代结果。';
      log(`抽取中止：${msg}`);
      setJobs((j) => ({ ...j, [paperId]: { paperId, stage: 'extract', message: '未配置模型', status: 'failed', attempts: 0, error: msg } }));
      locks.current.extract.delete(paperId);
      return undefined;
    }

    // 若只有元数据（缓存样例）而无全文，先取回全文
    // 全文目录由 hydrateAndPersist 按论文归属的语料集选择：视觉案例在 samples-vision/text/，不是 samples/text/
    let full = paper;
    if (!full.rawText) {
      try {
        full = await hydrateAndPersist(full);
      } catch (e) {
        log(`无法取回该论文全文，抽取取消：${(e as Error).message}`);
        locks.current.extract.delete(paperId);
        return undefined;
      }
    }

    // 「已有实时结果就跳过」必须读**最新**方法表（ref），否则并发路径下会漏判
    const prev = methodsRef.current.find((m) => m.paperId === paperId);
    if (prev && !prev.cached && !force) {
      log(`该论文已有实时分析结果，跳过（如需重跑请点击重新分析）`);
      locks.current.extract.delete(paperId);
      return undefined;
    }

    const controller = new AbortController();
    cancelHandles.current[paperId] = controller;
    setJobs((j) => ({ ...j, [paperId]: { paperId, stage: 'extract', message: '准备中', status: 'running', attempts: 0, at: Date.now() } }));
    log(`开始抽取：${full.title}`);

    const t0 = Date.now();
    const extractTrace = traceRecorder();
    let produced: Method | undefined;
    try {
      const method = await extractMethodWithProgress(full, { ...config, timeoutMs: 180000, maxAttempts: 3, signal: controller.signal }, (ev) => {
        setJobs((j) => ({ ...j, [paperId]: { paperId, stage: ev.stage, message: ev.message, status: 'running', attempts: ev.trace?.attempt ?? 0 } }));
        if (ev.trace) {
          extractTrace.onTrace(ev.trace);
          log(
            `  模型调用 ${ev.trace.label} 第 ${ev.trace.attempt} 次：${ev.trace.ms}ms，输入 ${ev.trace.promptChars} 字符，输出 ${ev.trace.completionChars} 字符${
              ev.trace.error ? '，错误：' + ev.trace.error : ''
            }`,
          );
        } else if (ev.message) {
          log(`  ${ev.message}`);
        }
      });

      /**
       * === 提交校验（P1，跨 await 之后必须做）===
       *
       * 抽取是一次几十秒的网络等待。等待期间用户完全可能：
       * - 删掉这篇论文 → 旧响应写回会**复活出一个孤儿方法**（论文没了、方法还在，关系指向不存在的方法）；
       * - 重新解析（换了一份 PDF / 内容变了）→ 旧响应基于旧全文，写回等于用旧内容覆盖新内容；
       * - 再点一次抽取（版本号自增）→ 旧响应不该覆盖新任务；
       * - 保存人工修正 → 用发起前的 `prev` 合并会把等待期间新增的 overrides / userSupplemented **覆盖掉**。
       * 下面三条断言分别对应前三种情况；第四条通过「读最新的 prev」解决。
       */
      /**
       * 作废时必须**同时结束这条任务的状态**（2026-10-13 修）：
       * 旧写法只删锁 + return，job 永远停在 `running` ⇒ 文件卡永远显示「提取中：…」、
       * 步骤 03 永远「进行中」、主按钮永远「分析中…」——整页像卡死，而且**看不出是作废**。
       */
      const discard = (reason: string) => {
        log(`  抽取结果作废：${reason}`);
        setJobs((j) => ({
          ...j,
          [paperId]: { paperId, stage: 'canceled', message: '本次抽取已作废', status: 'canceled', attempts: 0, error: reason },
        }));
        locks.current.extract.delete(paperId);
        return undefined;
      };
      if (!stillLatest()) {
        return discard('期间该论文已被删除、重新解析或重新发起抽取（不写回，避免复活孤儿方法）。');
      }
      if (removedPaperIds.current.has(paperId)) {
        return discard('该论文在分析期间已被移除（不写回孤立的方法分析）。');
      }
      const paperNow = papersRef.current.find((p) => p.id === paperId);
      if (paperNow && paper.contentHash && paperNow.contentHash && paper.contentHash !== paper.contentHash) {
        return discard('该论文在分析期间已被重新解析为另一份内容，旧结果不再对应当前全文。');
      }

      const corrected = applyTitleCorrection(full, method);
      // 标题校正后重算校验（否则会同时出现「标题未确认」与「已模型校正」）
      method.validation = validateMethod(corrected, method);
      if (corrected.title !== full.title) {
        log(`  标题校正为「${corrected.title}」（模型给出且已在原文中验证）`);
        await repo.savePaper(corrected);
        setPapers((ps) => ps.map((p) => (p.id === corrected.id ? corrected : p)));
      }

      /**
       * 重新分析时保留用户的人工修正（override）与实验条件人工确认（userSupplemented），不静默覆盖。
       * ⚠️ 必须用**此刻最新**的方法记录（`methodsRef`）而不是发起请求时缓存的 `prev` ——
       * 否则等待期间用户新保存的修正会被这次合并抹掉（已复现）。
       */
      const latestPrev = methodsRef.current.find((m) => m.paperId === paperId) ?? prev;
      const mergedMethod = mergeReanalysisResult(latestPrev, method);
      await repo.saveMethod(mergedMethod);
      setMethods((ms) => [...ms.filter((m) => m.paperId !== paperId), mergedMethod]);
      produced = mergedMethod;
      if (latestPrev) {
        // 论文结果已更新：下游由模型生成的关系与推荐需要重新生成；比较页按当前数据实时重算
        invalidateTasks();
        setPendingDependents((d) => [...d.filter((x) => x.paperId !== paperId), { paperId, at: Date.now(), reason: 'reanalyze' }]);
        if (latestPrev.overrides?.length) {
          log(`  已保留该论文的 ${latestPrev.overrides.length} 条人工修正（重新分析不会覆盖人工修正）`);
        }
      }

      const verified = FIELD_KEYS_ORDER.filter((k) => method.fields[k].evidence?.verified).length;
      const missing = FIELD_KEYS_ORDER.filter((k) => method.fields[k].status === 'missing').length;
      log(`  完成：${METHOD_FIELD_LABELS.researchTask}等 ${FIELD_KEYS_ORDER.length} 个字段，证据通过定位校验 ${verified} 个，缺失 ${missing} 个`);
      setJobs((j) => ({ ...j, [paperId]: { paperId, stage: 'done', message: '完成', status: 'done', attempts: 1 } }));

      // usage 记录真实调用轨迹（不再把 prompt/completion 写成 0 或拿论文字符数顶替）
      const et = extractTrace.totals();
      await appendUsage({
        kind: 'extract',
        paperId,
        model: config.model,
        ms: et.ms || Date.now() - t0,
        promptChars: et.promptChars,
        completionChars: et.completionChars,
        ok: true,
      });
      await refreshUsage();
    } catch (e) {
      const msg = MODEL_ERROR_HINT(e);
      log(`  失败：${msg}`);
      const outcome = describeJobOutcome(e);
      setJobs((j) => ({
        ...j,
        [paperId]: {
          paperId,
          stage: outcome.status === 'canceled' ? 'canceled' : 'extract',
          message: outcome.message,
          status: outcome.status,
          attempts: 3,
          error: outcome.detail + ' 原始错误：' + msg,
        },
      }));
      log(outcome.detail + ' 原始错误：' + msg);

      const etFail = extractTrace.totals();
      await appendUsage({
        kind: 'extract',
        paperId,
        model: config.model,
        ms: etFail.ms || Date.now() - t0,
        promptChars: etFail.promptChars,
        completionChars: etFail.completionChars,
        ok: false,
        error: msg,
      });
      await refreshUsage();
    }
    // 释放同篇抽取的互斥锁（无论成功、失败还是取消都必须释放，否则这篇论文再也抽不了）
    locks.current.extract.delete(paperId);
    setTick((t) => t + 1);
    return produced;
  };

  /**
   * 就地批量提取（论文集合页用，2026-10-12 用户需求）。
   *
   * 用户原话：「论文集合里一堆未提取的，要去提取页重新放一遍文件再点提取，太麻烦」。
   * 论文已经在库里了，就该在列表上就地抽。逐篇串行（不并发，避免打爆用户自配的接口
   * —— 实测连续重试会被限流），抽出新方法后与「梳理」一样自动接一次关系分析。
   * 已经有方法框架的会被 extract 内部跳过（保留人工修正），不会重复消耗额度。
   */
  const extractMany = async (list: Paper[]) => {
    if (!modelReady) {
      log('批量提取中止：未配置模型接口。');
      return;
    }
    const todo = list.filter((p) => p.parseStatus === 'ok');
    if (!todo.length) return;
    // 批次级互斥：与 analyzeFiles 共用同一把锁，避免两条路径（提取页 / 论文集合就地提取）互相重叠
    if (locks.current.batchExtract) {
      log('已有一批提取在进行中：本次重复触发已忽略（重复点击不会加速）。');
      return;
    }
    locks.current.batchExtract = true;
    log(`开始提取 ${todo.length} 篇论文的方法字段（逐篇串行）…`);
    let extracted = 0;
    try {
      for (const p of todo) {
        const m = await extract(p.id, false, p);
        if (m) extracted += 1;
      }
    } finally {
      // 与 analyzeFiles 同样的纪律：任何路径退出都要解锁，否则这一页再也提取不了
      locks.current.batchExtract = false;
    }
    log(`批量提取结束：本次抽出 ${extracted} 篇，${todo.length - extracted} 篇跳过或失败（失败原因见各自的状态与日志）。`);
    if (extracted > 0) setRelationsAutoTick((t) => t + 1);
  };

  /**
   * 实验可比性审查页的人工操作（2026-10-13 语义收紧）。
   *
   * 三种动作分得很清楚，因为它们的**可信度完全不同**：
   *
   * - `set`：人工**补充一个具体值**（必须带来源）。这是「人工声明」，不是原文核验：
   *   原 AI 值存进 `originalValue` 供并列展示，状态在页面上标为「人工补充（未核验）」。
   *   只有它能让一个「未知」条件变成已知。
   * - `clear`：撤销人工补充，回到 AI 原值。
   * - `toggle-checked`：只标记「我已核对过这一项」，**不提供任何值、不参与任何判断**。
   *   过去这个勾选被当成「该条件已知」，于是点一下就能把未知字段变成已知（已复现），
   *   而比较引擎仍在读未知原值 —— 页面与引擎结论相反。现在它只是界面标注。
   *
   * ⚠️ 定位同时校验 `paperId` 与 `expId`：旧实现按 `expId` 在全部方法里搜索，
   * 一旦不同论文的方法出现同 id（历史数据里就有按序号生成的 `x_<paper>_<n>`），
   * 就可能把补充写到**另一篇论文**的记录上。
   */
  const supplementExperimentCondition = async (args: {
    paperId: string;
    expId: string;
    dim: string;
    action: 'set' | 'clear' | 'toggle-checked';
    value?: string;
    source?: string;
    quote?: string;
    checked?: boolean;
  }): Promise<{ ok: boolean; error?: string }> => {
    const { paperId, expId, dim, action } = args;
    // 定位必须同时命中论文与方法记录
    const method = methodsRef.current.find((m) => m.paperId === paperId);
    if (!method) return { ok: false, error: '找不到这篇论文的分析结果，请先在论文集合里完成方法提取。' };
    if (!(method.experiments ?? []).some((e) => e.id === expId)) {
      return { ok: false, error: '该实验记录已不存在（可能被重新分析替换），请刷新后重试。' };
    }

    if (action === 'set') {
      const value = (args.value ?? '').trim();
      const source = (args.source ?? '').trim();
      // 铁律：单纯「我核对过」不能把未知值变成已知 —— 必须给出具体值与来源
      if (!value) return { ok: false, error: '请填写具体值：只勾选「我核对过」不能把未知条件变成已知。' };
      if (!source) return { ok: false, error: '请填写来源（例如「论文 Table 3 第 2 行」），否则该值无法追溯。' };
    }

    const experiments = (method.experiments ?? []).map((e) => {
      if (e.id !== expId) return e;
      if (action === 'toggle-checked') {
        const cur = e.userSupplemented ?? [];
        const next = args.checked ? [...new Set([...cur, dim])] : cur.filter((d) => d !== dim);
        return { ...e, userSupplemented: next };
      }
      if (action === 'clear') {
        return { ...e, supplements: (e.supplements ?? []).filter((s) => s.dimension !== dim) };
      }
      // set：同维度只保留最新一条（覆盖写），并在其中保留当时的 AI 原值供对照
      const value = (args.value ?? '').trim();
      const source = (args.source ?? '').trim();
      const quote = (args.quote ?? '').trim();
      const paper = papersRef.current.find((p) => p.id === paperId);
      const evidence = quote && paper?.rawText ? buildEvidence(paper, { quote }) : undefined;
      const kept = (e.supplements ?? []).filter((s) => s.dimension !== dim);
      /**
       * AI 原值只在**第一次**补充时记录，之后反复修改都沿用同一份 ——
       * 否则第二次修改会把「上一次的人工值」当成 AI 原值，追溯链就断了。
       */
      const existing = (e.supplements ?? []).find((s) => s.dimension === dim);
      const originalValue = existing?.originalValue ?? String((e as unknown as Record<string, unknown>)[dim] ?? '');
      return {
        ...e,
        supplements: [
          ...kept,
          {
            dimension: dim,
            value,
            originalValue,
            source,
            at: Date.now(),
            quote: quote || undefined,
            evidence,
            note: '人工补充值：来自用户填写，不是原文核验结果；请以来源为准自行核对。',
          },
        ],
      };
    });
    const nextMethod: Method = { ...method, experiments };
    try {
      await repo.saveMethod(nextMethod);
    } catch (e) {
      return { ok: false, error: `保存失败：${(e as Error).message}（本机数据未改变，可重试）` };
    }
    setMethods((ms) => ms.map((m) => (m.id === nextMethod.id ? nextMethod : m)));
    if (action === 'set') {
      log(`已人工补充一条实验条件（${dim}）：值「${(args.value ?? '').slice(0, 40)}」，来源「${(args.source ?? '').slice(0, 40)}」（人工声明，非原文核验）。`);
    } else if (action === 'clear') {
      log('已撤销该项人工补充，恢复 AI 原值。');
    } else {
      log(args.checked ? '已标记「我已核对过该项」（该标记不参与判定）。' : '已取消该项的核对标记。');
    }
    return { ok: true };
  };

  const overrideField = async (paperId: string, field: FieldKey, value: string) => {
    const m = methods.find((x) => x.paperId === paperId);
    if (!m) return;
    // previousValue 记的是**有效值**（可能是上一次人工修正），保证修正记录可回溯
    const previousEffective = effectiveField(m, field).value;
    const next: Method = {
      ...m,
      overrides: [
        ...m.overrides.filter((o) => o.field !== field),
        { field, previousValue: previousEffective, newValue: value, at: Date.now() },
      ],
    };
    await repo.saveMethod(next);
    setMethods((ms) => ms.map((x) => (x.paperId === paperId ? next : x)));
    /**
     * 人工修正会改变下游分析所依据的有效值，且是在途模型任务的「旧输入」：
     * 1. 让在途任务的结果作废（不覆盖人工修正后的状态）；
     * 2. 把关系 / 路线 / 比较 / 分歧标为待重算。
     */
    invalidateTasks();
    setPendingDependents((d) => [
      ...d.filter((x) => x.paperId !== paperId),
      { paperId, at: Date.now(), reason: 'override', fields: overriddenFieldLabels(next) },
    ]);
    log(
      `人工修正：${METHOD_FIELD_LABELS[field]} 已更新为有效值「${value.slice(0, 40)}」（AI 原值已保留在修正记录中）。` +
        '该值不是原文核验结果，关系/阅读路线/比较与分歧需要重新生成或复核。',
    );
  };

  /** 当前分析范围的人类可读名字（日志与提示里必须写清楚这次分析看的是哪个集合） */
  const scopeLabel = scope.mode === 'own' ? '我上传的论文' : scope.meta.label;

  /**
   * 按需取回全文并**落盘**（P2）。
   *
   * 过去的三种取全文路径（抽取前补全文 / 关系分析前批量补全文 / 点证据看上下文）里，
   * 有一处只更新了内存（`setPapers`）而没有 `repo.savePaper`：刷新后全文又没了，
   * 于是同一篇论文被反复下载；离线（本地缓存模式）时上下文也就丢了。
   *
   * 现在统一走这里，并把「取回失败」与「落盘失败」分开：
   * - 取回失败 → 抛给调用方（调用方决定是取消任务还是继续）；
   * - 落盘失败 → **不当作取回失败**：内存里已经有全文，当前会话可以继续用，
   *   只是明确告诉用户「刷新后需要重新取回」，不撒谎说已缓存。
   */
  const hydrateAndPersist = async (paper: Paper): Promise<Paper> => {
    const t = await loadPaperText(paper.id, corpusBaseOfPaper(paper.corpusId));
    const full = hydratePaper(paper, t);
    setPapers((ps) => ps.map((p) => (p.id === full.id ? full : p)));
    try {
      await repo.savePaper(full);
    } catch (e) {
      log(
        `全文已取回并在本页可用，但写入本机存储失败：${(e as Error).message}（刷新后需要重新取回；不影响本次会话）`,
      );
    }
    return full;
  };

  /**
   * 按语料集批量取回当前分析范围的全文。
   *
   * 为什么必须做：关系判定只对**有全文**的论文有效，而全文是按需加载的。
   * 过去直接过滤出有 rawText 的论文 —— 用户没有逐篇点开证据时，可分析集合会悄悄缩水，
   * 甚至直接中止，界面却没有任何说明。现在先按 corpusId 选对目录补齐全文，并把加载状态显示出来。
   */
  const hydrateScopePapers = async (): Promise<{ papers: Paper[]; hydrated: number; failed: string[] }> => {
    const failed: string[] = [];
    let hydrated = 0;
    const missing = scope.papers.filter((p) => !p.rawText);
    if (!missing.length) return { papers: scope.papers, hydrated: 0, failed };
    setHydratingScope(true);
    log(`按语料集取回全文：${missing.length} 篇（目录 ${corpusBaseOfPaper(missing[0].corpusId)}）…`);
    const byId = new Map(scope.papers.map((p) => [p.id, p]));
    try {
      for (const p of missing) {
        try {
          // 统一走 hydrateAndPersist：取回成功后必须落盘（否则刷新又得重新下载）；
          // 落盘失败不当作取回失败，只在日志里如实说明（见该函数的注释）
          const full = await hydrateAndPersist(p);
          byId.set(p.id, full);
          hydrated += 1;
        } catch (e) {
          failed.push(`${p.title.slice(0, 24)}：${(e as Error).message}`);
          log(`  全文取回失败：${p.title.slice(0, 30)} —— ${(e as Error).message}`);
        }
      }
    } finally {
      setHydratingScope(false);
    }
    const list = scope.papers.map((p) => byId.get(p.id) ?? p);
    log(`全文取回完成：成功 ${hydrated} 篇${failed.length ? `，失败 ${failed.length} 篇` : ''}。`);
    return { papers: list, hydrated, failed };
  };

  /* ---------- 关系与路线 ---------- */
  const genRelations = async () => {
    if (!modelReady) {
      log('关系分析中止：未配置模型接口。');
      return;
    }
    // 同步锁：state 判断在双击时两次调用都读到 false，会重复发起同一任务并重复消耗额度
    if (locks.current.relations) {
      log('关系分析已在进行中，已忽略本次请求。');
      return;
    }
    locks.current.relations = true;
    setRelationBusy(true);
    const task = beginTask('relations');
    const trace = traceRecorder();
    try {
      // 先把当前范围的全文补齐（按 corpusId 选目录），再据此决定可分析集合
      const { papers: scopePapers, failed } = await hydrateScopePapers();
      if (!task.isLatest()) {
        log('关系分析：期间集合或数据已变化，本次结果作废（不覆盖当前关系）。');
        return;
      }
      // 只在**当前分析范围**内取材：案例模式 = 当前案例预置；我上传模式 = 我自己上传的论文。
      // 不把全量 papers / methods 送给模型。
      const paperById = new Map(scopePapers.map((p) => [p.id, p]));
      const usable = scope.methods.map((m) => {
        const p = paperById.get(m.paperId);
        return p && p.rawText ? { m, p } : undefined;
      });
      const ready = usable.filter(Boolean) as { m: Method; p: Paper }[];
      if (ready.length < 2) {
        log(
          `关系分析中止：当前集合「${scopeLabel}」里只有 ${ready.length} 篇有全文的论文（需要至少 2 篇）。` +
            (failed.length ? `另有 ${failed.length} 篇全文取回失败：${failed.join('；')}` : ''),
        );
        return;
      }
      log(`分析方法关系（${ready.length} 篇有全文，范围：${scopeLabel}）…`);
      const { relations: rels, issues } = await inferRelations(
        ready.map((x) => x.p),
        ready.map((x) => x.m),
        { ...config, timeoutMs: 180000, signal: task.signal },
        (t) => {
          trace.onTrace(t);
          log(`  模型调用 ${t.label}：${t.ms}ms${t.error ? '，错误：' + t.error : ''}`);
        },
      );
      if (!task.isLatest()) {
        log('关系分析：结果返回时集合、论文或人工修正已变化，本次结果已丢弃（不覆盖当前关系）。');
        return;
      }
      /**
       * 按范围替换关系（不再 repo.clearRelations 整库清空）：
       * 只替换两端都属于当前范围的关系，其它案例、用户上传论文、人工添加/修正的关系原样保留。
       * 写库用 `swap.write`（已剔除与人工关系撞 ID 的模型结果），且写入与删除在**同一个事务**里完成。
       */
      const swap = replaceRelationsInScope(relations, rels, scope.scopeMethodIds);
      await repo.swapRelations(swap.write, swap.deleteIds);
      setRelations(swap.next);
      const cnt = (s: string) => rels.filter((r) => r.evidenceState === s).length;
      log(
        `  完成：${rels.length} 条关系（原文明示 ${cnt('explicit')}，系统推断 ${cnt('inferred')}，待核查 ${cnt('candidate')}）；程序校验问题 ${issues.length} 条；` +
          `已保留范围外关系 ${swap.keep.length} 条`,
      );
      for (const i of issues) log(`    · ${i.message}`);
      const tot = trace.totals();
      await appendUsage({
        kind: 'relations',
        model: config.model,
        ms: tot.ms,
        promptChars: tot.promptChars,
        completionChars: tot.completionChars,
        ok: true,
      });
      await refreshUsage();
    } catch (e) {
      log(`关系分析失败：${MODEL_ERROR_HINT(e)}（原有关系保持不变）`);
      const tot = trace.totals();
      await appendUsage({
        kind: 'relations',
        model: config.model,
        ms: tot.ms,
        promptChars: tot.promptChars,
        completionChars: tot.completionChars,
        ok: false,
        error: String((e as Error).message).slice(0, 200),
      });
      await refreshUsage();
    } finally {
      endTask('relations');
      locks.current.relations = false;
      setRelationBusy(false);
    }
  };

  /**
   * 梳理（批量分析 / 失败重试）抽出新方法后，自动接一次关系分析。
   *
   * 为什么必须经 effect：analyzeFiles 与 retryExtract 的闭包捕获的是**抽取前**的
   * papers/methods/relations，直接调 genRelations 会读到空范围而静默中止
   * （日志只会说「只有 0 篇有全文的论文」）。effect 在最新提交之后运行，
   * genRelations 拿到的是当前范围。400ms 防抖把一次批量里的多次触发合并成一次调用；
   * 期间用户若切换语料/增删论文，任务版本保护会丢弃过期结果，不会写错数据。
   *
   * 撞上「已有一次关系分析在跑」时不静默跳过：把触发器重新排队，等这次结束后再跑 ——
   * 否则连续两批上传时，第一批的结果被第二批的导入作废、第二批又被 busy 挡掉，
   * 最终一条关系都不剩（正是用户实测报的症状）。
   */
  useEffect(() => {
    if (relationsAutoTick === 0) return;
    const timer = window.setTimeout(() => {
      if (relationBusyRef.current) {
        setRelationsAutoTick((t) => t + 1);
        return;
      }
      log('字段抽取完成，自动接着推断方法关系…');
      void genRelations();
    }, 400);
    return () => window.clearTimeout(timer);
    // genRelations 每次渲染都是新闭包，这里刻意只依赖触发器：effect 运行时它一定是最新的
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relationsAutoTick]);

  /* ---------- 方法决策 ---------- */
  const genDecision = async (profile: UserProfile) => {
    if (!modelReady) {
      log('方法决策中止：未配置模型接口。');
      return;
    }
    // 只吃当前分析范围（案例 = 当前案例预置；我上传 = 我上传的论文）
    const ready = scope.methods.filter((m) => scope.papers.some((p) => p.id === m.paperId));
    if (!ready.length) {
      log(`方法决策中止：当前集合「${scopeLabel}」里没有可用的论文分析结果。`);
      return;
    }
    // 同步锁：见 genRelations 的说明
    if (locks.current.plan) {
      log('方法决策已在进行中，已忽略本次点击。');
      return;
    }
    locks.current.plan = true;
    setPlanBusy(true);
    const task = beginTask('plan');
    const trace = traceRecorder();
    log(`生成方法决策（范围：${scopeLabel}；条件：${profile.compute || '未填写'} / ${profile.time || '未填写'}）…`);
    try {
      const p = await generateDecision(scope.papers, ready, profile, { ...config, timeoutMs: 180000, signal: task.signal }, (t) => {
        trace.onTrace(t);
        log(`  模型调用 ${t.label}：${t.ms}ms${t.error ? '，错误：' + t.error : ''}`);
      });
      if (!task.isLatest()) {
        log('方法决策：结果返回时集合、论文或人工修正已变化，本次结果已丢弃（不覆盖当前路线）。');
        return;
      }
      setPlan(p);
      // 实时生成的路线必须落盘，刷新页面仍能看到（并按语料集隔离）
      await saveMeta('decision', asScopedSnapshot(scopeKey, CORPUS_META[corpus].id, p, scope.papers.length));
      log(`  完成：候选 ${p.candidates?.length ?? 0} 个，阅读顺序 ${p.steps.length} 步（已保存到本机，刷新后仍在）`);
      if (p.conditionSensitivity) log(`  条件敏感性：${p.conditionSensitivity}`);
      const tot = trace.totals();
      await appendUsage({
        kind: 'plan',
        model: config.model,
        ms: tot.ms,
        promptChars: tot.promptChars,
        completionChars: tot.completionChars,
        ok: true,
      });
      await refreshUsage();
    } catch (e) {
      log(`方法决策失败：${MODEL_ERROR_HINT(e)}`);
      const tot = trace.totals();
      await appendUsage({
        kind: 'plan',
        model: config.model,
        ms: tot.ms,
        promptChars: tot.promptChars,
        completionChars: tot.completionChars,
        ok: false,
        error: String((e as Error).message).slice(0, 200),
      });
      await refreshUsage();
    } finally {
      endTask('plan');
      locks.current.plan = false;
      setPlanBusy(false);
    }
  };

  /* ---------- 分歧分析 ---------- */
  const genDivergence = async () => {
    if (!modelReady) {
      log('分歧分析中止：未配置模型接口。');
      return;
    }
    // 只吃当前分析范围（案例 = 当前案例预置；我上传 = 我上传的论文）
    const ready = scope.methods.filter((m) => scope.papers.some((p) => p.id === m.paperId));
    if (ready.length < 2) {
      log(`分歧分析中止：当前集合「${scopeLabel}」里需要至少 2 篇已完成抽取的论文。`);
      return;
    }
    // 同步锁：见 genRelations 的说明
    if (locks.current.divergence) {
      log('分歧分析已在进行中，已忽略本次点击。');
      return;
    }
    locks.current.divergence = true;
    setDivergenceBusy(true);
    const task = beginTask('divergence');
    const trace = traceRecorder();
    log(`分析跨论文分歧（${ready.length} 篇，范围：${scopeLabel}）…`);
    try {
      const rep = await findDivergences(scope.papers, ready, { ...config, timeoutMs: 180000, signal: task.signal }, (t) => {
        trace.onTrace(t);
        log(`  模型调用 ${t.label}：${t.ms}ms${t.error ? '，错误：' + t.error : ''}`);
      });
      if (!task.isLatest()) {
        log('分歧分析：结果返回时集合、论文或人工修正已变化，本次结果已丢弃（不覆盖当前分歧）。');
        return;
      }
      setDivergence(rep);
      await saveMeta('divergence', asScopedSnapshot(scopeKey, CORPUS_META[corpus].id, rep, scope.papers.length));
      for (const f of rep.findings) {
        log(`  · [${DIVERGENCE_LABELS[f.kind]}] ${f.topic}（可比性 ${f.comparabilityLevel}）`);
      }
      const tot = trace.totals();
      await appendUsage({
        kind: 'divergence',
        model: config.model,
        ms: tot.ms,
        promptChars: tot.promptChars,
        completionChars: tot.completionChars,
        ok: true,
      });
      await refreshUsage();
    } catch (e) {
      log(`分歧分析失败：${MODEL_ERROR_HINT(e)}`);
      const tot = trace.totals();
      await appendUsage({
        kind: 'divergence',
        model: config.model,
        ms: tot.ms,
        promptChars: tot.promptChars,
        completionChars: tot.completionChars,
        ok: false,
        error: String((e as Error).message).slice(0, 200),
      });
      await refreshUsage();
    } finally {
      endTask('divergence');
      locks.current.divergence = false;
      setDivergenceBusy(false);
    }
  };

  /* ---------- 设置 ---------- */
  const saveConfig = async (c: ModelConfig) => {
    /**
     * 配置日志脱敏（P2）：
     * - 旧实现打印**完整 baseUrl**。如果用户把 token 写在 query 里（`?api_key=xxx&api-version=...`），
     *   日志、截图与「导出诊断信息」都会把密钥带出去。
     * - 现在：URL 里带凭据（userinfo 或敏感 query 参数）**直接拒绝保存**并给出可操作提示；
     *   日志只打印脱敏后的地址。
     */
    try {
      assertNoUrlCredentials(c.baseUrl);
    } catch (e) {
      log(`模型设置未保存：${describeModelError(e)}（请把密钥填到 API Key 一栏，不要写在 URL 里）`);
      return;
    }
    setConfig(c);
    await saveMeta('modelConfig', c);
    log(`模型设置已保存到本机（${redactUrl(c.baseUrl)} / ${c.model}）。密钥只存本机、不写入任何导出文件。`);
  };

  const testConnection = async (c: ModelConfig) => {
    setTesting(true);
    setTestResult(undefined);
    try {
      const r = await chat({
        ...c,
        messages: [
          { role: 'system', content: '你是连通性测试助手。' },
          { role: 'user', content: '请只回复两个字：可用' },
        ],
        maxTokens: 16,
        timeoutMs: 30000,
        maxAttempts: 1,
      });
      setTestResult({ ok: true, text: r.text.trim().slice(0, 40) });
      log(`连接测试成功：${r.trace.ms}ms`);
    } catch (e) {
      setTestResult({ ok: false, text: MODEL_ERROR_HINT(e) });
      log(`连接测试失败：${MODEL_ERROR_HINT(e)}`);
    } finally {
      setTesting(false);
    }
  };

  /* ---------- 证据打开：确保对应论文全文已加载 ---------- */
  const openEvidence = async (e: Evidence, label: string, paper?: Paper) => {
    let target = paper ?? papersRef.current.find((p) => p.id === e.paperId);
    if (target && !target.rawText) {
      try {
        // 这里过去**只更新内存**：刷新后全文又没了，同一篇论文被反复下载；离线时上下文直接丢。
        // 统一走 hydrateAndPersist（取回 + 落盘，落盘失败只用日志如实说明）。
        target = await hydrateAndPersist(target);
      } catch (err) {
        log(`证据上下文加载失败：${(err as Error).message}`);
      }
    }
    setEvidence({ e, label, paper: target });
  };

  const capabilities = useMemo(
    () =>
      capabilitiesList({
        hasBackend: false,
        deployStatic: true,
        // 只有本机连接测试真的成功过才算「已连通」；填写完整只算「已配置」
        modelReachable: testResult?.ok === true,
        modelConfigured: modelReady,
      }),
    [testResult, modelReady],
  );

  return (
    <div className="app">
      {/* 「重新选择 PDF」用的隐藏文件选择器：解析失败后由用户重新选一次文件，再真正重跑 PDF 解析 */}
      <input
        ref={reparseInputRef}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => void onReparseFilePicked(e.target.files)}
      />
      <AppBrandBar
        corpusLabel={scope.meta.label}
        fontsReady={fontsReady}
        minimal={tab === 'landing'}
        active={tab}
        onHome={() => setTab('landing')}
        onGo={goTab}
        onBack={() => {
          const back = BACK_OF[tab];
          if (back) setTab(back[1]);
        }}
        backLabel={BACK_OF[tab]?.[0]}
      />

      <div className={`app-body${tab === 'map' ? ' mapbody' : ''}`}>
        {/* 默认不显示侧栏：页面切换走顶部「目录」浮层 */}

        <main className={`main${tab === 'landing' ? ' plain' : ''}${tab === 'map' ? ' mapmain' : ''}${tab === 'upload' ? ' uploadmain' : ''}${tab === 'result' ? ' resultmain' : ''}${tab === 'map' ? ' netmapmain' : ''}${tab === 'library' ? ' libmain' : ''}${tab === 'compare' ? ' cmpmain' : ''}${tab === 'decision' ? ' decmain' : ''}${tab === 'divergence' ? ' dvmain' : ''}`}>
          <div className="main-inner">
          {/*
            初始化失败必须显式说出来（P1）：本机明明有数据、界面却显示「0 篇论文」，
            最容易被误读成「数据丢了」。这里给出真实原因 + 重试入口，不自动清理任何内容。
          */}
          {initState === 'error' && (
            <Banner kind="warn">
              <strong>本机数据恢复失败：</strong>
              {initError || '未知错误'}
              <div style={{ marginTop: 6 }}>
                你已有的数据仍在浏览器本机存储里（本次不会自动清理任何内容）。可点「重试恢复」再试一次；
                若反复失败，请检查浏览器是否禁用了本机存储（隐私模式 / 站点数据被拦截）。
              </div>
              <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setInitRetry((n) => n + 1)}>
                重试恢复
              </button>
            </Banner>
          )}
          {pendingDependents.length > 0 && (
            <Banner kind="warn">
              <strong>
                {pendingDependents.some((d) => d.reason === 'override')
                  ? '有论文的字段被人工修正（或结果已更新），以下内容需要重新生成或复核：'
                  : '有论文的结果已更新，以下内容需要重新生成或复核：'}
              </strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {(pendingDependents.some((d) => d.reason === 'override')
                  ? describeOverrideDependents(
                      pendingDependents
                        .map((d) => papers.find((p) => p.id === d.paperId)?.title?.slice(0, 30) ?? d.paperId)
                        .join('、'),
                      [...new Set(pendingDependents.flatMap((d) => d.fields ?? []))],
                    )
                  : describeDependents(
                      pendingDependents
                        .map((d) => papers.find((p) => p.id === d.paperId)?.title?.slice(0, 30) ?? d.paperId)
                        .join('、'),
                    )
                ).map((x, i) => (
                  <li key={i}>
                    <strong>{x.item}</strong>：{x.action}
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 6 }}>本提示不会自动改动任何结果；请按需重新生成，或确认现有结论仍然成立。</div>
              <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setPendingDependents([])}>
                我已复核，隐藏提示
              </button>
            </Banner>
          )}
          {tab === 'landing' && (
            <LandingView
              onExperienceCase={async () => {
                /**
                 * 主按钮「体验视觉论文案例」= 真实用户路径：加载案例 → **直接进研究地图**。
                 * 落在「论文集合」会先给一屏论文清单，与按钮承诺的「把一组论文变成研究地图」不符，
                 * 且该页通往地图的入口不易发现。
                 */
                if (scope.experimentCount === 0) await loadSample(corpus);
                goTab('map');
              }}
              onUploadOwn={() => setTab('upload')}
              onGo={async (t) => {
                /**
                 * 首页概念卡片：「打开研究地图 / 查看阅读路线」在案例未加载时会落进空态（0 篇论文），
                 * 所以先加载案例再切页。
                 *
                 * 注意这里**不含 'library'**：卡片语义是「去那一页看看」，论文集合这一页自己有
                 * 「加载演示案例」入口；而且把「打开论文集合」变成「顺带加载案例」会让
                 * 「进入工作区」这类按文案兜底的走查脚本拿到一个已经载入预置案例的页面，
                 * 从而误判「鉴权失败后出现了已核验字段」（见 scripts/auth-error-check.mjs）。
                 */
                if ((t === 'map' || t === 'decision') && scope.experimentCount === 0) {
                  await loadSample(corpus);
                }
                goTab(t);
              }}
            />
          )}

          {tab === 'map' && (
            <MapView
              papers={scope.papers}
              methods={scope.methods}
              relations={scopedRelations}
              scope={scope}
              corpusLoading={corpusLoading}
              plan={plan}
              modelReady={modelReady}
              onOpenResult={(paperId) => {
                setResultPaperId(paperId);
                setTab('result');
              }}
              mode={mapMode}
              onModeChange={setMapMode}
              /* 关系分析入口：地图空状态与「关系与比较」页直接可点（2026-10-12 用户实测：
                 此前只有目录里的「方法关系图」页有按钮，地图上看到没有关系时没有任何下一步） */
              onAnalyzeRelations={genRelations}
              relationBusy={relationBusy}
              onGoSettings={() => setTab('settings')}
              /* 动线（2026-10-12）：研究地图的两个大入口 —— 跨论文比较 / 阅读路线（完整页面，可从顶栏返回） */
              onGoCompare={() => setTab('compare')}
              /* 关系明细整表已搬到「方法关系」页：地图上的「关系明细与依据」直接去那一页 */
              onGoGraph={() => setTab('graph')}
              onGoDecision={() => setTab('decision')}
              /* 待调查问题：原本只藏在「更多」里，2026-10-13 用户实测在地图上找不到入口 */
              onGoDivergence={() => setTab('divergence')}
              onOpenEvidence={(ev) => openEvidence(ev, '原文依据', papers.find((x) => x.id === ev.paperId))}
              onAddPapers={() => setTab('upload')}
              onGoLibrary={() => setTab('library')}
              onSwitchCase={async () => {
                await switchCorpus(corpus === 'vision' ? 'nlp-dev' : 'vision');
              }}
              onReloadCase={() => loadSample(corpus)}
              resetSignal={mapResetSeq}
            />
          )}

          {tab === 'upload' && (
            <UploadFlowView
              papers={papers}
              scope={scope}
              methods={methods}
              jobs={jobs}
              queue={uploadQueue}
              setQueue={setUploadQueue}
              phase={uploadPhase}
              setPhase={setUploadPhase}
              lastImportedId={lastImportedId}
              /* 横幅按钮承诺「查看我上传的 N 篇论文」→ 必须跳到论文集合页：上传页不显示论文列表，
                 只切范围不跳页的话，用户看到的就是横幅消失、什么都没发生（2026-10-12 用户实测） */
              onUseOwnScope={() => {
                setMapMode('own');
                setTab('library');
              }}
              onUseCaseScope={() => setMapMode('case')}
              modelReady={modelReady}
              config={config}
              onSaveConfig={async (c) => {
                await saveConfig(c);
              }}
              onTest={testConnection}
              testing={testing}
              testResult={testResult ? `${testResult.ok ? '连接成功' : '连接失败'}：${testResult.text}` : undefined}
              /* 草稿的前端逻辑：先攒文件 → 点「开始梳理脉络」一次性分析（解析 + 抽取） */
              onAnalyze={analyzeFiles}
              onPaste={importPaste}
              /* 动线（2026-10-12）：方法提取 → 论文集合 → 研究地图 */
              onGoNext={() => setTab('library')}
              /* 本轮分析结束但没有生成方法框架时的重试出口（逐篇重跑提取，不重新解析）。
                 重试抽出新方法后同样自动接一次关系分析（与批量路径一致）。 */
              onExtract={async (paperId: string, force = false) => {
                const m = await extract(paperId, force);
                if (m) setRelationsAutoTick((t) => t + 1);
                return m;
              }}
              relationBusy={relationBusy}
              relationCount={scopedRelations.length}
              onOpenPaper={(paperId) => {
                setExpFocus(paperId);
                setTab('library');
              }}
              /* 页脚的真实导航：草稿页脚指向的「使用指南 / 法律条款」在本项目里并不存在 */
              onGo={(t) => setTab(t as Tab)}
            />
          )}

          {tab === 'more' && (
            <MoreView
              scope={scope}
              corpus={corpus}
              onGo={(t) => setTab(t as Tab)}
              onSwitchCorpus={switchCorpus}
              modelReady={modelReady}
              counts={{
                papers: scope.paperCount,
                experiments: scope.experimentCount,
                relations: scopedRelations.length,
                expConfirmed: scope.presetMethods
                  .flatMap((m) => m.experiments ?? [])
                  .filter((e) => e.verification?.rowColConfirmed).length,
              }}
            />
          )}

          {tab === 'home' && (
            <HomeView
              corpus={corpus}
              onSwitchCorpus={switchCorpus}
              onLoadSample={() => loadSample(corpus)}
              papers={papers}
              methods={methods}
              scope={scope}
              corpusLoading={corpusLoading}
              loadResult={loadResult}
              modelReady={modelReady}
              onGo={(t) => setTab(t)}
              onOpenSettings={() => setTab('settings')}
            />
          )}

          {tab === 'experiments' && (
            <ExperimentsView
              /* 统一用**当前范围**的论文与方法：这一页的结论、计数与导出都只对应当前范围 */
              papers={scope.papers}
              methods={scope.methods}
              onOpenEvidence={(ev) => openEvidence(ev, ev.quote?.slice(0, 40) ?? '证据')}
              onGo={(t) => setTab(t)}
              onLoadSample={() => loadSample(corpus)}
              scope={scope}
              scopeKey={scopeKey}
              corpusLoading={corpusLoading}
              loadResult={loadResult}
              focusPaper={expFocus}
              cacheStats={sampleStats[corpus] ?? null}
              visionStats={sampleStats.vision ?? null}
              onSwitchToVision={() => void switchCorpus('vision')}
              onSupplementCondition={supplementExperimentCondition}
            />
          )}

          {/*
            分析结果页（草稿 f3570956）：从论文集合点某篇「查看分析结果」进来。
            目标论文被删除 / 不可用时**不能**整页空白 —— 给出明确说明与恢复入口（P2）。
          */}
          {tab === 'result' && !(resultPaperId && papers.some((p) => p.id === resultPaperId)) && (
            <div className="panel" style={{ padding: 20 }}>
              <h3 style={{ marginTop: 0 }}>还没有可显示的分析结果</h3>
              <p style={{ color: 'var(--ink-2)' }}>
                {resultPaperId
                  ? '原本要查看的这篇论文已不在本机数据里（可能被移除或换了语料集范围）。'
                  : '请先从论文集合里选一篇论文，点「查看分析结果」。'}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <button className="btn sm" onClick={() => setTab('library')}>
                  去论文集合选择
                </button>
                <button
                  className="btn ghost sm"
                  onClick={() => {
                    setResultPaperId(null);
                    setTab('map');
                  }}
                >
                  返回研究地图
                </button>
              </div>
            </div>
          )}
          {tab === 'result' && resultPaperId && papers.some((p) => p.id === resultPaperId) && (
            <ResultPageView
              paper={papers.find((p) => p.id === resultPaperId)!}
              method={methods.find((m) => m.paperId === resultPaperId)}
              papers={papers}
              methods={methods}
              onBack={() => setTab('library')}
              onGoMap={() => setTab('map')}
              onGoCompare={() => setTab('compare')}
              onGoUpload={() => setTab('upload')}
              onOpenEvidence={(ev) => openEvidence(ev, '原文依据', papers.find((x) => x.id === ev.paperId))}
              /* ↓ 按篇操作：论文集合改成表格后，这些功能从展开行迁到分析结果页 */
              job={resultPaperId ? jobs[resultPaperId] : undefined}
              modelReady={modelReady}
              onExtract={extract}
              onReparse={reparsePaper}
              canReparseInPlace={canReparseInPlace}
              onCancel={cancelExtract}
              onOverride={overrideField}
              onRemove={removePaper}
            />
          )}
          {tab === 'library' && (
            <LibraryView
              scope={scope}
              corpusLoading={corpusLoading}
              loadResult={loadResult}
              onClearForeign={clearForeignCorpus}
              onOpenSettings={() => setTab('settings')}
              onGoMap={() => setTab('map')}
              onGoHome={() => setTab('landing')}
              onGoExperiments={() => {
                setExpFocus(null);
                setTab('experiments');
              }}
              onOpenExperiments={(paperId) => {
                setExpFocus(paperId);
                setTab('experiments');
              }}
              onOpenResult={(paperId) => {
                setResultPaperId(paperId);
                setTab('result');
              }}
              onGoGraph={() => setTab('graph')}
              onGoCompare={() => setTab('compare')}
              onGoDecision={() => setTab('decision')}
              papers={papers}
              methods={methods}
              relations={scopedRelations}
              jobs={jobs}
              modelReady={modelReady}
              lastImportedId={lastImportedId}
              onReparse={reparsePaper}
              canReparseInPlace={canReparseInPlace}
              onImport={importFiles}
              onPaste={importPaste}
              onExtract={extract}
              /* 就地批量提取：论文已经在库里，不必回提取页重新加一遍文件（2026-10-12 用户需求） */
              onExtractMany={extractMany}
              onCancel={cancelExtract}
              onRemove={removePaper}
              onRestore={restorePaper}
              onOverride={overrideField}
              onOpenEvidence={openEvidence}
              onLoadSample={loadSample}
              corpus={corpus}
              corpusLabel={corpusConfig(corpus).label}
              onSwitchCorpus={switchCorpus}
              otherCorpusCount={papers.filter((p) => p.cached && (p.corpusId ?? 'nlp-dev') !== corpusConfig(corpus).id).length}
              logLines={logLines}
              staleNotes={staleNotes}
            />
          )}

          {tab === 'compare' && (
            <CompareView
              papers={scope.papers}
              methods={scope.methods}
              relations={scopedRelations}
              selected={selected}
              onSelectedChange={setSelected}
              onToggle={(paperId) =>
                setSelected((prev) => (prev.includes(paperId) ? prev.filter((x) => x !== paperId) : [...prev, paperId]))
              }
              onOpenEvidence={openEvidence}
            />
          )}

          {tab === 'graph' && (
            <GraphView
              papers={scope.papers}
              methods={scope.methods}
              relations={scopedRelations}
              onGenerate={genRelations}
              onCancel={() => cancelTask('relations', '分析方法关系')}
              onOpenEvidence={openEvidence}
              busy={relationBusy || hydratingScope}
              onDeleteRelation={async (id) => {
                await repo.delete('relations', id);
                setRelations((rs) => rs.filter((r) => r.id !== id));
                log('已删除一条关系（人工操作）');
              }}
              onUpdateRelation={async (id, patch) => {
                const rel = relations.find((r) => r.id === id);
                if (!rel) return;
                const next = { ...rel, ...patch } as Relation;
                await repo.saveRelation(next);
                setRelations((rs) => rs.map((r) => (r.id === id ? next : r)));
                log(`人工修正关系：${RELATION_STATE_LABELS[next.evidenceState]} / ${RELATION_LABELS[next.type]}（AI 原判定已保留）`);
              }}
              onAddRelation={async (r) => {
                await repo.saveRelation(r);
                setRelations((rs) => [...rs, r]);
                log('人工添加了一条关系，并标记为人工修正');
              }}
            />
          )}

          {tab === 'decision' && (
            <DecisionView
              papers={scope.papers}
              methods={scope.methods}
              plan={plan}
              busy={planBusy}
              onCancel={() => cancelTask('plan', '生成阅读路线')}
              modelReady={modelReady}
              onGenerate={genDecision}
              onUseSample={() => {
                if (plan) return;
                log('尚未生成决策，请先点「生成方法决策」；若已加载预置语料，示例决策会自动显示。');
              }}
              sampleProfile={sampleProfile}
              onOpenEvidence={openEvidence}
              onGo={(t) => setTab(t as Tab)}
              onOpenPaper={(paperId) => {
                setExpFocus(paperId);
                setTab('library');
              }}
            />
          )}

          {tab === 'divergence' && (
            <DivergenceView
              papers={scope.papers}
              methods={scope.methods}
              staleNotes={staleNotes}
              report={divergence}
              busy={divergenceBusy}
              onCancel={() => cancelTask('divergence', '分析待调查问题')}
              onGenerate={genDivergence}
              onUseSample={() => {
                if (divergence) return;
                log('尚未分析分歧，请先点「分析分歧与待调查问题」，或加载预置样例语料。');
              }}
              /* 卡片右上的两个图标按钮（草稿是「收藏 / 标记已解决」，我们没有那种状态，换成真实操作） */
              onOpenPaper={(paperId) => {
                setResultPaperId(paperId);
                setTab('result');
              }}
              onOpenEvidence={(ev, label, paper) => void openEvidence(ev, label, paper)}
            />
          )}

          {tab === 'settings' && (
            <SettingsView config={config} onSave={saveConfig} onTest={testConnection} testResult={testResult} testing={testing} />
          )}

          {tab === 'status' && (
            <StatusView
              papers={scope.papers}
              methods={scope.methods}
              usage={usage}
              capabilities={capabilities}
              corpusMeta={corpusMeta}
              relationCounts={{
                explicit: scopedRelations.filter((r) => r.evidenceState === 'explicit').length,
                inferred: scopedRelations.filter((r) => r.evidenceState === 'inferred').length,
                candidate: scopedRelations.filter((r) => r.evidenceState === 'candidate').length,
                userEdited: scopedRelations.filter((r) => r.userEdited).length,
              }}
            />
          )}

          {tab === 'version' && <VersionView onBack={() => setTab('more')} onGo={(t) => setTab(t as Tab)} />}

          {tab === 'future' && <FutureView onBack={() => setTab('more')} onGo={(t) => setTab(t as Tab)} />}

          {/*
            2026-10-10：原先这里在所有非首页 tab 的底部固定渲染一个
            <details class="fold footnote">「研究伦理与边界（点开查看）」折叠条。
            用户要求移除（草稿里没有这种全站尾随块，页面应保持纯净）。
            它原本承担的两条声明（不排名 / 不把关键词相似当继承 / 不把预置样例伪装成实时分析）
            仍由各处页面级的文案与验收脚本覆盖：
              · 实验可比性页：不做排名、不给因果结论
              · 方法提取页 fineprint：解析在本机完成、密钥只存本机
              · 首页页脚：配图为产品概念示意、真实结果指向对应工作页
              · 代码层：comparability.ts / evidence.ts / effective.ts 的硬约束
          */}
          </div>
        </main>
      </div>

      {evidence && (
        <EvidencePopover evidence={evidence.e} paper={evidence.paper} fieldLabel={evidence.label} onClose={() => setEvidence(null)} />
      )}

      {/* 撤销移除条（全局）：移除入口已迁到分析结果页，从那里移除后也要能一键恢复 */}
      {lastRemoved && (
        <div className="undobar" role="status" style={{ position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 60, maxWidth: 900, marginLeft: 'auto', marginRight: 'auto' }}>
          <span style={{ flex: '1 1 240px' }}>
            已移除《{lastRemoved.paper.title.slice(0, 40)}》。本机数据与关联关系已删除，可一键恢复（不会重新调用模型）。
          </span>
          <button
            className="btn sm"
            onClick={() => {
              restorePaper(lastRemoved.paper, undefined, lastRemoved.methods, lastRemoved.relations);
              setLastRemoved(null);
            }}
          >
            撤销移除
          </button>
          <button className="btn ghost sm" onClick={() => setLastRemoved(null)}>
            知道了
          </button>
        </div>
      )}
    </div>
  );
}
