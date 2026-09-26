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
import { hashFile, loadMeta, repo, saveMeta, appendUsage, type UsageRecord } from './core/storage';
import { paperFromText, parsePdfFile } from './core/parse/pdfBrowser';
import {
  applyTitleCorrection,
  extractMethodWithProgress,
  findDivergences,
  generateDecision,
  inferRelations,
} from './core/model/analyze';
import { chat, type CallTrace } from './core/model/client';
import {
  assessCorpusStaleness,
  corpusBaseOfPaper,
  loadCorpusIndex,
  loadPaperText,
  hydratePaper,
  migrateMethod,
  migrateRelation,
  revalidateCachedRelations,
  FIELD_KEYS_ORDER,
} from './core/cache';
import { RULES_VERSION, looksLikeTitle } from './core/rules';
import { validateMethod } from './core/validate';
import { effectiveField, overriddenFieldLabels } from './core/effective';
import { PROMPT_VERSION } from './core/model/prompts';
import {
  CORPUS_META,
  asScopedSnapshot,
  collectPaperRemoval,
  legacyCorpusPatches,
  readScopedSnapshot,
  replaceRelationsInScope,
  scopeCorpus,
  scopeRelations,
  type CorpusKey,
  type ScopeMode,
} from './core/corpus';
import { LibraryView, type JobState } from './ui/Library';
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
import { MoreView } from './ui/MoreView';
import { SettingsView, StatusView, capabilitiesList, MODEL_ERROR_HINT } from './ui/SettingsView';
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
  | 'experiments'
  | 'compare'
  | 'graph'
  | 'decision'
  | 'divergence'
  | 'settings'
  | 'status';

/** 三类由模型生成的分析任务（各自有 busy / 取消 / 请求版本保护） */
type TaskKind = 'relations' | 'plan' | 'divergence';

const EMPTY_CONFIG: ModelConfig = { baseUrl: '', apiKey: '', model: '' };

