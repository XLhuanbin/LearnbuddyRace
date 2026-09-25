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
import { chat } from './core/model/client';
import {
  assessCorpusStaleness,
  loadCorpusIndex,
  loadPaperText,
  hydratePaper,
  migrateMethod,
  migrateRelation,
  FIELD_KEYS_ORDER,
} from './core/cache';
import { RULES_VERSION } from './core/rules';
import { validateMethod } from './core/validate';
import { PROMPT_VERSION } from './core/model/prompts';
import {
  CORPUS_META,
  legacyCorpusPatches,
  scopeCorpus,
  scopeRelations,
  type CorpusKey,
} from './core/corpus';
import { LibraryView, type JobState } from './ui/Library';
import { CompareView } from './ui/Compare';
import { GraphView } from './ui/Graph';
import { DecisionView, downloadDecision } from './ui/PlanView';
import { DivergenceView } from './ui/Divergence';
import { ExperimentsView } from './ui/ExperimentsView';
import { HomeView } from './ui/HomeView';
import { LandingView } from './ui/LandingView';
import { MapView, type ScopeMode } from './ui/MapView';
import { AppBrandBar } from './ui/mapChrome';
import { UploadFlowView } from './ui/UploadFlowView';
import { MoreView } from './ui/MoreView';
import { SettingsView, StatusView, capabilitiesList, MODEL_ERROR_HINT } from './ui/SettingsView';
import { EvidencePopover, Banner } from './ui/common';
import { describeDependents, describeJobOutcome, mergeReanalysisResult } from './core/reanalysis';

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
  /** 当前语料范围：导航、论文库、实验比较、方法关系的所有计数都必须用它 */
  const scope = useMemo(() => scopeCorpus(papers, methods, corpus), [papers, methods, corpus]);
  const scopedRelations = useMemo(() => scopeRelations(relations, scope), [relations, scope]);
  const experimentsCount = scope.experimentCount;
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  /** 正在进行中的抽取调用的取消句柄（只停止本地等待） */
  const cancelHandles = useRef<Record<string, AbortController>>({});
  /** 重新分析成功后，需要重新生成的下游结果（关系/决策）；比较页按当前数据实时重算 */
  const [pendingDependents, setPendingDependents] = useState<{ paperId: string; at: number }[]>([]);
  const [config, setConfig] = useState<ModelConfig>(EMPTY_CONFIG);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [evidence, setEvidence] = useState<{ e: Evidence; label: string; paper?: Paper } | null>(null);
  const [corpusMeta, setCorpusMeta] = useState<{ generatedAt: string; model?: string; promptVersion?: string; domain?: string; samplesAreDevOnly?: boolean; purpose?: string } | undefined>();
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | undefined>();
  const [testing, setTesting] = useState(false);
  const [, setTick] = useState(0);
  /** 研究地图当前显示的集合（案例 / 我上传的论文）；由左侧研究工作区导航控制 */
  const [mapMode, setMapMode] = useState<ScopeMode>('case');
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
      const cm = await loadMeta<typeof corpusMeta>('corpusMeta');
      if (cm) setCorpusMeta(cm);
      const dv = await loadMeta<DivergenceReport>('divergence');
      if (dv) setDivergence(dv);
      const pl = await loadMeta<ReadingPlan>('decision');
      if (pl) setPlan(pl);
      const sp = await loadMeta<UserProfile>('demoProfile');
      if (sp) setSampleProfile(sp);
    })();
  }, []);

  const refreshUsage = async () => {
    const u = (await loadMeta<UsageRecord[]>('usage')) || [];
    setUsage([...u]);
  };

  /* ---------- 导入 ---------- */
  const importFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      log(`导入文件：${file.name}（${(file.size / 1024 / 1024).toFixed(1)} MB）`);
      try {
        const hash = await hashFile(file);
        const dup = papers.find((p) => p.contentHash === hash);
        if (dup) {
          log(`  跳过：与已导入的「${dup.title}」内容相同（按内容哈希去重，不重复消耗模型额度）`);
          continue;
        }
        // 重新读取一遍字节用于解析（File.arrayBuffer 可重复调用）
        const outcome = await parsePdfFile(file, {
          contentHash: hash,
          sample: {
            purpose: '用户导入的真实文件',
            license: '版权归原作者，仅在本机解析用于个人阅读',
          },
        });
        if (!outcome.paper) continue;
        const paper: Paper = { ...outcome.paper, titleFrom: 'heuristic' };
        outcome.warnings.forEach((w) => log(`  提示：${w}`));
        if (!outcome.ok) {
          log(`  失败：${outcome.error}`);
          await repo.savePaper(paper);
          setPapers((p) => [...p, paper]);
          continue;
        }
        log(`  解析成功：标题「${paper.title}」，${paper.pages.length} 页，${paper.charCount} 字符`);
        await repo.savePaper(paper);
        setPapers((p) => [...p, paper]);
      } catch (err) {
        log(`  异常：${(err as Error).message}`);
      }
    }
    setTick((t) => t + 1);
  };

  const importPaste = async (title: string, text: string) => {
    const paper = paperFromText(title, text, { sample: { purpose: '用户粘贴文本导入' } });
    paper.titleFrom = 'heuristic';
    await repo.savePaper(paper);
    setPapers((p) => [...p, paper]);
    log(`粘贴导入：${paper.title}（${paper.charCount} 字符）`);
  };

  const removePaper = async (id: string) => {
    await repo.delete('papers', id);
    await repo.delete('methods', `m_${id}`);
    setPapers((p) => p.filter((x) => x.id !== id));
    setMethods((ms) => ms.filter((m) => m.paperId !== id));
    setSelected((s) => s.filter((x) => x !== id));
    log(`移除论文 ${id}`);
  };

  /** 撤销移除：把论文与已有分析结果写回本机（用户数据一律不丢） */
  const restorePaper = async (paper: Paper, method?: Method) => {
    await repo.savePaper(paper);
    setPapers((p) => (p.some((x) => x.id === paper.id) ? p : [...p, paper]));
    if (method) {
      await repo.saveMethod(method);
      setMethods((ms) =>
        ms.some((m) => m.id === method.id) ? ms : [...ms.filter((m) => m.paperId !== paper.id), method],
      );
    }
    log(`已撤销移除：${paper.title.slice(0, 30)}（论文与已有分析结果都已写回本机，不会重新调用模型）`);
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
    log(
      `已切换到「${CORPUS_META[next].label}」：上一套语料（${CORPUS_META[corpus].label}）的 ${outPapers.length} 篇论文与 ${outMethods.length} 条方法分析已移除（不做叠加），` +
        '两套语料各自独立计算关系与推荐。',
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
      const cachedRelations = index.relations.map(
        (r) => ({ ...migrateRelation(r), cached: true } as Relation & { cached: boolean }),
      );

      // 幂等：先移除该语料集已有记录（IndexedDB + 状态），再写入索引内容
      const prevScopePaperIds = papers.filter((x) => x.corpusId === corpusId).map((x) => x.id);
      const prevScopeMethodIds = methods.filter((x) => x.corpusId === corpusId).map((x) => x.id);
      for (const id of prevScopePaperIds) await repo.delete('papers', id);
      for (const id of prevScopeMethodIds) await repo.delete('methods', id);
      for (const x of hyd) await repo.savePaper(x);
      for (const m of cachedMethods) await repo.saveMethod(m);
      // 关系整体替换：关系只属于当前语料集，不做跨语料合并
      await repo.clearRelations();
      for (const r of cachedRelations) await repo.saveRelation(r);

      setPapers((prev) => [...prev.filter((x) => x.corpusId !== corpusId), ...hyd]);
      setMethods((prev) => [...prev.filter((x) => x.corpusId !== corpusId), ...cachedMethods]);
      setRelations(cachedRelations);
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
      const notes = [...staleness.notes];
      if (formatMismatch) notes.push(formatMismatch);
      setStaleNotes(notes);
      if (staleness.stale) log('过期提示：' + staleness.notes.join(' / '));

      if (index.divergences) {
        setDivergence({ ...index.divergences, cached: true });
        await saveMeta('divergence', index.divergences);
      } else {
        setDivergence(undefined);
      }
      if (index.decisionSample) {
        setPlan({ ...index.decisionSample, cached: true });
        await saveMeta('decision', index.decisionSample);
      } else {
        setPlan(undefined);
      }
      if (index.demoProfile) {
        setSampleProfile(index.demoProfile);
        await saveMeta('demoProfile', index.demoProfile);
      }
      await saveMeta('corpusMeta', index.meta);

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
        const t = await loadPaperText(full.id);
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
    try {
      const method = await extractMethodWithProgress(full, { ...config, timeoutMs: 180000, maxAttempts: 3, signal: controller.signal }, (ev) => {
        setJobs((j) => ({ ...j, [paperId]: { paperId, stage: ev.stage, message: ev.message, status: 'running', attempts: ev.trace?.attempt ?? 0 } }));
        if (ev.trace) {
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
        setPendingDependents((d) => [...d.filter((x) => x.paperId !== paperId), { paperId, at: Date.now() }]);
        if (prev?.overrides?.length) {
          log(`  已保留该论文的 ${prev.overrides.length} 条人工修正（重新分析不会覆盖人工修正）`);
        }
      }

      const verified = FIELD_KEYS_ORDER.filter((k) => method.fields[k].evidence?.verified).length;
      const missing = FIELD_KEYS_ORDER.filter((k) => method.fields[k].status === 'missing').length;
      log(`  完成：${METHOD_FIELD_LABELS.researchTask}等 ${FIELD_KEYS_ORDER.length} 个字段，证据通过定位校验 ${verified} 个，缺失 ${missing} 个`);
      setJobs((j) => ({ ...j, [paperId]: { paperId, stage: 'done', message: '完成', status: 'done', attempts: 1 } }));

      await appendUsage({
        kind: 'extract',
        paperId,
        model: config.model,
        ms: Date.now() - t0,
        promptChars: full.charCount,
        completionChars: 0,
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

      await appendUsage({
        kind: 'extract',
        paperId,
        model: config.model,
        ms: Date.now() - t0,
        promptChars: full.charCount,
        completionChars: 0,
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
    const next: Method = {
      ...m,
      overrides: [
        ...m.overrides.filter((o) => o.field !== field),
        { field, previousValue: m.fields[field].value, newValue: value, at: Date.now() },
      ],
    };
    await repo.saveMethod(next);
    setMethods((ms) => ms.map((x) => (x.paperId === paperId ? next : x)));
    log(`人工修正：${METHOD_FIELD_LABELS[field]} 已更新（AI 原值已保留在修正记录中）`);
  };

  /* ---------- 关系与路线 ---------- */
  const genRelations = async () => {
    if (!modelReady) {
      log('关系分析中止：未配置模型接口。');
      return;
    }
    const usable = methods.map((m) => {
      const p = papers.find((x) => x.id === m.paperId);
      return p && p.rawText ? { m, p } : undefined;
    });
    const ready = usable.filter(Boolean) as { m: Method; p: Paper }[];
    if (ready.length < 2) {
      log('关系分析中止：需要至少 2 篇有全文的论文。');
      return;
    }
    log(`分析方法关系（${ready.length} 篇）…`);
    try {
      const { relations: rels, issues } = await inferRelations(
        ready.map((x) => x.p),
        ready.map((x) => x.m),
        { ...config, timeoutMs: 180000 },
        (t) => log(`  模型调用 ${t.label}：${t.ms}ms${t.error ? '，错误：' + t.error : ''}`),
      );
      await repo.clearRelations();
      for (const r of rels) await repo.saveRelation(r);
      setRelations(rels);
      const cnt = (s: string) => rels.filter((r) => r.evidenceState === s).length;
      log(
        `  完成：${rels.length} 条关系（原文明示 ${cnt('explicit')}，系统推断 ${cnt('inferred')}，待核查 ${cnt('candidate')}）；程序校验问题 ${issues.length} 条`,
      );
      for (const i of issues) log(`    · ${i.message}`);
      await appendUsage({ kind: 'relations', model: config.model, ms: 0, promptChars: 0, completionChars: 0, ok: true });
      await refreshUsage();
    } catch (e) {
      log(`关系分析失败：${MODEL_ERROR_HINT(e)}`);
    }
  };

  /* ---------- 方法决策 ---------- */
  const genDecision = async (profile: UserProfile) => {
    if (!modelReady) {
      log('方法决策中止：未配置模型接口。');
      return;
    }
    const ready = methods.filter((m) => papers.some((p) => p.id === m.paperId));
    if (!ready.length) {
      log('方法决策中止：没有可用的论文分析结果。');
      return;
    }
    log(`生成方法决策（条件：${profile.compute || '未填写'} / ${profile.time || '未填写'}）…`);
    try {
      const p = await generateDecision(papers, ready, profile, { ...config, timeoutMs: 180000 }, (t) =>
        log(`  模型调用 ${t.label}：${t.ms}ms${t.error ? '，错误：' + t.error : ''}`),
      );
      setPlan(p);
      log(`  完成：候选 ${p.candidates?.length ?? 0} 个，阅读顺序 ${p.steps.length} 步`);
      if (p.conditionSensitivity) log(`  条件敏感性：${p.conditionSensitivity}`);
      await appendUsage({ kind: 'plan', model: config.model, ms: 0, promptChars: 0, completionChars: 0, ok: true });
      await refreshUsage();
    } catch (e) {
      log(`方法决策失败：${MODEL_ERROR_HINT(e)}`);
    }
  };

  /* ---------- 分歧分析 ---------- */
  const genDivergence = async () => {
    if (!modelReady) {
      log('分歧分析中止：未配置模型接口。');
      return;
    }
    const ready = methods.filter((m) => papers.some((p) => p.id === m.paperId));
    if (ready.length < 2) {
      log('分歧分析中止：需要至少 2 篇已完成抽取的论文。');
      return;
    }
    log(`分析跨论文分歧（${ready.length} 篇）…`);
    try {
      const rep = await findDivergences(papers, ready, { ...config, timeoutMs: 180000 }, (t) =>
        log(`  模型调用 ${t.label}：${t.ms}ms${t.error ? '，错误：' + t.error : ''}`),
      );
      setDivergence(rep);
      await saveMeta('divergence', rep);
      for (const f of rep.findings) {
        log(`  · [${DIVERGENCE_LABELS[f.kind]}] ${f.topic}（可比性 ${f.comparabilityLevel}）`);
      }
      await appendUsage({ kind: 'divergence', model: config.model, ms: 0, promptChars: 0, completionChars: 0, ok: true });
      await refreshUsage();
    } catch (e) {
      log(`分歧分析失败：${MODEL_ERROR_HINT(e)}`);
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
        const t = await loadPaperText(target.id);
        target = hydratePaper(target, t);
        setPapers((ps) => ps.map((p) => (p.id === target!.id ? target! : p)));
      } catch (err) {
        log(`证据上下文加载失败：${(err as Error).message}`);
      }
    }
    setEvidence({ e, label, paper: target });
  };

  const capabilities = useMemo(
    () => capabilitiesList({ hasBackend: false, deployStatic: true, modelReachable: true }),
    [],
  );

  return (
    <div className="app">
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
              <strong>有论文的结果已更新，以下内容需要重新生成或复核：</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {describeDependents(
                  pendingDependents.map((d) => papers.find((p) => p.id === d.paperId)?.title?.slice(0, 30) ?? d.paperId).join('、'),
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
              papers={scope.presetPapers.concat(scope.ownPapers)}
              methods={scope.presetMethods.concat(scope.ownMethods)}
              relations={scopedRelations}
              scope={scope}
              corpusLoading={corpusLoading}
              plan={plan}
              questions={(divergence?.findings ?? []).map((f) => {
                const withQuote = f.sides.find((x) => x.quote && x.paperId);
                return {
                  id: f.id,
                  text: f.topic || f.explanation.slice(0, 60),
                  basis: [f.commonScope ? `共同范围：${f.commonScope}` : '', f.explanation].filter(Boolean).join('　'),
                  evidence: withQuote
                    ? [
                        {
                          paperId: withQuote.paperId,
                          quote: withQuote.quote as string,
                          page: withQuote.page,
                          locator: 'page',
                          verified: true,
                        } as Evidence,
                      ]
                    : undefined,
                };
              })}
              modelReady={modelReady}
              busy={false}
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
              methods={methods}
              jobs={jobs}
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
              papers={papers}
              methods={methods}
              relations={relations}
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
              papers={scope.presetPapers.concat(scope.ownPapers)}
              methods={scope.presetMethods.concat(scope.ownMethods)}
              relations={scopedRelations}
              onGenerate={genRelations}
              onOpenEvidence={openEvidence}
              busy={false}
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
              papers={papers}
              methods={methods}
              plan={plan}
              busy={false}
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
              papers={papers}
              methods={methods}
              staleNotes={staleNotes}
              report={divergence}
              busy={false}
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
              papers={papers}
              methods={methods}
              usage={usage}
              capabilities={capabilities}
              corpusMeta={corpusMeta}
              relationCounts={{
                explicit: relations.filter((r) => r.evidenceState === 'explicit').length,
                inferred: relations.filter((r) => r.evidenceState === 'inferred').length,
                candidate: relations.filter((r) => r.evidenceState === 'candidate').length,
                userEdited: relations.filter((r) => r.userEdited).length,
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
