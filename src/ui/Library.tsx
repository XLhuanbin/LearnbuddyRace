import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Status } from './common';
import type { CorpusKey, CorpusScope } from '../core/corpus';
import type { Evidence, FieldKey, Method, Paper, Relation } from '../core/types';
import { titleNeedsConfirm } from '../core/rules';
import { FIELD_KEYS_ORDER } from '../core/cache';
import { buildMethodProfile } from '../core/grouping';
import { DraftIcon } from '../draft-icons';
import { INNOVATION_TIERS, innovationBadgeClass, innovationColor, innovationTier } from './innovationScale';

/**
 * 方法标签：只根据**已抽取的文本**做关键词派生，用于列表里快速识别方法路线。
 * 不新增任何结论，也不改变数据。
 */
export function methodTags(m?: Method): { text: string; style: string }[] {
  if (!m) return [];
  const text = [m.fields.methodName?.value, m.fields.coreIdea?.value].filter(Boolean).join(' ');
  const tags: { text: string; style: string }[] = [];
  const has = (re: RegExp) => re.test(text);
  if (has(/CNN|卷积|ConvNet|ResNet|residual/i)) tags.push({ text: 'CNN', style: '' });
  if (has(/Transformer|ViT|attention|注意力/i)) tags.push({ text: 'Vision Transformer', style: '' });
  if (has(/蒸馏|distillation/i)) tags.push({ text: '蒸馏', style: 'neutral' });
  if (has(/层次|hierarchical|窗口|window|shifted/i)) tags.push({ text: '层次化 / 窗口注意力', style: 'neutral' });
  if (has(/数据高效|data-efficient/i)) tags.push({ text: '数据高效训练', style: 'neutral' });
  if (has(/残差|residual/i)) tags.push({ text: '残差连接', style: 'neutral' });
  return tags.slice(0, 3);
}

/** 该论文有多少个字段证据可核验 */
export function verifiedOf(m: Method): number {
  return FIELD_KEYS_ORDER.filter((k) => m.fields[k]?.evidence?.verified).length;
}

export interface JobState {
  paperId: string;
  stage: string;
  message: string;
  status: 'running' | 'done' | 'failed' | 'canceled';
  attempts: number;
  error?: string;
}

/** 列表里唯一的分析状态：只由真实状态派生，等待模型绝不显示成完成 */
function primaryStatus(p: Paper, m: Method | undefined, job: JobState | undefined): { kind: string; text: string } {
  if (p.parseStatus === 'failed') return { kind: 'bad', text: '解析失败' };
  if (job?.status === 'running') return { kind: 'info', text: '正在等待模型响应' };
  if (job?.status === 'canceled') return { kind: 'pending', text: '已停止等待（未完成）' };
  if (job?.status === 'failed') {
    // 2026-10-12 用户实测：只写「分析失败」用户不知道下一步该干什么（密钥？额度？端点？）。
    // 失败原因截断展示在这里，完整版在「查看报告」与运行日志里。
    const reason = (job.error || '').replace(/\s+/g, ' ').trim();
    const short = reason.length > 60 ? reason.slice(0, 60) + '…' : reason;
    return { kind: 'bad', text: short ? `分析失败：${short}` : '分析失败（未完成）' };
  }
  if (m) return m.cached ? { kind: 'cached', text: '分析完成 · 缓存结果' } : { kind: 'live', text: '分析完成 · 实时分析' };
  return { kind: 'pending', text: '尚未提取方法字段' };
}

/** 右栏「创新度分布」的分档文案：照草稿 6db41280 原文（阈值与 INNOVATION_TIERS 一致） */
const TIER_SHORT: Record<string, string> = {
  high: '革命性 (8.5+)',
  mid: '重要改进 (7.0-8.5)',
  low: '常规优化 (< 7.0)',
};

/** 相对时间：只由真实时间戳派生，没有时间戳就如实写「未知」 */
function relativeTime(ts?: number, now = Date.now()): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '未知';
  const diff = now - ts;
  if (diff < 60_000) return '刚刚';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