export default function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('rp.tab2') : null;
    const allowed: Tab[] = [
      'landing', 'map', 'upload', 'more',
      'library', 'experiments', 'compare', 'graph', 'decision', 'divergence', 'settings', 'status',
    ];
    return saved && (allowed as string[]).includes(saved) ? (saved as Tab) : 'landing';
  });
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
  const [expPicked, setExpPicked] = useState(0);
  const [expCompared, setExpCompared] = useState(false);
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
   * 各语料集**预置缓存里到底有什么**（论文数 / 实验记录数）。
   * 实验可比性页据此如实说明「这份语料有没有实验记录」，
   * 不再无脑承诺「重新加载就能补齐实验记录」。
   */
  const [sampleStats, setSampleStats] = useState<Record<string, { papers: number; experiments: number; at: number }>>({});
  const scopedRelations = useMemo(() => scopeRelations(relations, scope), [relations, scope]);
  /** 当前语料集身份（用于分析产物的归属校验） */
  const currentCorpusId = CORPUS_META[corpus].id;
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
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
  const taskHandles = useRef<Record<TaskKind, AbortController | null>>({ relations: null, plan: null, divergence: null });
  /**
   * 请求版本号：旧请求返回时不能覆盖新案例 / 新论文 / 人工修正后的状态。
   * 每次发起任务自增；语料切换、论文变化、人工修正时也自增，使在途结果直接作废。
   */
  const requestSeq = useRef<Record<TaskKind, number>>({ relations: 0, plan: 0, divergence: 0 });
  const [config, setConfig] = useState<ModelConfig>(EMPTY_CONFIG);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [evidence, setEvidence] = useState<{ e: Evidence; label: string; paper?: Paper } | null>(null);
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
    (async () => {
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
      // 兼容第一阶段遗留数据：状态与关系字段按新口径迁移
      setMethods(msFixed.map(migrateMethod));
      setRelations(rs.map(migrateRelation));
      const u = await loadMeta<UsageRecord[]>('usage');
      if (u) setUsage(u);
      // 分析产物（语料元信息 / 分歧 / 路线 / 示例条件）必须带语料集身份：
      // 只有明确记录且与当前语料集一致才恢复，否则刷新后会显示上一个案例的结论。
      const cm = readScopedSnapshot<typeof corpusMeta>(await loadMeta('corpusMeta'), currentCorpusId);
      if (cm) setCorpusMeta(cm);
      const dv = readScopedSnapshot<DivergenceReport>(await loadMeta('divergence'), currentCorpusId);
      if (dv) setDivergence(dv);
      const pl = readScopedSnapshot<ReadingPlan>(await loadMeta('decision'), currentCorpusId);
      if (pl) setPlan(pl);
      const sp = readScopedSnapshot<UserProfile>(await loadMeta('demoProfile'), currentCorpusId);
      if (sp) setSampleProfile(sp);
      // 各语料预置缓存的内容摘要（刷新后仍要知道「这份语料有没有实验记录」）
      const ss = await loadMeta<Record<string, { papers: number; experiments: number; at: number }>>('sampleStats');
      if (ss) setSampleStats(ss);
    })();
  }, []);

  const refreshUsage = async () => {
    const u = (await loadMeta<UsageRecord[]>('usage')) || [];
    setUsage([...u]);
  };

  /* ---------- 导入 ---------- */
  const importFiles = async (files: FileList | File[]) => {
    /**
     * 本轮批次的哈希去重集合：开始时装入已在本机的哈希，每导入一个就加进去。
     * 不能用 `papers` 闭包判断重复 —— setState 是异步的，一次选多个文件时闭包里的
     * papers 始终是旧的，同一个文件（或内容相同的两个文件）会被重复导入。
     */
    const seenHashes = new Set<string>(papers.map((p) => p.contentHash).filter(Boolean) as string[]);
    const titleByHash = new Map<string, string>(
      papers.filter((p) => p.contentHash).map((p) => [p.contentHash as string, p.title]),
    );
    /** 本次真正写进库里的论文（去重跳过的不算），用于导入后切范围与给出入口 */
    const added: Paper[] = [];
    for (const file of Array.from(files)) {
      log(`导入文件：${file.name}（${(file.size / 1024 / 1024).toFixed(1)} MB）`);
      try {
        const hash = await hashFile(file);
        // 只要用户在**本次会话里**还留着这份文件，就记住它，便于真正「重新解析」
        fileCacheRef.current.set(hash, file);
        if (seenHashes.has(hash)) {
          log(
            `  跳过：与已导入的「${titleByHash.get(hash) ?? file.name}」内容相同（按内容哈希去重，不重复消耗模型额度）`,
          );
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
        if (!outcome.paper) continue;
        /**
         * 标题状态必须如实：PDF 首页排版多变，实测会把摘要句抓成标题。
         * 不像标题的一律先标「待确认」，等模型在原文里核验出真标题再改写。
         */
        const paper: Paper = {
          ...outcome.paper,
          titleFrom: looksLikeTitle(outcome.paper.title) ? 'heuristic' : 'unverified',
        };
        outcome.warnings.forEach((w) => log(`  提示：${w}`));
        if (!outcome.ok) {
          log(`  失败：${outcome.error}`);
          await repo.savePaper(paper);
          setPapers((p) => [...p, paper]);
          added.push(paper);
          continue;
        }
        log(`  解析成功：标题「${paper.title}」，${paper.pages.length} 页，${paper.charCount} 字符`);
        if (paper.titleFrom === 'unverified') {
          log('  注意：从首页猜出来的标题不像论文标题，已标记为「标题待确认」（模型抽取后会用原文核验的真标题替换）');
        }
        await repo.savePaper(paper);
        setPapers((p) => [...p, paper]);
        added.push(paper);
      } catch (err) {
        log(`  异常：${(err as Error).message}`);
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
      const ownCount = papers.filter((p) => (p.corpusId ?? 'user-import') === 'user-import').length + added.length;
      if (mapMode !== 'own') {
        setMapMode('own');
        log(`已切到「我上传的论文」范围（共 ${ownCount} 篇），列表与计数都已指向这个集合；案例数据不受影响，可随时切回。`);
      }
    }
    setTick((t) => t + 1);
    // 论文集合变了：在途分析结果不再对应当前数据
    invalidateTasks();
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
    const target = papers.find((p) => p.id === paperId);
    if (!target) {
      log('重新解析中止：找不到这篇论文（可能已被移除）。');
      return;
    }
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
      const next: Paper = {
        ...outcome.paper,
        // 沿用原来的 id，避免同一篇论文出现两条记录（方法/关系的关联也不会断）
        id: target.id,
        titleFrom: looksLikeTitle(outcome.paper.title) ? 'heuristic' : 'unverified',
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
    const next = collectPaperRemoval(papers, methods, relations, id);
    try {
      await repo.deleteRelations(next.removedRelations.map((r) => r.id));
      await repo.deleteMethods(next.removedMethods.map((m) => m.id));
      await repo.delete('papers', id);
    } catch (e) {
      log(`移除失败：${(e as Error).message}（已重新读取本机数据，未做任何丢失性操作）`);
      setPapers(await repo.listPapers());
      setMethods((await repo.listMethods()).map(migrateMethod));
      setRelations((await repo.listRelations()).map(migrateRelation));
      return;
    }
    setPapers(next.papers);
    setMethods(next.methods);
    setRelations(next.relations);
    setSelected((s) => s.filter((x) => x !== id));
    // 论文集合变了：在途分析结果不再对应当前数据
    invalidateTasks();
    log(
      `移除论文 ${id}：同时删除该论文的 ${next.removedMethods.length} 条方法分析、` +
        `${next.removedRelations.length} 条关联关系（不留悬挂关系）`,
    );
  };

  /** 撤销移除：把论文、方法分析与关联关系一起写回本机（用户数据一律不丢，不重新调用模型） */
  const restorePaper = async (paper: Paper, method?: Method, allMethods?: Method[], relationsToRestore?: Relation[]) => {
    const methodsBack = allMethods && allMethods.length ? allMethods : method ? [method] : [];
    await repo.savePaper(paper);
    setPapers((p) => (p.some((x) => x.id === paper.id) ? p : [...p, paper]));
    for (const m of methodsBack) await repo.saveMethod(m);
    for (const r of relationsToRestore ?? []) await repo.saveRelation(r);
    if (methodsBack.length) {
      const backIds = new Set(methodsBack.map((m) => m.id));
      setMethods((ms) => [...ms.filter((m) => !backIds.has(m.id)), ...methodsBack]);
    }
    if (relationsToRestore?.length) {
      const backRelIds = new Set(relationsToRestore.map((r) => r.id));
      setRelations((rs) => [...rs.filter((r) => !backRelIds.has(r.id)), ...relationsToRestore]);
    }
    log(
      `已撤销移除：${paper.title.slice(0, 30)}（论文、${methodsBack.length} 条方法分析、` +
        `${relationsToRestore?.length ?? 0} 条关联关系都已写回本机，不会重新调用模型）`,
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
    const outgoing = CORPUS_META[corpus];
    const outPapers = papers.filter((x) => x.corpusId === outgoing.id);
    const outMethods = methods.filter((x) => x.corpusId === outgoing.id);
    for (const x of outPapers) await repo.delete('papers', x.id);
    for (const m of outMethods) await repo.delete('methods', m.id);
    setPapers((ps) => ps.filter((x) => x.corpusId !== outgoing.id));
    setMethods((ms) => ms.filter((x) => x.corpusId !== outgoing.id));
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
      `已切换到「${CORPUS_META[next].label}」：上一套语料（${CORPUS_META[corpus].label}）的 ${outPapers.length} 篇论文与 ${outMethods.length} 条方法分析已移除（不做叠加），` +
        '两套语料各自独立计算关系与推荐；上一个案例的阅读路线、分歧与过期提示已一起清理，不会被带过来。',
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
    if (corpusLoading) {
      log('已有加载任务在进行中，已忽略本次点击（避免重复写入）。');
      return;
    }
    const cfg = CORPUS_META[key];
    setCorpusLoading(key);
    try {
      log(`加载语料：${cfg.label}（离线真实模型生成，非本次实时分析）…`);
      const { index, formatMismatch } = await loadCorpusIndex(cfg.base);
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

      // 幂等替换该语料集已有记录：**先写新的、再删被替换掉的旧的**，
      // 中途失败时旧数据仍在（原约定「失败时保留已有数据」）。
      const prevScopePaperIds = papers.filter((x) => x.corpusId === corpusId).map((x) => x.id);
      const prevScopeMethodIds = methods.filter((x) => x.corpusId === corpusId).map((x) => x.id);
      for (const x of hyd) await repo.savePaper(x);
      for (const m of cachedMethods) await repo.saveMethod(m);
      const newPaperIds = new Set(hyd.map((x) => x.id));
      const newMethodIds = new Set(cachedMethods.map((m) => m.id));
      await repo.deletePapers(prevScopePaperIds.filter((id) => !newPaperIds.has(id)));
      await repo.deleteMethods(prevScopeMethodIds.filter((id) => !newMethodIds.has(id)));
      /**
       * 关系按范围**原子替换**：只替换「两端都属于本次加载语料的方法」的关系。
       * 之前这里调的是 repo.clearRelations()（整库清空），会把其它案例的关系、
       * 用户上传论文的关系以及人工添加/修正过的关系一起删掉。
       * 批量写/删各在一个事务里，整批失败就整批回滚 —— 原关系保持不变。
       */
      const loadedMethodIds = new Set<string>(cachedMethods.map((m) => m.id));
      const incomingIds = new Set(cachedRelations.map((r) => r.id));
      const relSwap = replaceRelationsInScope(relations, cachedRelations, loadedMethodIds);
      await repo.saveRelations(cachedRelations);
      await repo.deleteRelations(relSwap.drop.filter((r) => !incomingIds.has(r.id)).map((r) => r.id));

      setPapers((prev) => [...prev.filter((x) => x.corpusId !== corpusId), ...hyd]);
      setMethods((prev) => [...prev.filter((x) => x.corpusId !== corpusId), ...cachedMethods]);
      setRelations(relSwap.next);
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

      // 分析产物一律带语料集身份存档：切到别的案例后，刷新不会把本案例的结论读成当前案例的
      if (index.divergences) {
        const cachedDiv = { ...index.divergences, cached: true };
        setDivergence(cachedDiv);
        await saveMeta('divergence', asScopedSnapshot(corpusId, cachedDiv));
      } else {
        setDivergence(undefined);
        await saveMeta('divergence', asScopedSnapshot(corpusId, null));
      }
      if (index.decisionSample) {
        const cachedPlan = { ...index.decisionSample, cached: true };
        setPlan(cachedPlan);
        await saveMeta('decision', asScopedSnapshot(corpusId, cachedPlan));
      } else {
        setPlan(undefined);
        await saveMeta('decision', asScopedSnapshot(corpusId, null));
      }
      if (index.demoProfile) {
        setSampleProfile(index.demoProfile);
        await saveMeta('demoProfile', asScopedSnapshot(corpusId, index.demoProfile));
      } else {
        setSampleProfile(undefined);
        await saveMeta('demoProfile', asScopedSnapshot(corpusId, null));
      }
      await saveMeta('corpusMeta', asScopedSnapshot(corpusId, index.meta));

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
       */
      setSampleStats((prev) => {
        const next = { ...prev, [key]: { papers: hyd.length, experiments, at: Date.now() } };
        void saveMeta('sampleStats', next);
        return next;
      });
      log(`已加载 ${hyd.length} 篇论文、${experiments} 条实验记录、${cachedRelations.length} 条关系（语料集：${cfg.label}）`);
      log(`缓存生成信息：模型 ${index.meta.model}，提示词 ${index.meta.promptVersion}，时间 ${index.meta.generatedAt}`);
      if (index.divergences) log(`同时载入预置分歧分析：${index.divergences.findings.length} 条发现`);
      if (index.decisionSample) log(`同时载入预置示例决策：候选 ${index.decisionSample.candidates?.length ?? 0} 个`);
      log(`注意：${index.notice}`);
    } catch (e) {
      const msg = (e as Error).message;
      log(`加载语料失败：${msg}（已保留当前已有数据，可稍后重试）`);
      setLoadResult({ key, ok: false, papers: 0, experiments: 0, relations: 0, message: `加载失败：${msg}`, at: Date.now() });
    } finally {
      setCorpusLoading(null);
    }
  };

  /** 清理其它语料集的残留数据（明确动作，不做静默合并） */
  const clearForeignCorpus = async () => {
    const foreignPapers = papers.filter((x) => x.corpusId && x.corpusId !== corpusIdOf(corpus) && x.corpusId !== 'user-import');
    const foreignMethods = methods.filter((x) => x.corpusId && x.corpusId !== corpusIdOf(corpus) && x.corpusId !== 'user-import');
    const foreignIds = new Set(foreignPapers.map((x) => x.id));
    for (const x of foreignPapers) await repo.delete('papers', x.id);
    for (const m of foreignMethods) await repo.delete('methods', m.id);
    setPapers((prev) => prev.filter((x) => !foreignIds.has(x.id)));
    setMethods((prev) => prev.filter((m) => !foreignMethods.some((fm) => fm.id === m.id)));
    log(`已清理其它语料集数据：${foreignPapers.length} 篇论文、${foreignMethods.length} 条方法分析（不影响当前语料与自传论文）。`);
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
  const extract = async (paperId: string, force = false) => {
    const paper = papers.find((p) => p.id === paperId);
    if (!paper) return;

    if (!modelReady) {
      const msg = '未配置模型接口：缺少 baseUrl / API Key / 模型名。抽取已取消，未产生任何替代结果。';
      log(`抽取中止：${msg}`);
      setJobs((j) => ({ ...j, [paperId]: { paperId, stage: 'extract', message: '未配置模型', status: 'failed', attempts: 0, error: msg } }));
      return;
    }

    // 若只有元数据（缓存样例）而无全文，先取回全文
    let full = paper;
    if (!full.rawText) {
      try {
        // 全文目录必须按论文归属的语料集选择：视觉案例在 samples-vision/text/，不是 samples/text/
        const t = await loadPaperText(full.id, corpusBaseOfPaper(full.corpusId));
        full = hydratePaper(full, t);
        setPapers((ps) => ps.map((p) => (p.id === full.id ? full : p)));
        await repo.savePaper(full);
      } catch (e) {
        log(`无法取回该论文全文，抽取取消：${(e as Error).message}`);
        return;
      }
    }

    const prev = methods.find((m) => m.paperId === paperId);
    if (prev && !prev.cached && !force) {
      log(`该论文已有实时分析结果，跳过（如需重跑请点击重新分析）`);
      return;
    }

    const controller = new AbortController();
    cancelHandles.current[paperId] = controller;
    setJobs((j) => ({ ...j, [paperId]: { paperId, stage: 'extract', message: '准备中', status: 'running', attempts: 0 } }));
    log(`开始抽取：${full.title}`);

    const t0 = Date.now();
    const extractTrace = traceRecorder();
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

      const corrected = applyTitleCorrection(full, method);
      // 标题校正后重算校验（否则会同时出现「标题未确认」与「已模型校正」）
      method.validation = validateMethod(corrected, method);
      if (corrected.title !== full.title) {
        log(`  标题校正为「${corrected.title}」（模型给出且已在原文中验证）`);
        await repo.savePaper(corrected);
        setPapers((ps) => ps.map((p) => (p.id === corrected.id ? corrected : p)));
      }

      // 重新分析时保留用户的人工修正（override），不静默覆盖
      const mergedMethod = mergeReanalysisResult(prev, method);
      await repo.saveMethod(mergedMethod);
      setMethods((ms) => [...ms.filter((m) => m.paperId !== paperId), mergedMethod]);
      if (prev) {
        // 论文结果已更新：下游由模型生成的关系与推荐需要重新生成；比较页按当前数据实时重算
        invalidateTasks();
        setPendingDependents((d) => [...d.filter((x) => x.paperId !== paperId), { paperId, at: Date.now(), reason: 'reanalyze' }]);
        if (prev?.overrides?.length) {
          log(`  已保留该论文的 ${prev.overrides.length} 条人工修正（重新分析不会覆盖人工修正）`);
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
    setTick((t) => t + 1);
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
          const t = await loadPaperText(p.id, corpusBaseOfPaper(p.corpusId));
          const full = hydratePaper(p, t);
          byId.set(p.id, full);
          hydrated += 1;
          await repo.savePaper(full);
          setPapers((ps) => ps.map((x) => (x.id === full.id ? full : x)));
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
    if (relationBusy) {
      log('关系分析已在进行中，已忽略本次点击。');
      return;
    }
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
       * 按范围原子替换关系（不再 repo.clearRelations 整库清空）：
       * 只替换两端都属于当前范围的关系，其它案例、用户上传论文、人工添加/修正的关系原样保留。
       * 写入顺序是「先写新关系、再删被替换掉的旧关系」——中途失败时原关系还在。
       */
      const swap = replaceRelationsInScope(relations, rels, scope.scopeMethodIds);
      const incomingIds = new Set(rels.map((r) => r.id));
      await repo.saveRelations(rels);
      await repo.deleteRelations(swap.drop.filter((r) => !incomingIds.has(r.id)).map((r) => r.id));
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
      setRelationBusy(false);
    }
  };

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
    if (planBusy) {
      log('方法决策已在进行中，已忽略本次点击。');
      return;
    }
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
      await saveMeta('decision', asScopedSnapshot(currentCorpusId, p));
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
    if (divergenceBusy) {
      log('分歧分析已在进行中，已忽略本次点击。');
      return;
    }
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
      await saveMeta('divergence', asScopedSnapshot(currentCorpusId, rep));
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
      setDivergenceBusy(false);
    }
  };

  /* ---------- 设置 ---------- */
  const saveConfig = async (c: ModelConfig) => {
    setConfig(c);
    await saveMeta('modelConfig', c);
    log(`模型设置已保存到本机（${c.baseUrl} / ${c.model}）。密钥不写入任何导出文件。`);
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
    let target = paper ?? papers.find((p) => p.id === e.paperId);
    if (target && !target.rawText) {
      try {
        const t = await loadPaperText(target.id, corpusBaseOfPaper(target.corpusId));
        target = hydratePaper(target, t);
        setPapers((ps) => ps.map((p) => (p.id === target!.id ? target! : p)));
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
        onGo={(t) => setTab(t as Tab)}
        onBack={() => setTab('library')}
      />

      <div className={`app-body${tab === 'map' ? ' mapbody' : ''}`}>
        {/* 默认不显示侧栏：页面切换走顶部「目录」浮层 */}

        <main className={`main${tab === 'landing' ? ' plain' : ''}${tab === 'map' ? ' mapmain' : ''}`}>
          <div className="main-inner">
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
                if (scope.experimentCount === 0) await loadSample(corpus);
                setTab('library');
              }}
              onUploadOwn={() => setTab('upload')}
              onGo={(t) => setTab(t)}
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
              questions={(divergence?.findings ?? []).map((f) => {
                /**
                 * 这里**只转发**分歧规则模块已经做过的定位校验结果（divergenceRules 里统一走 buildEvidence），
                 * 不在这里把模型给的字符串包装成 verified —— 那等于自己给自己发核验证书。
                 * 没有通过定位校验的引文按「待核查」展示（页面上会带说明）。
                 */
                const withEvidence = f.sides.find((x) => x.quoteEvidence);
                return {
                  id: f.id,
                  text: f.topic || f.explanation.slice(0, 60),
                  basis: [f.commonScope ? `共同范围：${f.commonScope}` : '', f.explanation].filter(Boolean).join('　'),
                  evidence: withEvidence?.quoteEvidence ? [withEvidence.quoteEvidence] : undefined,
                };
              })}
              modelReady={modelReady}
              busy={planBusy || hydratingScope}
              onCancelGenerate={() => cancelTask('plan', '生成阅读路线')}
              mode={mapMode}
              onModeChange={setMapMode}
              onGenerate={genDecision}
              onOpenEvidence={(ev) => openEvidence(ev, '原文依据', papers.find((x) => x.id === ev.paperId))}
              onAddPapers={() => setTab('upload')}
              onGoLibrary={() => setTab('library')}
              onSwitchCase={async () => {
                await switchCorpus(corpus === 'vision' ? 'nlp-dev' : 'vision');
              }}
              onReloadCase={() => loadSample(corpus)}
            />
          )}

          {tab === 'upload' && (
            <UploadFlowView
              papers={papers}
              scope={scope}
              methods={methods}
              jobs={jobs}
              lastImportedId={lastImportedId}
              onReparse={reparsePaper}
              canReparseInPlace={canReparseInPlace}
              onUseOwnScope={() => setMapMode('own')}
              onUseCaseScope={() => setMapMode('case')}
              modelReady={modelReady}
              config={config}
              onSaveConfig={async (c) => {
                await saveConfig(c);
              }}
              onTest={testConnection}
              testing={testing}
              testResult={testResult ? `${testResult.ok ? '连接成功' : '连接失败'}：${testResult.text}` : undefined}
              onImport={importFiles}
              onPaste={importPaste}
              onExtract={extract}
              onCancel={cancelExtract}
              onEnterMap={() => setTab('map')}
              onOpenPaper={(paperId) => {
                setExpFocus(paperId);
                setTab('library');
              }}
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
              papers={papers}
              methods={methods}
              onOpenEvidence={(ev) => openEvidence(ev, ev.quote?.slice(0, 40) ?? '证据')}
              onGo={(t) => setTab(t)}
              onLoadSample={() => loadSample(corpus)}
              scope={scope}
              corpusLoading={corpusLoading}
              loadResult={loadResult}
              focusPaper={expFocus}
              cacheStats={sampleStats[corpus] ?? null}
              visionStats={sampleStats.vision ?? null}
              onSwitchToVision={() => void switchCorpus('vision')}
              onProgress={(p) => {
                setExpPicked(p.picked);
                setExpCompared(p.compared);
              }}
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
              onGoGraph={() => setTab('graph')}
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

          {tab !== 'landing' && (
          <details className="fold footnote">
            <summary>研究伦理与边界（点开查看）</summary>
            <div className="fold-body">
              <p>
                本作品把「论文原文」当作分析材料而不是指令来源；界面中每个结论都能回到原文，定位不到就标记为「待人工核对」或「未找到证据」。
              </p>
              <p>系统不对方法效果排名，不把关键词相似当作技术继承，也不把预置样例伪装成实时分析。</p>
            </div>
          </details>
          )}
          </div>
        </main>
      </div>

      {evidence && (
        <EvidencePopover evidence={evidence.e} paper={evidence.paper} fieldLabel={evidence.label} onClose={() => setEvidence(null)} />
      )}
    </div>
  );
}
