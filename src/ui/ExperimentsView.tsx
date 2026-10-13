import React, { useEffect, useMemo, useState } from 'react';
import type { Evidence, ExperimentRecord, Method, Paper } from '../core/types';
import type { CorpusKey, CorpusScope } from '../core/corpus';
import { Crumb, Status, downloadText } from './common';
import { isConditionValueMissing } from '../core/experiments';
import { DraftIcon } from '../draft-icons';

/**
 * 实验可比性审查（Superdesign 草稿 78f0813c，用户 2026-10-12 重构版）。
 *
 * 版面（照草稿）：页头 → 统计带 + 快速状态 → 指标组（每组一个指标：数值条 + 条件完整度）→
 * 比较规则提示 → 导出/详情/返回 → 页脚。
 *
 * 与旧版（成对比较）的取舍：新版把「条件核对」放在记录与指标组层面——
 * 每条记录按 8 个条件维度算完整度，缺什么的当场勾「已在原文核对」；
 * 成对比较引擎（core/experiments.ts）保留在核心层，本页不再展示成对结论。
 *
 * 真实性边界（照旧铁律）：
 * - 不做排名、不给「谁更好」的结论；条形图只是组内视觉参考；
 * - 所有数字来自当前范围的实验记录，草稿里的示例数值一律换成真实派生值；
 * - 「已在原文核对」的勾选是人工产物，持久化在该方法的分析结果里，
 *   重新分析按记录匹配保留（core/reanalysis.ts），界面与抽取值区分标注。
 */

interface Props {
  papers: Paper[];
  methods: Method[];
  onOpenEvidence: (ev: Evidence) => void;
  onGo?: (tab: 'library') => void;
  onLoadSample?: () => void;
  scope: CorpusScope;
  corpusLoading: CorpusKey | null;
  loadResult?: { key: CorpusKey; ok: boolean; papers: number; experiments: number; relations: number; message: string; at: number };
  focusPaper?: string | null;
  cacheStats?: { papers: number; experiments: number; at: number } | null;
  onSwitchToVision?: () => void;
  visionStats?: { papers: number; experiments: number; at: number } | null;
  /** 人工确认/取消一条实验记录的条件维度（持久化，重新分析时保留） */
  onSupplementCondition: (paperId: string, expId: string, dimKey: string, checked: boolean) => void;
}

/** 本页核对的条件维度（8 个，对应「N/8 完整」） */
const DIMS: { key: keyof ExperimentRecord; label: string }[] = [
  { key: 'evalDataset', label: '评估数据集' },
  { key: 'evalSplit', label: '数据集划分（比例）' },
  { key: 'inputResolution', label: '输入分辨率' },
  { key: 'extraData', label: '额外数据' },
  { key: 'pretrainData', label: '预训练数据' },
  { key: 'trainData', label: '训练/微调数据' },
  { key: 'testTimeAug', label: '测试时增强' },
  { key: 'inferenceMode', label: '单模型或集成' },
];

/** 指标方向只做阅读提示：按指标名推断，推断不出就不显示（不参与任何判断） */
function metricDirection(name: string): 'lower' | 'higher' | null {
  // err./err（缩写）也要认：实测视觉案例里的指标名是「top-1 err.」
  if (/(^|[^a-z])err(\.|$|[^a-z])/i.test(name) || /error|loss|perplexity|\bwer\b|\bfer\b|错误率|损失|困惑/i.test(name)) return 'lower';
  if (/acc|top-?1|top-?5|precision|recall|f1|iou|mAP|准确|得分|score/i.test(name)) return 'higher';
  return null;
}

const dimValue = (e: ExperimentRecord, key: keyof ExperimentRecord): string =>
  String((e as unknown as Record<string, unknown>)[key] ?? '').trim();
/**
 * 该维度「已记录」= 抽到的值是真的（「未知 / n/a / —」这类占位不算，见 core/experiments.ts），
 * 或用户人工确认过。依据铁律「未知 ≠ 已记录」：占位值不能撑高完整度。
 */