/**
 * 论文集合（草稿 `6db41280`「论文库主页」）。
 *
 * **外观按草稿逐元素复刻**：eyebrow + 4xl 衬线标题 → 右上三按钮 → 四张统计卡 →
 * 12 栏（9 + 3）：左＝白卡表格（全选 / 筛选 / 搜索 / 排序，表头 论文标题·方法族·创新度·操作），
 * 右＝创新度分布（三条 stat-bar）+ 智能路线规划（accent 底 CTA）+ 近期动态；页脚。
 *
 * **只替换与事实不符的内容**（草稿的示例数据是编造的）：
 *   - 「12 篇 / 8.1 / 04 / 2小时前」→ 真实的篇数、平均创新评分、待核查关系数、最近分析时间
 *   - 「核心作者 Vaswani et al.」→ **方法族**（我们没有作者数据，这是同一个缺失被多页复用，
 *     统一换成真实可算的家族判定）
 *   - 论文标题与年份 → 真实论文；「NEURIPS」这类会议名 → 真实的来源标注
 *   - 页脚「用户协议 / 隐私政策」→ 我们没有这两个页面，换成真实入口（返回首页 / 偏好设置）
 *
 * **为兼容保留**：草稿没有「管理论文与案例」折叠区与运行日志，
 * 但加载演示案例 / 切换语料 / 粘贴导入是我们**真实且必需**的入口（演示流程靠它），
 * 不能删，故收进一个默认收起的折叠里，不占首屏。
 *
 * **按篇操作（重新解析 / 停止等待 / 人工修正 / 证据）已全部迁到「分析结果页」**，
 * 行内只留「查看报告」，与 2026-10-10 的产品决定一致。
 */
