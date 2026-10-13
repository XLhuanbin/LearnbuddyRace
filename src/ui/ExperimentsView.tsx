import React, { useEffect, useMemo, useState } from 'react';
import type { Evidence, ExperimentConditionSupplement, ExperimentRecord, Method, Paper } from '../core/types';
import type { CorpusKey, CorpusScope } from '../core/corpus';
import { Crumb, Status, Tag, downloadText } from './common';
import {
  EXPERIMENT_LEVEL_LABELS,
  EXPERIMENT_LEVEL_ORDER,
  MATRIX_FIELDS,
  analyzeExperimentComparability,
  canonicalDatasetName,
  canonicalMetricName,
  canonicalMetricUnit,
  canonicalResolution,
  canonicalSplit,
  effectiveExperimentRecords,
  experimentIdentityKey,
  groupKeyString,
  groupKeyOf,
  isUnknownValue,
  parseMetricValue,
  supplementedDims,
  type ExperimentComparison,
  type ExperimentLevel,
  type ExperimentPairVerdict,
} from '../core/experiments';
import { DraftIcon } from '../draft-icons';

/**
 * 实验可比性审查（2026-10-13 重构版）。
 *
 * === 本页直接回答的问题 ===
 * **哪些实验可以比较、为什么。** 主结果是**实验对**级别的四类结论：
 *   ① 已知条件下可直接比较　② 只能结合条件讨论　③ 信息不足　④ 不能直接比较
 * 每个结论都同时给出「关键差异 / 未知项 / 阻断项」。单条记录的「条件完整」只是辅助状态，
 * **不再**用它冒充可比性结论。
 *
 * === 与旧版的关键区别（旧版的缺陷）===
 * 旧版主要判断「单条记录是否填满 8 个字段」，于是两条条件完全不同的实验也可能同时显示「条件完整」，
 * 而「能不能一起比」这个真正的问题没有答案；同时页面把「点一下勾选已核对」当成「该条件已知」，
 * 比较引擎却仍在读未知原值 —— 页面与引擎结论相反（已复现）。
 * 现在：判断统一走 `core/experiments.ts` 的比较引擎（与比较页、报告、导出同一套），
 * 人工「已核对」只是标注，要让未知条件变成已知必须补充**具体值与来源**。
 *
 * === 真实性边界（沿用项目铁律）===
 * - 不做排名、不给「某种架构本身更优」的因果结论；
 * - 数值一律照实展示原始写法与单位；条形图只在**已确认同口径**的对照之间出现，并标注尺度与指标方向；
 * - 计数对象说清楚：**论文 / 实验记录 / 实验对**各不相同，不混用；
 * - 「未知」不会被算成「一致」，缺核验元数据也不会被默认通过。
 */

type Side = 'a' | 'b';

interface SupplementArgs {
  paperId: string;
  expId: string;
  dim: string;
  action: 'set' | 'clear' | 'toggle-checked';
  value?: string;
  source?: string;
  quote?: string;
  checked?: boolean;
}

interface Props {
  papers: Paper[];
  methods: Method[];
  onOpenEvidence: (ev: Evidence) => void;
  onGo?: (tab: 'library' | 'upload' | 'map') => void;
  onLoadSample?: () => void;
  scope: CorpusScope;
  /** 当前范围身份 key（模式 + 语料 + 论文集合 + 方法集合）；变化时复位本页的筛选/展开状态 */
  scopeKey?: string;
  corpusLoading: CorpusKey | null;
  loadResult?: { key: CorpusKey; ok: boolean; papers: number; experiments: number; relations: number; message: string; at: number };
  focusPaper?: string | null;
  cacheStats?: { papers: number; experiments: number; at: number } | null;
  onSwitchToVision?: () => void;
  visionStats?: { papers: number; experiments: number; at: number } | null;
  /** 人工操作：补充具体值 / 撤销 / 仅标记已核对（后两者不参与判定） */
  onSupplementCondition: (args: SupplementArgs) => Promise<{ ok: boolean; error?: string }>;
}

const LEVEL_TAG: Record<ExperimentLevel, string> = {
  directly_comparable: 'ok',
  comparable_with_conditions: 'warn',
  insufficient_info: 'info',
  not_comparable: 'bad',
};

/** 四类结论各一句话的解释（首屏与分区标题都用它，避免用户猜） */
const LEVEL_HINT: Record<ExperimentLevel, string> = {
  directly_comparable: '关键条件都已记录、取值一致，且数值的行列对应已核验：可以在同一口径下对照读数。',
  comparable_with_conditions: '主口径一致但条件有差异（或单位需换算）：只能把条件一起说明后再讨论。',
  insufficient_info: '有关键条件没有记录：既不能认定一致，也不能认定不同，需要先补信息。',
  not_comparable: '任务 / 评估数据集 / 指标口径不同：数值本身不在同一个尺度上，不能直接比。',
};

const modelOf = (e: ExperimentRecord) => e.modelVariant || '未命名模型';
const dimRaw = (e: ExperimentRecord, dim: string): string =>
  String((e as unknown as Record<string, unknown>)[dim] ?? '').trim();
/** 该维度在展示时用的规范写法（与比较引擎一致） */
function dimDisplay(e: ExperimentRecord, dim: string): string {
  const f = MATRIX_FIELDS.find((x) => String(x.field) === dim);
  const raw = dimRaw(e, dim);
  if (!raw) return '';
  return f?.canonicalize ? f.canonicalize(raw) : raw;
}
/** 指标方向只做阅读提示，不参与任何判断 */
function metricDirection(name: string): 'lower' | 'higher' | null {
  if (/(^|[^a-z])err(\.|$|[^a-z])/i.test(name) || /error|loss|perplexity|wer|fer|错误率|损失|困惑/i.test(name)) return 'lower';
  if (/acc|top-?1|top-?5|precision|recall|f1|iou|mAP|AP|准确|得分|score/i.test(name)) return 'higher';
  return null;
}