const dimFilled = (e: ExperimentRecord, key: keyof ExperimentRecord): boolean =>
  !isConditionValueMissing(dimValue(e, key)) || (e.userSupplemented?.includes(String(key)) ?? false);
const dimsMissing = (e: ExperimentRecord) => DIMS.filter((d) => !dimFilled(e, d.key));
/**
 * 手风琴里列出的维度：按**抽取值缺失**算（人工确认过的也要列出来，否则用户勾完就撤不回了）。
 * 与 dimsMissing（含人工确认后的口径）分工：清单看抽取值，完整度看「抽到 或 已确认」。
 */
const dimsUnknown = (e: ExperimentRecord) => DIMS.filter((d) => isConditionValueMissing(dimValue(e, d.key)));
const recordComplete = (e: ExperimentRecord) => dimsMissing(e).length === 0;

const parseNum = (e: ExperimentRecord): number | null => {
  const n = Number((String(e.metricValue).match(/-?[0-9]+(?:\.[0-9]+)?/) || [])[0]);
  return Number.isFinite(n) ? n : null;
};

export function ExperimentsView({
  papers,
  onOpenEvidence,
  onGo,
  onLoadSample,
  scope,
  corpusLoading,
  loadResult,
  focusPaper,
  cacheStats,
  onSwitchToVision,
  visionStats,
  onSupplementCondition,
}: Props) {
  const [excludedModels, setExcludedModels] = useState<Set<string>>(new Set());
  const [showAllModels, setShowAllModels] = useState(false);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    // 切语料后模型集合完全不同，排除与手风琴状态一并复位（旧状态对新数据没有意义）
    setExcludedModels(new Set());
    setOpenRows(new Set());
  }, [scope.key]);

  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const loading = corpusLoading === scope.key;

  const all = useMemo(() => scope.methods.flatMap((m) => m.experiments ?? []), [scope.methods]);
  const modelOf = (e: ExperimentRecord) => e.modelVariant || '未命名模型';

  const modelCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all) m.set(modelOf(e), (m.get(modelOf(e)) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  const inScopeRecords = useMemo(() => all.filter((e) => !excludedModels.has(modelOf(e))), [all, excludedModels]);
  /** 进入指标组的记录：有可解析数值（画不了条的无法做组内对比） */
  const chartable = useMemo(
    () => inScopeRecords.filter((e) => parseNum(e) !== null && !!e.metricName),
    [inScopeRecords],
  );
  const excludedCount = all.length - chartable.length;
  const modelCount = useMemo(() => new Set(all.map(modelOf)).size, [all]);

  const metricGroups = useMemo(() => {
    const map = new Map<string, { name: string; unit?: string; items: ExperimentRecord[] }>();
    for (const e of chartable) {
      const key = `${e.metricName}|${e.metricUnit ?? ''}`;
      if (!map.has(key)) map.set(key, { name: e.metricName, unit: e.metricUnit || undefined, items: [] });
      map.get(key)!.items.push(e);
    }
    return [...map.values()];
  }, [chartable]);

  /** 聚焦某篇论文（从别处跳进来时）：只显示该篇的记录 */
  const [paperOnly, setPaperOnly] = useState<string | null>(focusPaper ?? null);
  useEffect(() => {
    if (focusPaper) setPaperOnly(focusPaper);
  }, [focusPaper]);
  const focusTitle = paperOnly ? paperById.get(paperOnly)?.title : undefined;
  const groups = useMemo(
    () => (paperOnly ? metricGroups.map((g) => ({ ...g, items: g.items.filter((e) => e.paperId === paperOnly) })) : metricGroups).filter((g) => g.items.length > 0),
    [metricGroups, paperOnly],
  );

  const toggleRow = (id: string) => {
    setOpenRows((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportReport = () => {
    const lines: string[] = [
      '# 实验可比性审查（ResearchPilot 导出）',
      '',
      `生成时间：${new Date().toLocaleString('zh-CN')}`,
      `语料库：${scope.meta.label}`,
      `实验总数：${all.length}；进入指标组：${chartable.length}；未进入：${excludedCount}；模型数：${modelCount}`,
      '',
      '## 比较规则',
      '- 可以比较：同一指标，且 8 个条件维度都已记录且取值一致。',
      '- 不能跨指标比较：不同指标的数值不能互相对比。',
      '- 不能跨条件比较：任一关键条件不同的记录，数值差异不能归因于方法本身。',
      '- 条件未知：关键条件没有记录的先标「信息不足」，人工核对后可标记确认。',
      '- 报告数值：原始报告数值是主要信息，条形图仅作为该指标组内的视觉参考。',
      '',
    ];
    for (const g of groups) {
      lines.push(`## ${g.name}${g.unit ? `（${g.unit}）` : ''}`);
      const completeDims = DIMS.filter((d) => g.items.every((e) => dimFilled(e, d.key)));
      lines.push(`条件维度：${completeDims.length}/${DIMS.length} 完整${DIMS.length - completeDims.length ? `，缺失：${DIMS.filter((d) => !completeDims.includes(d)).map((d) => d.label).join('、')}` : ''}`);
      for (const e of g.items) {
        const missing = dimsMissing(e).map((d) => d.label);
        lines.push(
          `- ${modelOf(e)}（${paperById.get(e.paperId)?.title?.slice(0, 40) ?? '未知论文'}）：${e.metricValue}${e.metricUnit ?? ''} — ${
            missing.length ? `缺 ${missing.join('、')}${e.userSupplemented?.length ? '（部分已人工确认）' : ''}` : '条件完整'
          }`,
        );
      }
      lines.push('');
    }
    if (excludedCount > 0) {
      lines.push(`## 未进入指标组的记录（${excludedCount} 条）`, '没有可解析的数值或所属模型被排除，不参与组内对比。');
    }
    downloadText('researchpilot-实验可比性.md', lines.join('\n'), 'text/markdown');
  };

  /* ---------------- 空状态：分清「没有语料」与「有论文但无实验记录」 ---------------- */
  if (!all.length) {
    const hasPapers = scope.papers.length > 0;
    const cacheKnown = Boolean(cacheStats);
    const cacheHasExperiments = (cacheStats?.experiments ?? 0) > 0;
    const canSwitchToVision = scope.key !== 'vision' && Boolean(onSwitchToVision);
    return (
      <div className="exppage sdpage">
        <Crumb trail={[{ label: '论文集合', on: () => onGo?.('library') }, { label: '实验可比性审查' }]} />
        <section className="mb-10">
          <h1 className="text-4xl font-serif font-bold text-slate-900 mb-3">实验可比性审查</h1>
          <div className="flex items-center gap-4 flex-wrap">
            <p className="text-[var(--fg-2)] text-lg">这是一个条件检查工具，不是排行榜。帮助你判断实验结果是否可以公平比较。</p>
            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded uppercase tracking-wider">Rigorous Analysis</span>
          </div>
        </section>

        <div className="grid grid-cols-12 gap-8 mb-12">
          <div className="col-span-12 lg:col-span-9">
            <div className="content-card bg-[var(--bg-3)] border-none p-8 flex items-center justify-between gap-6 flex-wrap">
              <div className="flex gap-16 flex-wrap">
                <div>
                  <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1">当前语料库</p>
                  <p className="text-lg font-bold">{scope.mode === 'own' ? '我上传的论文' : scope.meta.label}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1">实验总数</p>
                  <p className="text-lg font-bold">0</p>
                </div>
                {loading && <Status kind="info">正在加载…</Status>}
              </div>
              {!loading && (
                <button className="btn-ghost text-xs border border-slate-300" onClick={() => onLoadSample?.()} disabled={loading || !onLoadSample}>
                  <DraftIcon name="refresh-cw" />
                  <span className="ml-2">重新加载案例</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 如实说明：为什么是 0，以及有哪些真实出路（重载 / 切回有记录的案例 / 去集合） */}
        <div className="content-card bg-white p-8">
          <p className="text-sm text-[var(--fg-2)]" style={{ margin: '0 0 10px' }}>
            {cacheKnown && !cacheHasExperiments
              ? `这份语料（${scope.meta.label}）的预置缓存里没有实验记录（已实际加载核对：${cacheStats?.papers ?? 0} 篇论文、0 条实验记录），重新加载也不会多出来。这一页只比较「一条实验记录」之间的口径，没有记录就没有可比内容。`
              : hasPapers
                ? '论文已加载，但当前语料还没有生成实验记录。可以重新加载本语料的预置缓存来补齐（不会重复添加论文）。'
                : '还没有加载本语料的预置缓存。加载后能看到这份语料实际包含什么——有些开发回归样例本来就不含实验记录，那时这里不会有可比内容。'}
          </p>
          {cacheKnown && !cacheHasExperiments && visionStats && visionStats.experiments > 0 && (
            <p className="text-sm text-[var(--fg-3)]" style={{ margin: '0 0 10px' }}>
              视觉方法演进案例的预置缓存里有 <strong>{visionStats.papers} 篇论文、{visionStats.experiments} 条实验记录</strong>
              ，要比较实验口径请切回那个案例。
            </p>
          )}
          <div className="flex gap-3 flex-wrap">
            {cacheKnown && !cacheHasExperiments && canSwitchToVision ? (
              <button className="btn-primary" onClick={() => onSwitchToVision?.()} disabled={loading}>
                切回视觉方法演进案例（有实验记录）
              </button>
            ) : null}
            {canSwitchToVision && (
              <button className="btn-ghost border border-slate-300 text-xs font-bold" onClick={() => onSwitchToVision?.()}>
                切回视觉方法演进案例
              </button>
            )}
            <button className="btn-ghost border border-slate-300 text-xs font-bold" onClick={() => onGo?.('library')}>
              去论文集合查看论文
            </button>
          </div>
          {loadResult && (
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
      <Crumb trail={[{ label: '论文集合', on: () => onGo?.('library') }, { label: '实验可比性审查' }]} />

      {/* ① 页头 */}
      <section className="mb-10">
        <h1 className="text-4xl font-serif font-bold text-slate-900 mb-3">实验可比性审查</h1>
        <div className="flex items-center gap-4 flex-wrap">
          <p className="text-[var(--fg-2)] text-lg">这是一个条件检查工具，不是排行榜。帮助你判断实验结果是否可以公平比较。</p>
          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded uppercase tracking-wider">Rigorous Analysis</span>
        </div>
        <p className="text-[var(--fg-3)] text-sm mt-4">
          核心是核对评估集、数据划分、分辨率、额外数据、预训练、测试时增强与推理方式这些条件是否一致且已记录。跨指标比较无效。
        </p>
        {/* 真值边界必须写在首屏：这一页不做排名，也不把条件差异说成方法优劣（沿用旧版口径） */}
        <p className="text-[var(--fg-3)] text-sm mt-2">
          本页<strong>不做排名</strong>，也不给「某种架构本身更优」之类的<strong>因果结论</strong>；只回答「这些数字能不能放在一起比」。
        </p>
      </section>

      {/* ② 统计带 + 快速状态 */}
      <div className="grid grid-cols-12 gap-8 mb-12">
        <div className="col-span-12 lg:col-span-9">
          <div className="content-card bg-[var(--bg-3)] border-none p-8 flex items-center justify-between gap-6 flex-wrap">
            <div className="flex gap-16 flex-wrap">
              <div>
                <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1">当前语料库</p>
                <p className="text-lg font-bold">{scope.mode === 'own' ? '我上传的论文' : scope.meta.label}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1">实验总数</p>
                <p className="text-lg font-bold">{all.length}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1">已选记录</p>
                <p className="text-lg font-bold text-[var(--accent)]">{chartable.length} 条</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1" title="没有可解析数值、或所属模型被快速状态排除的记录">
                  已排除记录
                </p>
                <p className="text-lg font-bold">{excludedCount} 条</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-1">包含模型数</p>
                <p className="text-lg font-bold">{modelCount} 个</p>
              </div>
            </div>
            {scope.mode === 'case' && (
              <button className="btn-ghost text-xs border border-slate-300" onClick={() => onLoadSample?.()} disabled={loading || !onLoadSample}>
                <DraftIcon name="refresh-cw" />
                <span className="ml-2">{loading ? '正在加载…' : '重新加载案例'}</span>
              </button>
            )}
          </div>
          {loadResult?.key === scope.key && (
            <div className="flex items-center gap-3 mt-3">
              <Status kind={loadResult.ok ? 'ok' : 'bad'}>{loadResult.ok ? '上次加载完成' : '上次加载失败'}</Status>
              <span className="text-xs text-[var(--fg-3)]">{loadResult.message}</span>
            </div>
          )}
        </div>
        <div className="col-span-12 lg:col-span-3">
          <div className="content-card p-6 bg-white flex flex-col justify-between">
            <p className="text-[10px] font-bold text-[var(--fg-3)] uppercase tracking-widest mb-4" title="点 × 排除一个模型变体，再点一次恢复">
              快速状态（点 × 排除）
            </p>
            <div className="flex flex-wrap gap-2">
              {(showAllModels ? modelCounts : modelCounts.slice(0, 3)).map(([m]) => (
                <span key={m} className="tag-model">
                  {m}
                  <button
                    className="cursor-pointer hover:text-red-500"
                    aria-label={excludedModels.has(m) ? `恢复 ${m}` : `排除 ${m}`}
                    title={excludedModels.has(m) ? '恢复显示该模型' : '从下面的指标组里排除该模型'}
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
          </div>
        </div>
      </div>

      {/* ③ 指标组：一个指标一组，组内画条 + 条件完整度 */}
      {focusTitle && (
        <div className="mb-8 flex items-center gap-3">
          <Status kind="info">只看：{focusTitle.slice(0, 40)}{(focusTitle.length > 40 ? '…' : '')}</Status>
          <button className="btn-ghost text-xs border border-slate-300" onClick={() => setPaperOnly(null)}>
            查看全部记录
          </button>
        </div>
      )}
      <div className="space-y-12">
        {groups.map((g) => {
          const completeDims = DIMS.filter((d) => g.items.every((e) => dimFilled(e, d.key)));
          const missingDims = DIMS.filter((d) => !completeDims.includes(d));
          const completeRecords = g.items.filter(recordComplete);
          const nums = g.items.map(parseNum).filter((n): n is number => n !== null);
          const axisMax = (g.unit ?? '').includes('%') ? 100 : nums.length ? Math.max(...nums) || 1 : 1;
          const dir = metricDirection(g.name);
          /**
           * 数值一律照实显示：草稿的示例数据里「不可比」的组是空卡，但真实数据里「未知」很多，
           * 若因此整组留空，等于把原文报出来的数藏起来。不可比的记录按草稿降权（半透明），
           * 并在「整组没有一条条件完整」时明确写一句为什么不能直接比。
           */
          const noComplete = completeRecords.length === 0;
          const missingLeader = missingDims
            .map((d) => ({ d, n: g.items.filter((e) => !dimFilled(e, d.key)).length }))
            .sort((a, b) => b.n - a.n)[0];
          return (
            <div key={`${g.name}|${g.unit ?? ''}`} className="content-card bg-white p-0 overflow-hidden">
              <div className="px-8 py-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center gap-4 flex-wrap">
                <div className="flex items-center gap-4 flex-wrap">
                  <h3 className="text-xl font-serif font-bold">{g.name}</h3>
                  {g.unit && <span className="text-[var(--fg-3)] text-sm">({g.unit})</span>}
                  {dir && (
                    <span
                      className="flex items-center gap-1 text-xs font-bold text-slate-500"
                      title="按指标名推断的阅读提示（Error/Loss 类越小越好），不参与任何判断"
                    >
                      <DraftIcon name={dir === 'lower' ? 'arrow-down' : 'arrow-up'} />
                      {dir === 'lower' ? '越小越好' : '越大越好'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="status-pill bg-[var(--success-soft)] text-[var(--success)]" title={`这些条件维度在组内每条记录都有值或已被人工确认：${completeDims.map((d) => d.label).join('、') || '（无）'}`}>
                    <DraftIcon name="check-circle" />
                    {completeDims.length}/{DIMS.length} 完整
                  </span>
                  {missingDims.length > 0 && (
                    <span
                      className="status-pill bg-[var(--warning-soft)] text-[var(--warning)]"
                      title={`这些条件维度在组内有记录缺失：${missingDims.map((d) => d.label).join('、')}`}
                    >
                      <DraftIcon name="alert-triangle" />
                      {missingDims.length}/{DIMS.length} 条件缺失
                    </span>
                  )}
                </div>
              </div>

              {noComplete && (
                <div className="px-8 py-6 bg-amber-50/40 border-b border-amber-100">
                  <p className="text-amber-800/80 text-sm text-center">
                    此指标下的记录大多缺失「{missingLeader?.d.label ?? '关键条件'}」，暂时标记为不可比较；下面仍照实列出原文数值（降权显示），补齐条件后才能直接对比。
                  </p>
                </div>
              )}
              <div className="divide-y divide-slate-50">
                {g.items.map((e) => {
                    /** 抽取值缺失的维度（人工确认过的仍列出，便于撤回） */
                    const unknown = dimsUnknown(e);
                    const confirmed = unknown.filter((d) => e.userSupplemented?.includes(String(d.key)) ?? false).length;
                    const allConfirmed = unknown.length > 0 && confirmed === unknown.length;
                    const complete = unknown.length === 0 || allConfirmed;
                    const missing = unknown;
                    const num = parseNum(e);
                    const pct = num !== null ? Math.max(0, Math.min(100, Math.round((num / axisMax) * 100))) : 0;
                    const open = openRows.has(e.id);
                    return (
                      <div
                        key={e.id}
                        className={`row-item px-8 py-6 grid grid-cols-12 items-center gap-8 transition-colors${missing.length ? ' cursor-pointer' : ''}${open ? ' accordion-active' : ''}`}
                        data-exp-row={e.id}
                      >
                        <div
                          className="col-span-3"
                          onClick={(ev) => {
                            if (missing.length && !(ev.target as HTMLElement).closest('label,input,button,a')) toggleRow(e.id);
                          }}
                        >
                          <p className="font-bold text-sm">{modelOf(e)}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {(paperById.get(e.paperId)?.title ?? '未知论文').slice(0, 34)}
                            {paperById.get(e.paperId)?.year ? ` • ${paperById.get(e.paperId)!.year}` : ''}
                            {/* 表格行列是否核验过是这条数值的可信度信号，必须随行显示（不藏进折叠） */}
                            <span className={e.verification?.rowColConfirmed ? ' text-[var(--success)]' : ' text-[var(--warning)]'}>
                              {' · '}
                              {e.verification?.rowColConfirmed ? '行列已核验' : '行列待核查'}
                            </span>
                          </p>
                        </div>
                        <div
                          className="col-span-4"
                          onClick={(ev) => {
                            if (missing.length && !(ev.target as HTMLElement).closest('label,input,button,a')) toggleRow(e.id);
                          }}
                        >
                          <div className="stat-bar-bg">
                            <div className={`stat-bar-fill${complete ? '' : ' dim'}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div
                          className="col-span-2 text-right"
                          onClick={(ev) => {
                            if (missing.length && !(ev.target as HTMLElement).closest('label,input,button,a')) toggleRow(e.id);
                          }}
                        >
                          <span className={`text-lg font-bold${complete ? '' : ' text-slate-400'}`}>
                            {e.metricValue}
                            {e.metricUnit ?? ''}
                          </span>
                          {/* 数值旁必须有原文入口（可溯源）：草稿没有，但「数从哪来」是本页的底线 */}
                          {e.evidence && (
                            <button
                              className="block text-xs text-[var(--accent)] hover:underline ml-1 text-right"
                              style={{ marginTop: 2 }}
                              onClick={() => onOpenEvidence(e.evidence!)}
                              title="打开这条数值的原文依据"
                            >
                              查看原文 p.{e.evidence.page ?? '?'}
                            </button>
                          )}
                        </div>
                        <div className="col-span-3 flex justify-end items-center gap-3">
                          {allConfirmed ? (
                            <button
                              className="status-pill bg-[var(--success-soft)] text-[var(--success)]"
                              onClick={() => toggleRow(e.id)}
                              title={`抽取值缺失 ${unknown.length} 项，你已逐项确认（${confirmed} 项）；点开可撤回`}
                            >
                              <DraftIcon name="check" />
                              已人工确认（{confirmed} 项）
                            </button>
                          ) : missing.length ? (
                            <button
                              className="status-pill bg-[var(--warning-soft)] text-[var(--warning)]"
                              onClick={() => toggleRow(e.id)}
                              title={`缺 ${missing.map((d) => d.label).join('、')}——点开核对清单`}
                            >
                              <DraftIcon name="alert-triangle" />
                              信息不足
                            </button>
                          ) : (
                            <span className="status-pill bg-[var(--success-soft)] text-[var(--success)]" title="8 个条件维度都已记录或已被人工确认">
                              <DraftIcon name="check" />
                              条件完整
                            </span>
                          )}
                        </div>
                        {missing.length > 0 && (
                          <div className="col-span-12 missing-list" data-exp-missing={e.id}>
                            <div className="p-6 bg-amber-50 rounded-xl border border-amber-100">
                              <p className="text-xs font-bold text-amber-800 mb-4 flex items-center gap-2">
                                具体缺失条件清单（勾选 = 我已在原文核对该项；勾选会保存在本机，重新分析后保留）
                              </p>
                              <div className="grid grid-cols-2 gap-4">
                                {missing.map((d) => {
                                  const checked = e.userSupplemented?.includes(String(d.key)) ?? false;
                                  return (
                                    <label key={String(d.key)} className="flex items-center gap-3 text-xs text-amber-900/70 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        className="w-4 h-4 rounded border-amber-300 text-amber-600"
                                        checked={checked}
                                        onChange={(ev) => {
                                          ev.stopPropagation();
                                          onSupplementCondition(e.paperId, e.id, String(d.key), ev.target.checked);
                                        }}
                                      />
                                      {d.label}
                                    </label>
                                  );
                                })}
                              </div>
                              {e.userSupplemented?.length ? (
                                <p className="text-[10px] text-amber-700 mt-3">已人工确认 {e.userSupplemented.length} 项（计入上面的完整度，重新分析后保留）。</p>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
            </div>
          );
        })}
        {!groups.length && (
          <div className="content-card bg-white p-8">
            <p className="text-sm text-[var(--fg-2)]" style={{ margin: 0 }}>
              当前没有可绘图的记录：{excludedCount} 条被排除（缺数值或被快速状态排除）。可以在快速状态里恢复模型，或点「查看实验详情」核对原始数据。
            </p>
          </div>
        )}
      </div>

      {/* ④ 比较规则提示 + 导出/详情/返回 */}
      <div className="mt-16 grid grid-cols-12 gap-8">
        <div className="col-span-12 lg:col-span-8">
          <div className="p-8 bg-amber-50 rounded-2xl border border-amber-100">
            <h4 className="text-amber-800 font-bold mb-4 flex items-center gap-2">比较规则提示（Comparative Guidelines）</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <p className="text-xs text-amber-900/80 flex gap-2">
                  <span>
                    <strong>可以比较：</strong>同一指标，且 8 个条件维度（评估集、划分、分辨率、额外数据、预训练、训练数据、测试时增强、推理方式）都已记录且取值一致。
                  </span>
                </p>
                <p className="text-xs text-amber-900/80 flex gap-2">
                  <span>
                    <strong>不能跨指标比较：</strong>即使在相同条件下，也不能用 Top-1 和 Top-5 的数值条长度来判断优劣。
                  </span>
                </p>
              </div>
              <div className="space-y-3">
                <p className="text-xs text-amber-900/80 flex gap-2">
                  <span>
                    <strong>不能跨条件比较：</strong>任一关键条件不同的记录，数值差异不能直接归因于方法本身。
                  </span>
                </p>
                <p className="text-xs text-amber-900/80 flex gap-2">
                  <span>
                    <strong>报告数值：</strong>原始报告数值是主要信息，条形图仅作为该指标组内的视觉参考；「已在原文核对」的勾选是人工标记，不改变抽取值。
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">
          <button className="w-full btn-primary flex items-center justify-center gap-2" onClick={exportReport}>
            导出可比性报告（Markdown）
          </button>
          <div className="grid grid-cols-2 gap-4">
            <button className="btn-ghost border border-slate-300 text-xs font-bold" onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? '收起实验详情' : '查看实验详情'}
            </button>
            <button className="btn-ghost border border-slate-300 text-xs font-bold" onClick={() => onGo?.('library')}>
              返回论文集合
            </button>
          </div>
        </div>
      </div>

      {/* ⑤ 实验详情：全部记录的完整条件（含未进组的），只读 */}
      {showDetails && (
        <div className="mt-10 content-card bg-white p-8 overflow-x-auto">
          <p className="text-xs font-bold text-[var(--fg-3)] uppercase tracking-widest mb-4">实验详情（{all.length} 条，含未进入指标组的记录）</p>
          <table className="w-full text-left text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead className="bg-[var(--bg-3)]">
              <tr>
                <th className="px-3 py-2">模型</th>
                <th className="px-3 py-2">论文</th>
                <th className="px-3 py-2">指标</th>
                <th className="px-3 py-2">数值</th>
                {DIMS.map((d) => (
                  <th key={String(d.key)} className="px-3 py-2">
                    {d.label}
                  </th>
                ))}
                <th className="px-3 py-2">原文</th>
              </tr>
            </thead>
            <tbody>
              {all.map((e) => (
                <tr key={e.id} className="border-t border-[var(--line)]">
                  <td className="px-3 py-2 font-bold">{modelOf(e)}</td>
                  <td className="px-3 py-2 text-[var(--fg-3)]">{(paperById.get(e.paperId)?.title ?? '未知论文').slice(0, 26)}</td>
                  <td className="px-3 py-2">{e.metricName}</td>
                  <td className="px-3 py-2 font-bold">
                    {e.metricValue}
                    {e.metricUnit ?? ''}
                  </td>
                  {DIMS.map((d) => {
                    const v = dimValue(e, d.key);
                    const sup = e.userSupplemented?.includes(String(d.key));
                    return (
                      <td key={String(d.key)} className={`px-3 py-2${v ? '' : sup ? ' text-[var(--success)]' : ' text-slate-300'}`}>
                        {v || (sup ? '已人工核对' : '未知')}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    {e.evidence ? (
                      <button className="text-[var(--accent)] hover:underline" onClick={() => onOpenEvidence(e.evidence!)}>
                        p.{e.evidence.page ?? '?'}
                      </button>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ⑥ 页脚：真实边界，不放不存在的链接 */}
      <footer className="mt-16 border-t border-[var(--line)] py-10">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <p className="text-xs text-slate-400">© 2026 ResearchPilot · 数据仅保存在本机浏览器；人工确认只标记核对状态，不改变模型抽取值</p>
          <p className="text-xs text-slate-400">条件核对以当前范围（{scope.mode === 'own' ? '我上传的论文' : scope.meta.label}）的记录为准</p>
        </div>
      </footer>
    </div>
  );
}