export function LibraryView({
  papers,
  methods,
  relations = [],
  jobs,
  modelReady,
  onImport,
  onPaste,
  onExtract,
  onReparse,
  canReparseInPlace,
  onCancel,
  onRemove,
  lastImportedId,
  onRestore,
  onOverride,
  onOpenEvidence,
  onLoadSample,
  scope,
  corpusLoading,
  loadResult,
  onClearForeign,
  onOpenSettings,
  onGoMap,
  onGoHome,
  onGoExperiments,
  onOpenExperiments,
  onOpenResult,
  onGoGraph,
  onGoCompare,
  onGoDecision,
  corpus,
  corpusLabel,
  onSwitchCorpus,
  otherCorpusCount,
  logLines,
  staleNotes,
}: {
  papers: Paper[];
  methods: Method[];
  /** 当前语料的真实关系（只用于「待核查关系」计数，不新增判断） */
  relations?: Relation[];
  jobs: Record<string, JobState>;
  modelReady: boolean;
  onImport: (files: FileList) => void;
  onPaste: (title: string, text: string) => void;
  onExtract: (paperId: string, force?: boolean) => void;
  /** 重新解析 PDF：真正重跑解析（必要时请用户重新选一次文件），不是模型抽取 */
  onReparse: (paperId: string) => void;
  /** 这份 PDF 现在能否直接重解析（文件还在本次会话的内存里） */
  canReparseInPlace: (paperId: string) => boolean;
  /** 刚导入的论文（列表里高亮） */
  lastImportedId?: string | null;
  /** 停止等待：只停止本次等待，不代表服务端已停止计算或不再计费 */
  onCancel: (paperId: string) => void;
  onRemove: (paperId: string) => void;
  /** 撤销移除：把论文与已有分析结果写回本机 */
  onRestore: (paper: Paper, method?: Method, methods?: Method[], relations?: Relation[]) => void;
  onOverride: (paperId: string, field: FieldKey, value: string) => void;
  onOpenEvidence: (e: Evidence, label: string, paper?: Paper) => void;
  onLoadSample: () => void;
  scope: CorpusScope;
  corpusLoading: CorpusKey | null;
  loadResult?: { key: CorpusKey; ok: boolean; papers: number; experiments: number; relations: number; message: string; at: number };
  onClearForeign: () => void;
  onOpenSettings: () => void;
  /** 主入口：进入研究地图 */
  onGoMap: () => void;
  /** 面包屑返回首页 */
  onGoHome?: () => void;
  onGoExperiments: () => void;
  /** 打开实验比较页并聚焦某篇论文 */
  onOpenExperiments: (paperId: string) => void;
  /** 打开「分析结果页」并展示这篇论文的完整分析结果 */
  onOpenResult: (paperId: string) => void;
  onGoGraph: () => void;
  /** 跨论文比较 → 已有的「关系与比较」页 */
  onGoCompare: () => void;
  /** 生成阅读路线 → 已有的「阅读起点 / 决策」页 */
  onGoDecision: () => void;
  corpus: 'vision' | 'nlp-dev';
  corpusLabel: string;
  onSwitchCorpus: (c: 'vision' | 'nlp-dev') => void;
  otherCorpusCount: number;
  logLines: string[];
  /** 预置语料相对当前规则/提示词的过期说明（为空表示无过期） */
  staleNotes?: string[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'创新度' | '日期' | '名称'>('创新度');
  const [onlyAnalysed, setOnlyAnalysed] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');

  /** 当前语料可见的论文：预置 + 用户自己上传（其它语料集不混入） */
  const visiblePapers = [...scope.presetPapers, ...scope.ownPapers];
  const methodByPaper = new Map(methods.map((m) => [m.paperId, m]));
  const loading = corpusLoading === scope.key;

  /** 真实创新评分（模型评估，不是论文给出的分数） */
  const scoreOf = (p: Paper): number | undefined => {
    const v = methodByPaper.get(p.id)?.assessment?.innovation?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const scored = visiblePapers.map(scoreOf).filter((v): v is number => typeof v === 'number');
  const avgScore = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : undefined;
  const noScoreCount = visiblePapers.length - scored.length;

  /** 待核查关系数（这就是我们真实能报出的「待处理」量，不是草稿编的 04） */
  const pendingRelations = relations.filter((r) => r.evidenceState === 'candidate').length;

  /** 最近分析时间：取最近一次抽取完成的时间戳 */
  const latestExtractedAt = visiblePapers.reduce<number | undefined>((acc, p) => {
    const t = methodByPaper.get(p.id)?.extractedAt;
    if (typeof t !== 'number') return acc;
    return acc === undefined ? t : Math.max(acc, t);
  }, undefined);

  const familyOf = (paperId: string): string => {
    const m = methodByPaper.get(paperId);
    if (!m) return '未提取';
    return buildMethodProfile(m, papers.find((p) => p.id === paperId), papers).family.name;
  };

  /** 排序 + 搜索 + 筛选（全部是纯展示层的排列，不改变数据，也不新增判断） */
  const rows = useMemo(() => {
    let list = visiblePapers.slice();
    if (onlyAnalysed) list = list.filter((p) => methodByPaper.has(p.id));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => {
        const t = (p.title ?? '').toLowerCase();
        const f = familyOf(p.id).toLowerCase();
        return t.includes(q) || f.includes(q);
      });
    }
    const byName = (p: Paper) => (p.title ?? '').toLowerCase();
    list.sort((a, b) => {
      if (sort === '名称') return byName(a).localeCompare(byName(b));
      if (sort === '日期') return (b.year ?? 0) - (a.year ?? 0);
      // 创新度：没有评分的排在最后（不把「无评估」当成 0 分参与比较）
      const sa = scoreOf(a);
      const sb = scoreOf(b);
      if (sa === undefined && sb === undefined) return byName(a).localeCompare(byName(b));
      if (sa === undefined) return 1;
      if (sb === undefined) return -1;
      return sb - sa;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePapers, methods, query, sort, onlyAnalysed, relations]);

  /** 全选：只作用于当前筛选出来的行（真实多选，不是装饰） */
  const visibleIds = rows.map((p) => p.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="libpage sdpage">
      {/* 草稿的 <main> 是 max-w-[var(--content-max)] mx-auto px-6（顶栏 fixed 需 pt-32；本应用顶栏在流内，按上传页先例取 pt-14） */}
      <div className="max-w-[var(--content-max)] mx-auto px-6 pt-14 pb-20">
      {/* 1. 标题行：eyebrow + 4xl 衬线标题 → 右上三个按钮 */}
      <section className="mb-10">
        <div className="flex justify-between items-end mb-8">
          <div className="space-y-1">
            <p className="text-[10px] text-[var(--fg-3)] font-black uppercase tracking-[0.25em]">Paper Repository</p>
            <h1 className="text-4xl font-serif font-bold tracking-tight">论文集合</h1>
          </div>
          <div className="flex gap-3">
            <button className="btn-outline" onClick={onGoCompare} disabled={!visiblePapers.length}>
              <DraftIcon name="layers" />
              跨论文比较
            </button>
            <button className="btn-outline" onClick={onGoDecision} disabled={!visiblePapers.length}>
              <DraftIcon name="map-pin" />
              生成阅读路线
            </button>
            <button className="btn-primary" onClick={() => fileRef.current?.click()}>
              <DraftIcon name="upload" />
              上传新论文
            </button>
          </div>
        </div>

        {/* 2. 四张统计卡（数值全部来自真实数据） */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="content-card bg-white p-5 flex flex-col gap-1">
            <span className="text-[10px] font-black text-[var(--fg-3)] uppercase tracking-wider">已收录论文</span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-serif font-bold text-[var(--accent)]">{visiblePapers.length}</span>
              <span className="text-xs text-[var(--fg-3)]">篇</span>
            </div>
          </div>
          <div className="content-card bg-white p-5 flex flex-col gap-1">
            <span className="text-[10px] font-black text-[var(--fg-3)] uppercase tracking-wider">平均创新评分</span>
            <div className="flex items-baseline gap-2">
              <span
                className="text-3xl font-serif font-bold"
                style={{ color: innovationColor(avgScore) }}
                title="创新度是模型评估，不是论文给出的分数"
              >
                {avgScore === undefined ? '—' : avgScore.toFixed(1)}
              </span>
              <span className="text-xs text-[var(--fg-3)]">/ 10</span>
            </div>
            {noScoreCount > 0 && <span className="text-[10px] text-[var(--fg-3)]">{noScoreCount} 篇未评估，未计入</span>}
          </div>
          <div className="content-card bg-white p-5 flex flex-col gap-1">
            <span className="text-[10px] font-black text-[var(--fg-3)] uppercase tracking-wider">待核查关系</span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-serif font-bold" style={{ color: innovationColor(7.5) }}>
                {String(pendingRelations).padStart(2, '0')}
              </span>
              <span className="text-xs text-[var(--fg-3)]">条</span>
            </div>
          </div>
          <div className="content-card bg-white p-5 flex flex-col gap-1">
            <span className="text-[10px] font-black text-[var(--fg-3)] uppercase tracking-wider">最近分析时间</span>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-[var(--fg)]">{relativeTime(latestExtractedAt)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. 主体：12 栏（9 + 3） */}
      <div className="grid grid-cols-12 gap-8">
        <div className="col-span-12 lg:col-span-9">
          <div className="bg-white rounded-2xl border border-[var(--line)] overflow-hidden shadow-sm">
            {/* 工具栏 */}
            <div className="px-6 py-4 bg-white border-b border-[var(--line)] flex justify-between items-center">
              <div className="flex items-center gap-4">
                <input
                  type="checkbox"
                  className="custom-checkbox"
                  id="select-all"
                  checked={allChecked}
                  onChange={toggleAll}
                  aria-label="全选"
                />
                <span className="text-sm font-bold text-[var(--fg-2)]">
                  全选{selected.size > 0 ? `（已选 ${selected.size}）` : ''}
                </span>
                <div className="h-4 w-px bg-[var(--line)]" />
                <select
                  className="bg-[var(--bg)] border border-[var(--line)] rounded-lg text-xs py-1 px-2 focus:outline-none"
                  value={onlyAnalysed ? 'analysed' : 'all'}
                  onChange={(e) => setOnlyAnalysed(e.target.value === 'analysed')}
                  aria-label="筛选"
                >
                  <option value="all">全部论文</option>
                  <option value="analysed">只看已分析</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <DraftIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-3)] text-sm" />
                  <input
                    type="text"
                    placeholder="搜索论文..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9 pr-4 py-1.5 bg-[var(--bg)] border border-[var(--line)] rounded-lg text-sm w-48 focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <select
                  className="bg-[var(--bg)] border border-[var(--line)] rounded-lg text-xs py-1.5 px-3 focus:outline-none"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  aria-label="排序"
                >
                  <option>按创新度排序</option>
                  <option>按日期排序</option>
                  <option>按名称排序</option>
                </select>
              </div>
            </div>

            {/* 表格 */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[var(--bg)] text-[10px] font-black text-[var(--fg-3)] uppercase tracking-widest">
                  <tr>
                    <th className="px-6 py-3 w-12" />
                    <th className="px-6 py-3">论文标题</th>
                    <th className="px-6 py-3">方法族</th>
                    <th className="px-6 py-3">创新度</th>
                    <th className="px-6 py-3 text-right">操作</th>
                  </tr>
                </thead>
                {/* lrows / lrow / paper-title 是验收脚本的稳定钩子，改名会连带 11 份脚本 */}
                <tbody className="text-sm lrows">
                  {rows.map((p) => {
                    const m = methodByPaper.get(p.id);
                    const job = jobs[p.id];
                    const st = primaryStatus(p, m, job);
                    const score = scoreOf(p);
                    const source =
                      p.source?.kind === 'arxiv'
                        ? 'arXiv'
                        : p.source?.kind === 'paste'
                          ? '粘贴导入'
                          : p.source?.kind === 'upload'
                            ? 'PDF 上传'
                            : '未知来源';
                    return (
                      <tr key={p.id} className={`paper-row lrow${p.id === lastImportedId ? ' just-imported' : ''}`}>
                        <td className="px-6 py-4">
                          <input
                            type="checkbox"
                            className="custom-checkbox"
                            checked={selected.has(p.id)}
                            onChange={() => toggleOne(p.id)}
                            aria-label={`选择 ${p.title}`}
                          />
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-bold text-[var(--fg)] paper-title" title={p.title}>
                            {p.title}
                          </div>
                          <div className="text-[10px] text-[var(--fg-3)]">
                            {p.year ?? '年份未知'} · {source} · {st.text}
                            {titleNeedsConfirm(p) ? ' · 标题待确认' : ''}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-[var(--fg-2)]">{familyOf(p.id)}</td>
                        <td className="px-6 py-4">
                          <span className={innovationBadgeClass(score)} title="创新度是模型评估，不是论文给出的分数">
                            {score === undefined ? '未评估' : score.toFixed(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <button className="text-[var(--accent)] hover:underline font-bold" onClick={() => onOpenResult(p.id)}>
                            查看报告
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length === 0 && (
                <div className="px-6 py-10 text-sm text-[var(--fg-3)]">
                  当前筛选条件下没有论文（共 {visiblePapers.length} 篇在库）。
                </div>
              )}
            </div>
          </div>

          {/* 兼容保留：草稿没有这一块，但加载案例 / 切换语料 / 粘贴导入是我们真实且必需的入口 */}
          <details className="fold libmanage" style={{ marginTop: 20 }}>
            <summary>管理论文与案例（上传 · 粘贴 · 加载示例 · 切换案例 · 进入研究地图）</summary>
            <div className="fold-body">
              <div className="toolbar">
                <button className="btn" onClick={() => fileRef.current?.click()}>
                  上传 PDF
                </button>
                <button className="btn ghost" onClick={() => setPasteOpen((v) => !v)}>
                  粘贴论文文本
                </button>
                <button className="btn ghost" onClick={() => onLoadSample()} disabled={loading}>
                  {loading ? '正在加载…' : scope.paperCount === 0 ? '加载演示案例' : '重新加载演示案例'}
                </button>
                <button className="btn ghost" onClick={() => onSwitchCorpus(corpus === 'vision' ? 'nlp-dev' : 'vision')}>
                  {corpus === 'vision' ? '换成开发回归样例（NLP）' : '换成正式视觉案例'}
                </button>
                {scope.foreignPapers.length > 0 && (
                  <button className="btn ghost" onClick={() => onClearForeign()}>
                    清理其它语料集数据（{scope.foreignPapers.length} 篇）
                  </button>
                )}
                <button className="btn ghost" onClick={onGoMap} disabled={!visiblePapers.length}>
                  进入研究地图
                </button>
                <button className="btn ghost" onClick={onGoGraph} disabled={!visiblePapers.length}>
                  关系图
                </button>
                <button className="btn ghost" onClick={onGoExperiments} disabled={!visiblePapers.length}>
                  实验条件比较
                </button>
                <span className="spacer" />
                <span className="lab">
                  两套语料独立计算，不会混在一起
                  {otherCorpusCount > 0 ? `；另有 ${otherCorpusCount} 篇属另一语料集，已隐藏` : ''}
                </span>
              </div>

              {pasteOpen && (
                <div className="quiet-group tint" style={{ marginTop: 10 }}>
                  <label className="f">论文标题</label>
                  <input
                    className="f"
                    value={pasteTitle}
                    onChange={(e) => setPasteTitle(e.target.value)}
                    placeholder="例如：Attention Is All You Need"
                  />
                  <label className="f" style={{ marginTop: 10 }}>
                    论文正文（按页分隔存储，证据定位能力与 PDF 一致）
                  </label>
                  <textarea className="f" rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
                  <div className="row" style={{ marginTop: 8 }}>
                    <button
                      className="btn primary sm"
                      disabled={pasteText.trim().length < 500}
                      onClick={() => {
                        onPaste(pasteTitle.trim(), pasteText);
                        setPasteText('');
                        setPasteTitle('');
                        setPasteOpen(false);
                      }}
                    >
                      导入这段文本
                    </button>
                    <span className="small dim">至少 500 字符，过短无法可靠抽取与定位</span>
                  </div>
                </div>
              )}

              {selected.size > 0 && (
                <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
                  <span className="small">已选 {selected.size} 篇：</span>
                  <button className="btn sm" onClick={onGoCompare}>
                    比较选中的论文
                  </button>
                  <button className="btn ghost sm" onClick={() => setSelected(new Set())}>
                    清空选择
                  </button>
                </div>
              )}
            </div>
          </details>
        </div>

        {/* 右栏：创新度分布 / 智能路线规划 / 近期动态 */}
        <div className="col-span-12 lg:col-span-3 space-y-6">
          <div className="content-card bg-white p-6 shadow-sm">
            <h4 className="text-[11px] font-black text-[var(--fg-3)] uppercase tracking-widest mb-6">创新度分布</h4>
            <div className="space-y-4">
              {INNOVATION_TIERS.map((tier) => {
                const n = visiblePapers.filter((p) => innovationTier(scoreOf(p))?.key === tier.key).length;
                const pct = visiblePapers.length ? Math.round((n / visiblePapers.length) * 100) : 0;
                return (
                  <div className="space-y-1.5" key={tier.key}>
                    <div className="flex justify-between text-xs font-bold">
                      {/* 文案照草稿原文（阈值口径与 INNOVATION_TIERS 一致，只是写法更短） */}
                      <span>{TIER_SHORT[tier.key]}</span>
                      <span>{n} 篇</span>
                    </div>
                    <div className="stat-bar">
                      <div className="stat-bar-fill" style={{ width: `${pct}%`, background: tier.color }} />
                    </div>
                  </div>
                );
              })}
              {noScoreCount > 0 && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-bold">
                    <span>未评估</span>
                    <span>{noScoreCount} 篇</span>
                  </div>
                  <div className="stat-bar">
                    <div
                      className="stat-bar-fill"
                      style={{
                        width: `${visiblePapers.length ? Math.round((noScoreCount / visiblePapers.length) * 100) : 0}%`,
                        background: 'var(--score-none)',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            <p className="text-[10px] text-[var(--fg-3)] mt-4 leading-relaxed">
              创新度是<strong>模型评估</strong>，不是论文给出的分数；灰色表示本篇还没有评估结果。
            </p>
          </div>

          <div className="content-card bg-[var(--accent)] text-white p-6">
            <DraftIcon name="sparkles" className="text-3xl mb-4 opacity-50" />
            <h4 className="text-lg font-serif font-bold mb-2">智能路线规划</h4>
            <p className="text-xs text-white/70 leading-relaxed mb-6">
              根据你已收录的 {visiblePapers.length} 篇论文与真实关系数据，给出建议的阅读顺序与每一步的理由。
            </p>
            <button
              className="w-full bg-white/10 hover:bg-white/20 border border-white/20 py-2 rounded-lg text-sm font-bold transition-all"
              onClick={onGoDecision}
              disabled={!visiblePapers.length}
            >
              查看推荐路线
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-[var(--line)] p-6">
            <h4 className="text-[11px] font-black text-[var(--fg-3)] uppercase tracking-widest mb-4">近期动态</h4>
            <div className="space-y-4">
              {visiblePapers
                .map((p) => ({ p, t: methodByPaper.get(p.id)?.extractedAt }))
                .filter((x) => typeof x.t === 'number')
                .sort((a, b) => (b.t ?? 0) - (a.t ?? 0))
                .slice(0, 3)
                .map(({ p, t }) => {
                  const score = scoreOf(p);
                  return (
                    <div className="flex gap-3" key={p.id}>
                      <div className="w-1 rounded-full" style={{ background: innovationColor(score) }} />
                      <div className="text-xs">
                        <p className="font-bold">完成分析</p>
                        <p className="text-[10px] text-[var(--fg-3)]">
                          {(p.title ?? '').slice(0, 28)}
                          {t ? ` · ${relativeTime(t)}` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              {visiblePapers.every((p) => typeof methodByPaper.get(p.id)?.extractedAt !== 'number') && (
                <p className="text-xs text-[var(--fg-3)]">还没有分析记录。</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 状态与提示（真实数据派生） */}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) onImport(e.target.files);
          e.target.value = '';
        }}
      />

      {loadResult && loadResult.key === scope.key && !loadResult.ok && (
        <div className="row" style={{ gap: 8, marginTop: 16 }}>
          <Status kind="bad">上次加载失败</Status>
          <span className="small dim">{loadResult.message}</span>
          <button className="btn sm" onClick={() => onLoadSample()}>
            重试加载
          </button>
        </div>
      )}

      {!modelReady && (
        <div className="confirmbar" style={{ marginTop: 16 }}>
          <div className="t">
            <strong>未配置模型</strong>：预置结果由真实模型离线生成，界面处处标明来源；只有「上传自己的论文做实时抽取」需要模型接口。
          </div>
          <button className="btn ghost sm" onClick={onOpenSettings}>
            去配置接口
          </button>
        </div>
      )}

      {staleNotes && staleNotes.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Banner kind="warn">
            <strong>部分结果为早期版本产物，已标记为过期，不作为当前结论：</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {staleNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
            <div style={{ marginTop: 6 }}>
              可比性与关系可信度由程序按当前规则实时重算，不受影响；模型抽取类结果需要重新生成才能反映新规则与提示词。
            </div>
          </Banner>
        </div>
      )}

      {visiblePapers.length === 0 && (
        <div className="quiet-group tint" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>还没有论文：先做这一步</h3>
          <p className="small dim" style={{ marginTop: 0 }}>
            推荐从<strong>正式视觉案例</strong>开始：点下面的主按钮加载，5 篇论文与预置分析结果会一起就绪，
            不需要配置模型也能走完整流程。
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary sm" onClick={() => onLoadSample()}>
              加载正式视觉案例
            </button>
            <button className="btn sm" onClick={() => fileRef.current?.click()}>
              上传自己的 PDF
            </button>
          </div>
        </div>
      )}

      {logLines.length > 0 && (
        <details className="fold" style={{ marginTop: 20 }}>
          <summary>运行日志（真实调用过程，技术信息）</summary>
          <div className="fold-body">
            <div className="log">
              {logLines.slice(-80).map((l, i) => (
                <div key={i} className={/ERROR|失败|中止/.test(l) ? 'e' : /警告|warn/i.test(l) ? 'w' : ''}>
                  {l}
                </div>
              ))}
            </div>
          </div>
        </details>
      )}

      {/* 页脚：草稿的「用户协议 / 隐私政策」我们没有对应页面，换成真实入口 */}
      <footer className="mt-20 pt-12 border-t border-[var(--line)] flex flex-col md:flex-row justify-between items-center gap-8 opacity-60">
        <div className="flex items-center gap-8 text-[11px] font-bold text-[var(--fg-3)] uppercase tracking-[0.1em]">
          <button className="hover:text-[var(--accent)]" onClick={() => onGoHome?.()}>
            返回首页
          </button>
          <button className="hover:text-[var(--accent)]" onClick={onOpenSettings}>
            偏好设置
          </button>
          <button className="hover:text-[var(--accent)]" onClick={onGoMap}>
            研究地图
          </button>
        </div>
        <p className="text-[10px] text-[var(--fg-3)] uppercase tracking-widest">
          © 2026 ResearchPilot · {corpusLabel} · 结果可核验，不做排名
        </p>
      </footer>
      </div>
    </div>
  );
}