/** 判定单条记录的某个条件维度属于哪一类：已知 / 未知 / 人工补充 / 已核对标记 */
type DimState = 'known' | 'unknown' | 'supplemented' | 'checked';
function dimState(e: ExperimentRecord, dim: string): DimState {
  const sups = supplementedDims(e);
  if (sups.has(dim)) return 'supplemented';
  const raw = dimRaw(e, dim);
  if (!isUnknownValue(raw)) return 'known';
  if (e.userSupplemented?.includes(dim)) return 'checked';
  return 'unknown';
}

export function ExperimentsView({
  papers,
  methods,
  onOpenEvidence,
  onGo,
  onLoadSample,
  scope,
  scopeKey,
  corpusLoading,
  loadResult,
  focusPaper,
  cacheStats,
  onSwitchToVision,
  visionStats,
  onSupplementCondition,
}: Props) {
  /* ---------------- 页面本地状态 ---------------- */
  const [excludedModels, setExcludedModels] = useState<Set<string>>(new Set());
  const [showAllModels, setShowAllModels] = useState(false);
  const [paperOnly, setPaperOnly] = useState<string | null>(focusPaper ?? null);
  const [levelFilter, setLevelFilter] = useState<ExperimentLevel | 'all'>('all');
  const [openPairs, setOpenPairs] = useState<Set<string>>(new Set());
  const [showAllPairs, setShowAllPairs] = useState(false);
  /** 补充表单草稿：`${pairId}|${side}|${dim}` → 输入内容（与提交结果分开，避免旧草稿显示成新结果） */
  const [supDraft, setSupDraft] = useState<Record<string, { value: string; source: string; quote: string }>>({});
  const [supMsg, setSupMsg] = useState<{ key: string; ok: boolean; text: string } | null>(null);

  const rangeKey = scopeKey ?? scope.key;
  useEffect(() => {
    /**
     * 范围身份变化（切 case/own、切语料、增删论文）后，本页的筛选、展开、补充草稿**全部复位**。
     * 旧实现只按 corpusId 复位，于是 case ↔ own 切换后「排除模型 / 展开项 / 聚焦论文」
     * 还挂着另一个范围的对象 ID，界面显示的筛选与真实数据不匹配。
     */
    setExcludedModels(new Set());
    setPaperOnly(focusPaper ?? null);
    setLevelFilter('all');
    setOpenPairs(new Set());
    setShowAllPairs(false);
    setSupDraft({});
    setSupMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  useEffect(() => {
    if (focusPaper) setPaperOnly(focusPaper);
  }, [focusPaper]);

  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const methodById = useMemo(() => new Map(methods.map((m) => [m.id, m])), [methods]);
  const methodOfRecord = (e: ExperimentRecord): Method | undefined =>
    (e.methodId ? methodById.get(e.methodId) : undefined) ?? methods.find((m) => m.paperId === e.paperId);
  const paperTitle = (paperId: string) => paperById.get(paperId)?.title ?? paperId;

  const loading = corpusLoading === scope.key;

  /** 当前范围内**全部**实验记录（含被排除的），用于如实说明被排除了多少 */
  const allRecords = useMemo(
    () => scope.methods.flatMap((m) => effectiveExperimentRecords(m.experiments ?? [])),
    [scope.methods],
  );
  /** 参与本页判定与展示的记录：应用人工补充值，并排除用户手动排除的模型 */
  const records = useMemo(() => {
    const inRange = allRecords.filter((e) => !excludedModels.has(modelOf(e)));
    return paperOnly ? inRange.filter((e) => e.paperId === paperOnly) : inRange;
  }, [allRecords, excludedModels, paperOnly]);

  const modelCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of allRecords) m.set(modelOf(e), (m.get(modelOf(e)) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [allRecords]);

  /* ---------------- 核心：成对判定 ---------------- */
  const analysis = useMemo(() => analyzeExperimentComparability(records), [records]);
  const levelCount = (lv: ExperimentLevel) => analysis.byLevel[lv].length;

  /** 排序：结论优先级 → 未知项少的在前（更接近「能判定」）→ 稳定次序 */
  const rank: Record<ExperimentLevel, number> = {
    directly_comparable: 0,
    comparable_with_conditions: 1,
    insufficient_info: 2,
    not_comparable: 3,
  };
  const sortedPairs = useMemo(
    () =>
      [...analysis.pairs].sort(
        (x, y) =>
          rank[x.cmp.level] - rank[y.cmp.level] ||
          x.cmp.unknowns.length - y.cmp.unknowns.length ||
          x.a.id.localeCompare(y.a.id) ||
          x.b.id.localeCompare(y.b.id),
      ),
    // rank 是常量表，不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analysis],
  );
  const visiblePairs = levelFilter === 'all' ? sortedPairs : sortedPairs.filter((p) => p.cmp.level === levelFilter);
  const cappedPairs = showAllPairs ? visiblePairs : visiblePairs.slice(0, 8);

  /** 信息不足的「主要缺口」：按出现次数排出最值得先补的条件 */
  const topMissing = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of analysis.byLevel.insufficient_info) for (const u of p.cmp.unknowns) c.set(u.label, (c.get(u.label) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [analysis]);

  /* ---------------- 概况句：首屏直接回答「能不能比」 ---------------- */
  const summary = useMemo(() => {
    const { paperCount, recordCount, pairCount } = analysis;
    if (!recordCount) return '';
    const head = `当前范围共 ${paperCount} 篇论文、${recordCount} 条实验记录，两两组合 ${pairCount} 个实验对：`;
    const parts = EXPERIMENT_LEVEL_ORDER.map((lv) => `${levelCount(lv)} 对${EXPERIMENT_LEVEL_LABELS[lv]}`).join('、');
    const tail = topMissing.length
      ? ` 信息不足主要卡在：${topMissing.map(([label, n]) => `${label}（${n} 对）`).join('、')} —— 补上这些条件能解锁最多比较。`
      : '';
    return head + parts + '。' + tail;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, topMissing]);

  /* ---------------- 人工补充 ---------------- */
  const doSupplement = async (e: ExperimentRecord, dim: string, action: SupplementArgs['action'], extra?: { value?: string; source?: string; quote?: string; checked?: boolean }) => {
    const key = `${e.id}|${dim}`;
    const r = await onSupplementCondition({
      paperId: e.paperId,
      expId: e.id,
      dim,
      action,
      ...extra,
    });
    setSupMsg({ key, ok: r.ok, text: r.ok ? '已保存到本机（人工声明，不是原文核验结果）' : r.error ?? '保存失败' });
    if (r.ok) {
      setSupDraft((cur) => {
        const next = { ...cur };
        delete next[key];
        return next;
      });
    }
  };

  const exportReport = () => {
    const dir = '（不做排名；数值必须回到原文核对）';
    const lines: string[] = [
      '# 实验可比性审查（ResearchPilot 导出）',
      '',
      `生成时间：${new Date().toLocaleString('zh-CN')}`,
      `范围：${scope.mode === 'own' ? '我上传的论文' : scope.meta.label}（${scope.mode === 'own' ? 'own' : 'case'} 模式）`,
      paperOnly ? `聚焦论文：${paperTitle(paperOnly)}` : '聚焦论文：无（全部）',
      excludedModels.size ? `已排除模型：${[...excludedModels].join('、')}` : '已排除模型：无',
      '',
      `计数对象：论文 ${analysis.paperCount} 篇；实验记录 ${analysis.recordCount} 条；实验对 ${analysis.pairCount} 个。`,
      `结论分布（按**实验对**计）：${EXPERIMENT_LEVEL_ORDER.map((lv) => `${EXPERIMENT_LEVEL_LABELS[lv]} ${levelCount(lv)} 对`).join('；')}。`,
      '',
      '## 结论对照表',
      '',
      '| 实验 A | 实验 B | 评估口径 | 原始结果 | 比较结论 | 主要原因 |',
      '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const p of visiblePairs) {
      const caliber = (e: ExperimentRecord) =>
        `${canonicalDatasetName(e.evalDataset).canonical ?? '未知数据集'} / ${canonicalSplit(e.evalSplit)} / ${canonicalMetricName(e.metricName)}${(canonicalMetricUnit(e.metricUnit) !== 'unknown' ? ` (${canonicalMetricUnit(e.metricUnit)})` : '')}`;
      const val = (e: ExperimentRecord) => `${e.metricValue || '缺'}${e.metricUnit && !isUnknownValue(e.metricUnit) ? e.metricUnit : ''}`;
      const reason =
        p.cmp.blocked[0]?.label
          ? `阻断：${p.cmp.blocked.map((b) => b.label).join('、')}`
          : p.cmp.unknowns.length
            ? `未知：${p.cmp.unknowns.map((u) => u.label).join('、')}`
            : p.cmp.differences.length
              ? `条件差异：${p.cmp.differences.map((d) => d.label).join('、')}`
              : '无';
      lines.push(
        `| ${modelOf(p.a)}（${paperTitle(p.a.paperId).slice(0, 24)}） | ${modelOf(p.b)}（${paperTitle(p.b.paperId).slice(0, 24)}） | ${caliber(p.a)} ↔ ${caliber(p.b)} | ${val(p.a)} ↔ ${val(p.b)} | ${EXPERIMENT_LEVEL_LABELS[p.cmp.level]} | ${reason} |`,
      );
    }
    lines.push('', '## 说明与边界', '');
    lines.push('- 每条结论都只看「记录下来的条件是否一致」，不评价方法优劣，也不排名。');
    lines.push('- 「未知」不等于「一致」：任一方条件未记录时不会判为可直接比较；缺核验元数据也不会默认通过。');
    lines.push('- 人工补充的值是人工声明，不是原文核验结果，导出中与模型抽取值分开看待。');
    lines.push(`- 完整逐对理由见页面展开层；本文件与页面使用同一个比较引擎。${dir}`);
    for (const p of visiblePairs.slice(0, 200)) {
      lines.push('', `### ${modelOf(p.a)} × ${modelOf(p.b)} — ${EXPERIMENT_LEVEL_LABELS[p.cmp.level]}`);
      for (const r of p.cmp.reasons) lines.push(`- ${r}`);
      if (p.cmp.caveats.length) lines.push(`- 注意：${p.cmp.caveats.join('；')}`);
      lines.push(`- ${p.cmp.disclaimer}`);
    }
    downloadText('researchpilot-实验可比性.md', lines.join('\n'), 'text/markdown');
  };

  /* ---------------- 空状态：own 无论文时给上传入口 ---------------- */
  if (!allRecords.length) {
    const ownEmpty = scope.mode === 'own' && scope.papers.length === 0;
    const hasPapers = scope.papers.length > 0;
    const cacheKnown = Boolean(cacheStats);
    const cacheHasExperiments = (cacheStats?.experiments ?? 0) > 0;
    const canSwitchToVision = scope.key !== 'vision' && Boolean(onSwitchToVision);
    return (
      <div className="exppage sdpage">
        <Crumb
          trail={[{ label: '论文集合', on: () => onGo?.('library') }, { label: scope.meta.domain || scope.meta.label }, { label: '实验可比性审查' }]}
        />
        <section className="mb-10">
          <h1 className="text-4xl font-serif font-bold text-slate-900 mb-3">实验可比性审查</h1>
          <p className="text-[var(--fg-2)] text-lg">这是一个条件检查工具，不是排行榜。帮助你判断实验结果是否可以公平比较。</p>
        </section>

        <div className="grid grid-cols-12 gap-8 mb-12">
          <div className="col-span-12 lg:col-span-9">
            <div className="content-card bg-[var(--bg-3)] border-none p-8 flex items-center justify-between gap-6 flex-wrap">
              <div className="flex gap-16 flex-wrap">
                <div>
                  <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1">当前范围</p>
                  <p className="text-lg font-bold">{scope.mode === 'own' ? '我上传的论文' : scope.meta.label}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1">论文</p>
                  <p className="text-lg font-bold">{scope.papers.length} 篇</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1">实验记录</p>
                  <p className="text-lg font-bold">0 条</p>
                </div>
                {loading && <Status kind="info">正在加载…</Status>}
              </div>
            </div>
          </div>
        </div>

        <div className="content-card bg-white p-8">
          <p className="text-sm text-[var(--fg-2)]" style={{ margin: '0 0 10px' }}>
            {ownEmpty
              ? '「我上传的论文」范围里还没有论文，所以没有可比对的实验记录。先上传 PDF 并完成方法提取，这里就会出现实验记录之间的口径比较。'
              : scope.mode === 'own'
                ? `「我上传的论文」范围里有 ${scope.papers.length} 篇论文，但还没有实验记录，因此没有可比对的内容。实验记录来自「方法提取」——若尚未配置模型接口，抽取不会执行（解析成功 ≠ 分析成功）；可以先补充上传，或回论文集合完成方法提取。`
                : cacheKnown && !cacheHasExperiments
                ? `这份语料（${scope.meta.label}）的预置缓存里没有实验记录（已实际加载核对：${cacheStats?.papers ?? 0} 篇论文、0 条实验记录），重新加载也不会多出来。这一页只比较「一条实验记录」之间的口径，没有记录就没有可比内容。`
                : hasPapers
                  ? '论文已加载，但当前范围还没有实验记录。可以重新加载本语料的预置缓存来补齐（不会重复添加论文）。'
                  : '还没有加载本语料的预置缓存。加载后能看到这份语料实际包含什么——有些开发回归样例本来就不含实验记录，那时这里不会有可比内容。'}
          </p>
          {cacheKnown && !cacheHasExperiments && visionStats && visionStats.experiments > 0 && (
            <p className="text-sm text-[var(--fg-3)]" style={{ margin: '0 0 10px' }}>
              视觉方法演进案例的预置缓存里有 <strong>{visionStats.papers} 篇论文、{visionStats.experiments} 条实验记录</strong>，要比较实验口径请切回那个案例。
            </p>
          )}
          <div className="flex gap-3 flex-wrap">
            {/*
              own 范围（无论有没有论文）都必须给上传入口：
              这一页没有可比内容时，用户唯一的下一步就是「补数据」——上传更多论文，或回论文集合做方法提取。
              旧实现只在 ownEmpty（0 篇论文）时给入口，于是「上传过但没抽出实验记录」的用户在这一页看不到出路。
            */}
            {(ownEmpty || scope.mode === 'own') && (
              <button className="btn-primary" onClick={() => onGo?.('upload')}>
                {ownEmpty ? '去上传论文' : '继续上传论文'}
              </button>
            )}
            {/*
              换语料的入口必须一直在（本条是既有验收断言：其他语料没有实验记录时，要给出通向有记录的案例的路）。
              - 已确认过预置缓存里有实验记录 → 主按钮，并写明确切数量（不夸大：数量来自实际加载核对）；
              - 还没核对过 → 次按钮，只写「切回视觉方法演进案例」，不做「有实验记录」的断言。
            */}
            {canSwitchToVision && cacheKnown && !cacheHasExperiments ? (
              <button className="btn-primary" onClick={() => onSwitchToVision?.()} disabled={loading}>
                切回视觉方法演进案例{visionStats?.experiments ? `（有实验记录：${visionStats.experiments} 条）` : ''}
              </button>
            ) : canSwitchToVision ? (
              <button className="btn-ghost border border-slate-300 text-xs font-bold" onClick={() => onSwitchToVision?.()} disabled={loading}>
                切回视觉方法演进案例
              </button>
            ) : null}
            {scope.mode === 'case' && hasPapers && (
              <button className="btn-ghost border border-slate-300 text-xs font-bold" onClick={() => onGo?.('upload')}>
                上传我自己的论文
              </button>
            )}
            <button className="btn-ghost border border-slate-300 text-xs font-bold" onClick={() => onGo?.('library')}>
              去论文集合查看论文
            </button>
            {scope.mode === 'case' && onLoadSample && (
              <button className="btn-ghost border border-slate-300 text-xs font-bold" onClick={() => onLoadSample?.()} disabled={loading}>
                {loading ? '正在加载…' : '重新加载案例'}
              </button>
            )}
          </div>
          {/*
            加载结果只在**案例模式**显示：它是「加载预置缓存」这件事的回执，
            own 范围里显示它会把「已加载 5 篇论文、23 条实验记录」写在「我上传的论文」下面，
            看起来像是自己上传的论文有 23 条实验记录（已复现的误导）。
          */}
          {loadResult && scope.mode === 'case' && (
            <div className="flex items-center gap-3 mt-4">
              <Status kind={loadResult.ok ? 'ok' : 'bad'}>{loadResult.ok ? '上次加载完成' : '上次加载失败'}</Status>
              <span className="text-xs text-[var(--fg-3)]">{loadResult.message}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ---------------- 主视图 ---------------- */
  return (
    <div className="exppage sdpage">
      <Crumb
        trail={[{ label: '论文集合', on: () => onGo?.('library') }, { label: scope.meta.domain || scope.meta.label }, { label: '实验可比性审查' }]}
      />

      {/* ① 首屏：这一页直接回答「哪些实验能比」 */}
      <section className="mb-8">
        <h1 className="text-4xl font-serif font-bold text-slate-900 mb-2">实验可比性审查</h1>
        <p className="text-[var(--fg-2)] text-lg" style={{ marginBottom: 6 }}>
          这是一个条件检查工具，不是排行榜。它回答的是：<strong>这些实验记录哪些能放在一起比、为什么。</strong>
        </p>
        <p className="text-[var(--fg-3)] text-sm">
          本页<strong>不做排名</strong>，也不给「某种架构本身更优」之类的<strong>因果结论</strong>；只看「记录下来的条件是否一致」。
          「未知」不会被算成「一致」。
        </p>
      </section>

      {/* ② 当前范围与计数（三类计数对象分开写清楚） */}
      <div className="grid grid-cols-12 gap-6 mb-6">
        <div className="col-span-12 lg:col-span-9">
          <div className="content-card bg-[var(--bg-3)] border-none p-6">
            <div className="flex gap-10 flex-wrap">
              <div>
                <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1">当前范围</p>
                <p className="text-base font-bold">
                  {scope.mode === 'own' ? '我上传的论文' : scope.meta.label}
                  {paperOnly && <span className="text-sm font-normal text-[var(--fg-3)]">（聚焦：{paperTitle(paperOnly).slice(0, 24)}）</span>}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1">论文</p>
                <p className="text-base font-bold">{analysis.paperCount} 篇</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1">实验记录</p>
                <p className="text-base font-bold">{analysis.recordCount} 条</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1" title="两两组合：这是本页结论的计数对象">
                  实验对（结论对象）
                </p>
                <p className="text-base font-bold text-[var(--accent)]">{analysis.pairCount} 个</p>
              </div>
              {excludedModels.size > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1">已排除模型</p>
                  <p className="text-base font-bold">{allRecords.length - records.length} 条记录</p>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-3">
          <div className="content-card p-5 bg-white">
            <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-3" title="点 × 排除一个模型变体，再点一次恢复">
              快速状态（点 × 排除）
            </p>
            <div className="flex flex-wrap gap-2">
              {(showAllModels ? modelCounts : modelCounts.slice(0, 3)).map(([m]) => (
                <span key={m} className="tag-model">
                  {m}
                  <button
                    className="cursor-pointer hover:text-red-500"
                    aria-label={excludedModels.has(m) ? `恢复 ${m}` : `排除 ${m}`}
                    onClick={() =>
                      setExcludedModels((cur) => {
                        const next = new Set(cur);
                        if (next.has(m)) next.delete(m);
                        else next.add(m);
                        return next;
                      })
                    }
                  >
                    <DraftIcon name={excludedModels.has(m) ? 'refresh-cw' : 'x'} />
                  </button>
                </span>
              ))}
              {modelCounts.length > 3 && (
                <button className="tag-model cursor-pointer" onClick={() => setShowAllModels((v) => !v)}>
                  {showAllModels ? '收起' : `+${modelCounts.length - 3} 更多`}
                </button>
              )}
              {!modelCounts.length && <span className="text-xs text-[var(--fg-3)]">还没有模型变体</span>}
            </div>
            {paperOnly && (
              <button className="btn-ghost text-xs border border-slate-300 mt-3 w-full" onClick={() => setPaperOnly(null)}>
                取消聚焦（查看全部论文）
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ③ 一句可比性概况 + 下一步 */}
      <div className="content-card bg-white p-6 mb-8">
        <p className="text-[15px] leading-relaxed" style={{ margin: 0 }}>
          <strong>概况：</strong>
          {summary}
        </p>
        {topMissing.length > 0 && (
          <p className="text-xs text-[var(--fg-3)] mt-3" style={{ margin: 0 }}>
            下一步：先看下面「不能直接比较」里有没有你关心的实验对（那是口径不同，补信息也没用）；
            若关心的对都落在「信息不足」，就在展开层里按提示补上具体条件值与来源。
          </p>
        )}
      </div>

      {/* ④ 四类结论分区（计数 + 解释；点开看具体实验对） */}
      <div className="grid grid-cols-12 gap-4 mb-8">
        {EXPERIMENT_LEVEL_ORDER.map((lv) => (
          <button
            key={lv}
            className={`col-span-12 sm:col-span-6 lg:col-span-3 content-card bg-white p-5 text-left ${levelFilter === lv ? 'ring-2 ring-[var(--accent)]' : ''}`}
            onClick={() => {
              setLevelFilter(levelFilter === lv ? 'all' : lv);
              setShowAllPairs(false);
            }}
            aria-pressed={levelFilter === lv}
          >
            <div className="flex items-center justify-between mb-2">
              <Tag kind={LEVEL_TAG[lv]}>{EXPERIMENT_LEVEL_LABELS[lv]}</Tag>
              <span className="text-2xl font-bold">{levelCount(lv)}</span>
            </div>
            <p className="text-xs text-[var(--fg-3)]" style={{ margin: 0 }}>
              {levelCount(lv)} 个实验对。{LEVEL_HINT[lv]}
            </p>
          </button>
        ))}
      </div>

      {/* ⑤ 主表：模型/实验、评估口径、原始结果、比较结论、主要原因 */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h2 className="text-xl font-serif font-bold" style={{ margin: 0 }}>
          {levelFilter === 'all' ? '优先查看的实验对' : `实验对：${EXPERIMENT_LEVEL_LABELS[levelFilter]}`}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {levelFilter !== 'all' && (
            <button className="btn-ghost text-xs border border-slate-300" onClick={() => setLevelFilter('all')}>
              显示全部四类
            </button>
          )}
          <button className="btn-ghost text-xs border border-slate-300" onClick={exportReport}>
            <DraftIcon name="download" />
            <span className="ml-2">导出本视图（.md）</span>
          </button>
          {scope.mode === 'case' && onLoadSample && (
            <button className="btn-ghost text-xs border border-slate-300" onClick={() => onLoadSample?.()} disabled={loading}>
              <DraftIcon name="refresh-cw" />
              <span className="ml-2">{loading ? '正在加载…' : '重新加载案例'}</span>
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--fg-3)] mb-4">
        排序：结论越接近「可判定」越靠前（可直接比较 → 只能结合条件讨论 → 信息不足 → 不能直接比较）；同档内未知项少的在前。
        共 {visiblePairs.length} 个实验对，当前显示 {cappedPairs.length} 个。
      </p>

      {visiblePairs.length === 0 ? (
        <div className="content-card bg-white p-6 text-sm text-[var(--fg-2)]">
          {analysis.recordCount < 2
            ? `当前范围只有 ${analysis.recordCount} 条实验记录，构不成实验对（至少需要 2 条才能回答「能不能比」）。`
            : `这一类目前没有实验对。`}
        </div>
      ) : (
        <div className="space-y-4">
          {cappedPairs.map((p) => (
            <PairCard
              key={`${p.a.id}__${p.b.id}`}
              pair={p}
              open={openPairs.has(`${p.a.id}__${p.b.id}`)}
              onToggle={() =>
                setOpenPairs((cur) => {
                  const next = new Set(cur);
                  const k = `${p.a.id}__${p.b.id}`;
                  if (next.has(k)) next.delete(k);
                  else next.add(k);
                  return next;
                })
              }
              paperTitle={paperTitle}
              methodOfRecord={methodOfRecord}
              onOpenEvidence={onOpenEvidence}
              supDraft={supDraft}
              setSupDraft={setSupDraft}
              supMsg={supMsg}
              doSupplement={doSupplement}
            />
          ))}
          {visiblePairs.length > cappedPairs.length && (
            <button className="btn-ghost border border-slate-300 text-xs font-bold" onClick={() => setShowAllPairs(true)}>
              展开剩余 {visiblePairs.length - cappedPairs.length} 个实验对
            </button>
          )}
        </div>
      )}

      {/* ⑥ 页脚：真实边界 */}
      <footer className="mt-16 border-t border-[var(--line)] py-10">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <p className="text-xs text-slate-400">
            © 2026 ResearchPilot · 数据仅保存在本机浏览器；人工补充的值是人工声明，不改变模型抽取值，也不是原文核验结果
          </p>
          <p className="text-xs text-slate-400">判定以当前范围（{scope.mode === 'own' ? '我上传的论文' : scope.meta.label}）的实验记录为准</p>
        </div>
      </footer>
    </div>
  );
}

/* ============================ 单个实验对卡片 ============================ */

function caliberLine(e: ExperimentRecord): string {
  const ds = canonicalDatasetName(e.evalDataset);
  const parts = [
    ds.canonical && ds.canonical !== 'unknown' ? ds.canonical : '数据集未知',
    canonicalSplit(e.evalSplit) === 'unknown' ? '划分未注明' : canonicalSplit(e.evalSplit),
    canonicalMetricName(e.metricName) === 'unknown' ? '指标未知' : canonicalMetricName(e.metricName),
    canonicalMetricUnit(e.metricUnit) === 'unknown' ? '单位未注明' : canonicalMetricUnit(e.metricUnit),
  ];
  return parts.join(' · ');
}

const rawValue = (e: ExperimentRecord): string =>
  `${e.metricValue || '（无数值）'}${e.metricUnit && !isUnknownValue(e.metricUnit) ? e.metricUnit : ''}`;

function PairCard({
  pair,
  open,
  onToggle,
  paperTitle,
  methodOfRecord,
  onOpenEvidence,
  supDraft,
  setSupDraft,
  supMsg,
  doSupplement,
}: {
  pair: ExperimentPairVerdict;
  open: boolean;
  onToggle: () => void;
  paperTitle: (paperId: string) => string;
  methodOfRecord: (e: ExperimentRecord) => Method | undefined;
  onOpenEvidence: (ev: Evidence) => void;
  supDraft: Record<string, { value: string; source: string; quote: string }>;
  setSupDraft: React.Dispatch<React.SetStateAction<Record<string, { value: string; source: string; quote: string }>>>;
  supMsg: { key: string; ok: boolean; text: string } | null;
  doSupplement: (e: ExperimentRecord, dim: string, action: SupplementArgs['action'], extra?: { value?: string; source?: string; quote?: string; checked?: boolean }) => Promise<void>;
}) {
  const { a, b, cmp, sameGroup } = pair;
  const sideName = (e: ExperimentRecord) => `${modelOf(e)}（${paperTitle(e.paperId).slice(0, 22)}）`;
  const numericComparable = cmp.level === 'directly_comparable' || cmp.level === 'comparable_with_conditions';
  const va = parseMetricValue(a.metricValue);
  const vb = parseMetricValue(b.metricValue);
  const canBar = cmp.level === 'directly_comparable' && va.kind === 'point' && vb.kind === 'point';
  const dir = metricDirection(canonicalMetricName(a.metricName));
  const barMax = canBar ? Math.max(va.kind === 'point' ? va.value : 0, vb.kind === 'point' ? vb.value : 0, 0.0001) : 0;

  /** 未知项按维度归并，便于在补充区一次列出双方分别缺什么 */
  const unknownDims = useMemo(() => {
    const set = new Map<string, { label: string; which: 'a' | 'b' | 'both'; hint?: string }>();
    for (const u of cmp.unknowns) set.set(u.field, { label: u.label, which: u.which, hint: u.hint });
    return [...set.entries()].map(([field, v]) => ({ field, ...v }));
  }, [cmp.unknowns]);

  return (
    <div className="content-card bg-white p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div style={{ flex: '1 1 420px' }}>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Tag kind={LEVEL_TAG[cmp.level]}>{EXPERIMENT_LEVEL_LABELS[cmp.level]}</Tag>
            {sameGroup ? <Tag kind="info">同一主口径组</Tag> : <Tag>主口径不同</Tag>}
            {cmp.blocked.length > 0 && <Tag kind="bad">阻断项 {cmp.blocked.length}</Tag>}
            {cmp.unknowns.length > 0 && <Tag kind="warn">未知项 {cmp.unknowns.length}</Tag>}
            {cmp.differences.length > 0 && <Tag>条件差异 {cmp.differences.length}</Tag>}
          </div>
          <p className="text-[15px] font-bold" style={{ margin: '0 0 4px' }}>
            {sideName(a)} <span className="text-[var(--fg-3)] font-normal">↔</span> {sideName(b)}
          </p>
          <p className="text-xs text-[var(--fg-3)]" style={{ margin: '0 0 8px' }}>
            评估口径：{caliberLine(a)} <span className="text-[var(--fg-3)]">↔</span> {caliberLine(b)}
          </p>
          {/* 数值：可比时才并排；不可比时也照实展示原始写法 + 单位，但**不**构成对照（避免视觉排名） */}
          <div className="text-sm">
            {numericComparable ? (
              <span>
                <strong>原始结果：</strong>
                {modelOf(a)} = {rawValue(a)}；{modelOf(b)} = {rawValue(b)}
                <span className="text-[var(--fg-3)]">（数值来自原文报告，本页不做排名）</span>
              </span>
            ) : (
              <span className="text-[var(--fg-3)]">
                <strong>原始报告值（仅供核对，不构成对照）：</strong>
                {modelOf(a)} = {rawValue(a)}；{modelOf(b)} = {rawValue(b)}
                <span>　当前结论为「{EXPERIMENT_LEVEL_LABELS[cmp.level]}」，把两个数字并排展示会造成「已经能比」的错觉。</span>
              </span>
            )}
          </div>
        </div>
        <button className="btn-ghost border border-slate-300 text-xs font-bold" onClick={onToggle} aria-expanded={open}>
          {open ? '收起条件矩阵与证据' : '展开条件矩阵与证据'}
        </button>
      </div>

      {/* 主要原因：前 3 条关键信息直接放在折叠外 */}
      <ul className="text-xs mt-3" style={{ margin: '10px 0 0', paddingLeft: 18, color: 'var(--fg-2)' }}>
        {[...cmp.reasons.slice(0, 3)].map((r, i) => (
          <li key={i}>{r}</li>
        ))}
        {cmp.reasons.length > 3 && <li className="text-[var(--fg-3)]">另有 {cmp.reasons.length - 3} 条说明，展开可见。</li>}
      </ul>

      {open && (
        <div className="mt-4" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          {/* 条件矩阵：逐维对比，明确标出「未知 / 人工补充 / 已核对」 */}
          <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-2">条件矩阵（逐维核对）</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-left text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead className="bg-[var(--bg-3)]">
                <tr>
                  <th className="px-3 py-2">条件</th>
                  <th className="px-3 py-2">{modelOf(a)}</th>
                  <th className="px-3 py-2">{modelOf(b)}</th>
                  <th className="px-3 py-2">判定</th>
                </tr>
              </thead>
              <tbody>
                {MATRIX_FIELDS.map((f) => {
                  const dim = String(f.field);
                  const sa = dimState(a, dim);
                  const sb = dimState(b, dim);
                  const da = dimDisplay(a, dim);
                  const db = dimDisplay(b, dim);
                  const unknownSide = sa === 'unknown' || sb === 'unknown';
                  const judged = unknownSide
                    ? '信息不足'
                    : da.toLowerCase() === db.toLowerCase()
                      ? '一致'
                      : '不同';
                  return (
                    <tr key={dim} className="border-t border-[var(--line)]">
                      <td className="px-3 py-2 font-bold">{f.label}</td>
                      <DimCell state={sa} raw={dimRaw(a, dim)} display={da} rec={a} dim={dim} />
                      <DimCell state={sb} raw={dimRaw(b, dim)} display={db} rec={b} dim={dim} />
                      <td className="px-3 py-2">
                        <Tag kind={judged === '一致' ? 'ok' : judged === '不同' ? 'bad' : 'info'}>{judged}</Tag>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 证据：每条记录的引文与定位状态 */}
          <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-2 mt-5">原文证据</p>
          <div className="grid grid-cols-12 gap-3">
            {[a, b].map((e) => {
              const m = methodOfRecord(e);
              const sup = supplementedDims(e);
              return (
                <div key={e.id} className="col-span-12 lg:col-span-6" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                  <p className="text-xs font-bold" style={{ margin: '0 0 4px' }}>
                    {modelOf(e)} · {e.metricName} {rawValue(e)}
                  </p>
                  {e.evidence ? (
                    <div>
                      <div className="text-xs" style={{ borderLeft: '3px solid var(--line)', paddingLeft: 8, color: 'var(--fg-2)' }}>
                        {e.evidence.quote}
                      </div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Tag kind={e.evidence.verified ? 'ok' : 'bad'}>
                          {e.evidence.verified ? `引文已定位${e.evidence.page ? `（p.${e.evidence.page}）` : ''}` : '引文未通过定位校验'}
                        </Tag>
                        {e.verification && (
                          <Tag kind={e.verification.rowColConfirmed ? 'ok' : 'warn'}>
                            {e.verification.rowColConfirmed ? '表格行列已核验' : '表格行列待核查'}
                          </Tag>
                        )}
                        <button className="btn-ghost text-xs border border-slate-300" onClick={() => onOpenEvidence(e.evidence!)}>
                          查看原文上下文
                        </button>
                      </div>
                      {e.evidence.verifyNote && <p className="text-xs text-[var(--fg-3)] mt-1">{e.evidence.verifyNote}</p>}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--fg-3)]">这条记录没有引文证据（模型未提供引文）。</p>
                  )}
                  {sup.size > 0 && (
                    <div className="mt-2 text-xs">
                      <Tag kind="info">含人工补充</Tag>
                      {[...sup.values()].map((s) => (
                        <div key={s.dimension} style={{ marginTop: 4 }}>
                          {MATRIX_FIELDS.find((x) => String(x.field) === s.dimension)?.label ?? s.dimension}：人工填「{s.value}」，
                          原 AI 值「{s.originalValue || '（空）'}」，来源：{s.source}（{new Date(s.at).toLocaleString('zh-CN')}）
                          <button className="btn-ghost text-xs border border-slate-300" style={{ marginLeft: 8 }} onClick={() => void doSupplement(e, s.dimension, 'clear')}>
                            撤销补充
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {m && <p className="text-[10px] text-slate-400 mt-2">实验身份：{experimentIdentityKey(e)}</p>}
                </div>
              );
            })}
          </div>

          {/* 补充入口：只对「未知」维度开放；必须填值与来源 */}
          {unknownDims.length > 0 && (
            <div className="mt-5" style={{ border: '1px dashed var(--line)', borderRadius: 8, padding: 12 }}>
              <p className="text-xs font-bold" style={{ margin: '0 0 6px' }}>
                信息不足的原因与补充入口（{unknownDims.length} 项未记录）
              </p>
              <p className="text-[10px] text-[var(--fg-3)]" style={{ margin: '0 0 10px' }}>
                补充必须填写<strong>具体值与来源</strong>（例如「论文 Table 3 第 2 行」）：只勾选「我核对过」不会把未知条件变成已知。
                人工填写的值是<strong>人工声明</strong>，不是原文核验结果，会与原 AI 值并列保留。
              </p>
              <div className="space-y-3">
                {unknownDims.map((u) => {
                  const sides: { e: ExperimentRecord; side: Side }[] = [];
                  if (u.which === 'a' || u.which === 'both') sides.push({ e: a, side: 'a' });
                  if (u.which === 'b' || u.which === 'both') sides.push({ e: b, side: 'b' });
                  return (
                    <div key={u.field} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                      <p className="text-xs font-bold" style={{ margin: '0 0 2px' }}>
                        {u.label}
                        <span className="font-normal text-[var(--fg-3)]">
                          {' '}
                          —— 缺：{u.which === 'both' ? '双方' : u.which === 'a' ? modelOf(a) : modelOf(b)}
                        </span>
                      </p>
                      {u.hint && <p className="text-[10px] text-[var(--fg-3)]" style={{ margin: '0 0 6px' }}>{u.hint}</p>}
                      {sides.map(({ e, side }) => {
                        const key = `${e.id}|${u.field}`;
                        const d = supDraft[key] ?? { value: '', source: '', quote: '' };
                        const msg = supMsg?.key === key ? supMsg : null;
                        return (
                          <div key={side} className="flex items-end gap-2 flex-wrap" style={{ marginBottom: 6 }}>
                            <span className="text-[10px] text-[var(--fg-3)]" style={{ minWidth: 110 }}>
                              {modelOf(e)}
                            </span>
                            <input
                              className="f"
                              style={{ width: 160, padding: '4px 8px' }}
                              placeholder="具体值"
                              aria-label={`${u.label} 的具体值（${modelOf(e)}）`}
                              data-sup-value={u.field}
                              data-paper-id={e.paperId}
                              data-exp-id={e.id}
                              data-side={side}
                              value={d.value}
                              onChange={(ev) => setSupDraft((cur) => ({ ...cur, [key]: { ...d, value: ev.target.value } }))}
                            />
                            <input
                              className="f"
                              style={{ width: 220, padding: '4px 8px' }}
                              placeholder="来源（如：论文 Table 3 第 2 行）"
                              aria-label={`${u.label} 的来源（${modelOf(e)}）`}
                              data-sup-source={u.field}
                              data-paper-id={e.paperId}
                              data-exp-id={e.id}
                              data-side={side}
                              value={d.source}
                              onChange={(ev) => setSupDraft((cur) => ({ ...cur, [key]: { ...d, source: ev.target.value } }))}
                            />
                            <button
                              className="btn-primary"
                              style={{ padding: '4px 12px' }}
                              data-sup-save={u.field}
                              data-paper-id={e.paperId}
                              data-exp-id={e.id}
                              data-side={side}
                              onClick={() => void doSupplement(e, u.field, 'set', { value: d.value, source: d.source, quote: d.quote })}
                            >
                              保存
                            </button>
                            <button
                              className="btn-ghost border border-slate-300 text-xs"
                              title="只标记「我已核对过这一项」。它不提供值、不参与任何判定。"
                              data-sup-check={u.field}
                              data-paper-id={e.paperId}
                              data-exp-id={e.id}
                              data-side={side}
                              onClick={() => void doSupplement(e, u.field, 'toggle-checked', { checked: !(e.userSupplemented ?? []).includes(u.field) })}
                            >
                              {(e.userSupplemented ?? []).includes(u.field) ? '取消「已核对」' : '仅标记「已核对」'}
                            </button>
                            {msg && (
                              <span className="text-[10px]" style={{ color: msg.ok ? 'var(--success)' : 'var(--bad)' }}>
                                {msg.text}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 同口径对照条：只在「可直接比较」时出现，并标注尺度与方向 */}
          {canBar && (
            <div className="mt-5">
              <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-2">
                同口径对照（仅在本对被判为「可直接比较」时绘制）
              </p>
              {[a, b].map((e) => {
                const v = parseMetricValue(e.metricValue);
                const pct = v.kind === 'point' ? Math.max(2, Math.round((v.value / barMax) * 100)) : 0;
                return (
                  <div key={e.id} className="flex items-center gap-2 mb-1">
                    <span className="text-xs" style={{ minWidth: 150 }}>
                      {modelOf(e)}
                    </span>
                    <div className="stat-bar-bg" style={{ flex: 1, height: 10, borderRadius: 5, overflow: 'hidden' }}>
                      <div className="stat-bar-fill" style={{ width: `${pct}%`, height: '100%' }} />
                    </div>
                    <span className="text-xs font-bold" style={{ minWidth: 80 }}>
                      {rawValue(e)}
                    </span>
                  </div>
                );
              })}
              <p className="text-[10px] text-[var(--fg-3)]" style={{ margin: 0 }}>
                尺度：条长按本对内的最大值等比换算（不是绝对刻度）；指标方向：
                {dir === 'lower' ? '越低越好' : dir === 'higher' ? '越高越好' : '无法从指标名判断（未标注）'}；
                本对已记录的条件一致，但公开基准上的差异仍可能来自训练策略等非架构因素，**不能**据此判定架构优劣。
                {' '}数值原始写法：{a.metricValue} / {b.metricValue}
              </p>
            </div>
          )}

          {cmp.caveats.length > 0 && (
            <div className="mt-4 text-xs text-[var(--fg-2)]">
              <strong>注意事项：</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {cmp.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[10px] text-slate-400 mt-3" style={{ margin: 0 }}>
            {cmp.disclaimer}
          </p>
        </div>
      )}
    </div>
  );
}

/** 条件矩阵里的一格：明确区分「已知 / 未知 / 人工补充 / 已核对标记」 */
function DimCell({
  state,
  raw,
  display,
  rec,
  dim,
}: {
  state: DimState;
  raw: string;
  display: string;
  rec: ExperimentRecord;
  dim: string;
}) {
  const sup: ExperimentConditionSupplement | undefined = supplementedDims(rec).get(dim);
  if (state === 'supplemented' && sup) {
    return (
      <td className="px-3 py-2">
        <span className="font-bold">{sup.value}</span>
        <Tag kind="info">人工补充</Tag>
        <div className="text-[10px] text-[var(--fg-3)]">
          原 AI 值：{sup.originalValue || '（空）'} · 来源：{sup.source}
        </div>
      </td>
    );
  }
  if (state === 'unknown') {
    return (
      <td className="px-3 py-2 text-[var(--fg-3)]">
        未知
        <div className="text-[10px]">未记录 / 占位写法，不能当作「与对方一致」</div>
      </td>
    );
  }
  if (state === 'checked') {
    return (
      <td className="px-3 py-2">
        <span className="text-[var(--fg-3)]">未知</span>
        <Tag kind="warn">已标记核对（不提供值）</Tag>
        <div className="text-[10px] text-[var(--fg-3)]">该标记不参与判定：要让它变成已知，必须补充具体值与来源。</div>
      </td>
    );
  }
  return (
    <td className="px-3 py-2">
      <span className="font-bold">{raw}</span>
      {display && display.toLowerCase() !== raw.toLowerCase() && <div className="text-[10px] text-[var(--fg-3)]">归一：{display}</div>}
    </td>
  );
}
