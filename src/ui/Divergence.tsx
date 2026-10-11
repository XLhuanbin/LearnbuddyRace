import React, { useMemo, useState } from 'react';
import type { DivergenceReport, Evidence, Method, Paper } from '../core/types';
import { DIVERGENCE_LABELS } from '../core/types';
import {
  LEVEL_LABELS,
  SCREENING_NOTICE,
  differingDimensions,
  pairLevel,
} from '../core/comparability';
import { Banner, Tag, downloadText } from './common';
import { DraftIcon } from '../draft-icons';

/**
 * 待调查问题（草稿 2b574366 v1）：左侧「分类 + 可比性」筛选栏，右侧问题卡片列表。
 *
 * 结构与草稿一一对应，但**草稿里所有编造的字段一律不采纳**，逐处换成真实数据（见每处注释）：
 * - 草稿的「问题分类」理论缺陷 / 实验验证不足 / 方法改进空间 / 跨领域机会 → 我们的真实分歧类型
 *   （`DIVERGENCE_LABELS`，由 `divergenceRules.ts` 判定），计数按当前报告实时统计。
 * - 草稿的「优先级 高/中/低」→ 换成真实的**可比性**四档（`comparability.ts` 程序计算，与「跨论文比较」页同源）。
 *   理由与配色映射见 `draft.css` 里 `.dvpage` 段的说明（草稿那三个色是装饰性的，本项目绿/橙/红只表真实状态）。
 * - 草稿的「收藏 / 标记已解决」两个按钮 + 「已收藏(3) / 已解决」页签 → 我们没有这种用户状态，
 *   换成三个真实操作与三个真实页签（判据只有 `evidence.ts` 的 `verified`）：
 *     星标位 → 打开相关论文；对勾位 → 导出这一条；页签 → 全部 / 引文已核验 / 待核查。
 * - 草稿左下「基于你上传的 12 篇论文…下载 PDF 完整报告」→ 真实篇数 + 真实导出（Markdown，我们没有 PDF 导出）。
 * - 草稿的 `<a href="#">` 一律换成 `<button type="button">`（草稿的假链接点了会跳走）。
 *
 * 三条不许破的底线：不排名、不制造冲突（`checkedPairs` 全量列出）、引文只认程序定位结果。
 */
export function DivergenceView({
  papers,
  methods,
  report,
  busy,
  onGenerate,
  onCancel,
  onUseSample,
  staleNotes,
  onOpenPaper,
  onOpenEvidence,
}: {
  papers: Paper[];
  methods: Method[];
  report?: DivergenceReport;
  busy: boolean;
  onGenerate: () => void;
  /** 停止等待（只停止本地等待） */
  onCancel?: () => void;
  onUseSample: () => void;
  staleNotes?: string[];
  /** 打开某篇论文的分析结果页（真实入口，草稿的「星标」位换成了它） */
  onOpenPaper?: (paperId: string) => void;
  /** 跳到引文在论文全文里的位置并高亮（与其它 5 个页面同一个入口） */
  onOpenEvidence?: (e: Evidence, label: string, paper?: Paper) => void;
}) {
  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const findings = report?.findings ?? [];

  /**
   * 「已检查的论文对」由程序按**当前**论文集合实时重算，与比较页调用同一个函数，
   * 因此两页对同一论文对的结论与理由必然一致，不依赖缓存里可能过期的结论。
   */
  const checkedPairs = useMemo(() => {
    const out: { pair: string; result: string }[] = [];
    for (let i = 0; i < methods.length; i++) {
      for (let j = i + 1; j < methods.length; j++) {
        const a = methods[i].paperId;
        const b = methods[j].paperId;
        const level = pairLevel(papers, methods, a, b);
        const diffs = differingDimensions(papers, methods, a, b);
        out.push({
          pair: `${paperById.get(a)?.title ?? a} ↔ ${paperById.get(b)?.title ?? b}`,
          result: `可比性=${LEVEL_LABELS[level]}${diffs.length ? `；条件差异：${diffs.map((d) => d.label).join('、')}` : ''}`,
        });
      }
    }
    return out;
  }, [papers, methods, paperById]);

  /* ---------------- 筛选状态 ---------------- */
  const [kindFilter, setKindFilter] = useState<'all' | DivergenceKind>('all');
  const [levelFilter, setLevelFilter] = useState<CmpLevel[]>([]);
  const [tab, setTab] = useState<'all' | 'verified' | 'pending'>('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);

  /** 分类计数：只统计当前报告里真实出现过的类型（没出现的类型不列，避免「0 条」占位） */
  const kindCounts = useMemo(() => {
    const m = new Map<DivergenceKind, number>();
    for (const f of findings) m.set(f.kind, (m.get(f.kind) ?? 0) + 1);
    return m;
  }, [findings]);

  /** 可比性计数：四档全列出（0 的置灰），让「我们查了但没出现」也是可见的 */
  const levelCounts = useMemo(() => {
    const m = new Map<CmpLevel, number>();
    for (const l of CMP_LEVELS) m.set(l, 0);
    for (const f of findings) m.set(f.comparabilityLevel, (m.get(f.comparabilityLevel) ?? 0) + 1);
    return m;
  }, [findings]);

  const evStates = useMemo(() => new Map(findings.map((f) => [f.id, evidenceState(f.sides)])), [findings]);
  const verifiedCount = evStates.size ? [...evStates.values()].filter((s) => s === 'verified').length : 0;

  const q = query.trim().toLowerCase();
  const filtered = findings.filter((f) => {
    if (kindFilter !== 'all' && f.kind !== kindFilter) return false;
    if (levelFilter.length > 0 && !levelFilter.includes(f.comparabilityLevel)) return false;
    if (tab === 'verified' && evStates.get(f.id) !== 'verified') return false;
    if (tab === 'pending' && evStates.get(f.id) === 'verified') return false;
    if (q) {
      const hay = [
        f.topic,
        f.explanation,
        f.nextAction,
        f.commonScope ?? '',
        ...f.paperIds.map((id) => paperById.get(id)?.title ?? ''),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const visible = filtered.slice(0, shown);
  const filterActive = kindFilter !== 'all' || levelFilter.length > 0 || tab !== 'all' || q.length > 0;

  const resetFilters = () => {
    setKindFilter('all');
    setLevelFilter([]);
    setTab('all');
    setQuery('');
    setShown(PAGE_SIZE);
  };

  /* ---------------- 导出 ---------------- */
  const exportAll = () => {
    if (!report) return;
    const lines = [
      '# 跨论文分歧与待调查问题（ResearchPilot 导出）',
      '',
      `生成时间：${new Date(report.generatedAt).toLocaleString('zh-CN')}`,
      report.cached ? '模型输出来源：预置缓存（非本次实时调用）' : '模型输出来源：本次实时调用',
      `判定规则版本：${report.derivedFrom?.rulesVersion ?? '未知'}；提示词版本：${report.promptVersion ?? '未知'}`,
      '',
      '> 「已检查的论文对」由程序按当前论文集合实时重算，与比较页同源。',
      '',
    ];
    report.findings.forEach((f) => lines.push(...findingToMarkdown(f, paperById)));
    lines.push('## 已检查的论文对（按当前论文集合实时重算）', '');
    checkedPairs.forEach((c) => lines.push(`- ${c.pair}：${c.result}`));
    lines.push('', '---', '本文件不包含任何 API 密钥。');
    downloadText('researchpilot-分歧与待调查问题.md', lines.join('\n'), 'text/markdown');
  };

  const exportOne = (f: DivergenceReport['findings'][number]) => {
    const lines = ['# 待调查问题（单条导出）', '', ...findingToMarkdown(f, paperById)];
    lines.push('', '---', '本文件不包含任何 API 密钥。');
    const name = `researchpilot-待调查问题-${f.id}.md`;
    downloadText(name, lines.join('\n'), 'text/markdown');
  };

  return (
    <div className="dvpage sdpage">
      <div className="max-w-[1440px] mx-auto px-10 pt-14 pb-4">
        <div className="grid grid-cols-12 gap-y-10 lg:gap-10">
          {/* ---------------- 左栏：筛选 + 洞察包 ---------------- */}
          <aside className="col-span-12 lg:col-span-3 min-w-0 space-y-8">
            <div className="space-y-4">
              <h3 className="text-xs font-bold tracking-[0.2em] text-[var(--fg-3)] uppercase">问题分类筛选</h3>
              <nav className="flex flex-col gap-1">
                <button
                  type="button"
                  className={`sidebar-link flex items-center justify-between px-3 py-2 rounded-r-md text-sm text-left${
                    kindFilter === 'all' ? ' active' : ' text-[var(--fg-2)] hover:bg-[var(--bg-3)]'
                  }`}
                  onClick={() => {
                    setKindFilter('all');
                    setShown(PAGE_SIZE);
                  }}
                >
                  <span>全部问题</span>
                  <span className="text-xs opacity-50">{findings.length}</span>
                </button>
                {[...kindCounts.entries()].map(([k, n]) => (
                  <button
                    key={k}
                    type="button"
                    title={DIVERGENCE_LABELS[k]}
                    className={`sidebar-link flex items-center justify-between gap-2 px-3 py-2 rounded-r-md text-sm text-left${
                      kindFilter === k ? ' active' : ' text-[var(--fg-2)] hover:bg-[var(--bg-3)]'
                    }`}
                    onClick={() => {
                      setKindFilter(kindFilter === k ? 'all' : k);
                      setShown(PAGE_SIZE);
                    }}
                  >
                    <span className="min-w-0">{DIVERGENCE_LABELS[k]}</span>
                    <span className="text-xs opacity-50 shrink-0">{n}</span>
                  </button>
                ))}
              </nav>
            </div>

            {/* 草稿这一栏是「优先级 高/中/低」；我们的真实维度是可比性（程序计算，四档） */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold tracking-[0.2em] text-[var(--fg-3)] uppercase">可比性（程序判定）</h3>
              <div className="flex flex-col gap-2">
                {CMP_LEVELS.map((lv) => {
                  const n = levelCounts.get(lv) ?? 0;
                  const on = levelFilter.includes(lv);
                  return (
                    <label
                      key={lv}
                      className={`flex items-center gap-2 text-sm ${n === 0 ? 'opacity-40' : 'cursor-pointer'}`}
                      title={n === 0 ? '当前语料里没有落在这一档的条目（不是未检查：全部论文对都已在下方列出）' : undefined}
                    >
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-[var(--line)]"
                        checked={on}
                        disabled={n === 0}
                        onChange={() => {
                          setLevelFilter(on ? levelFilter.filter((x) => x !== lv) : [...levelFilter, lv]);
                          setShown(PAGE_SIZE);
                        }}
                      />
                      <span className="flex items-center gap-2">
                        {LEVEL_LABELS[lv]}
                        <span className={`cmp-dot cmp-${lv}`} />
                        <span className="text-xs text-[var(--fg-3)]">{n}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 草稿的「AI 问题洞察包」卡（品牌色）。内容换成真实数字与真实导出：我们没有 PDF 导出 */}
            <div className="p-6 bg-[var(--accent)] rounded-2xl text-white relative overflow-hidden">
              <div className="relative z-10 space-y-3">
                <h4 className="font-serif font-bold text-lg">AI 问题洞察包</h4>
                <p className="text-xs opacity-80 leading-relaxed">
                  {report
                    ? `基于当前 ${papers.length} 篇论文的 ${findings.length} 条发现，其中 ${verifiedCount} 条的每条立场都能在原文中定位到引文。`
                    : `当前 ${papers.length} 篇论文尚未分析；分析后会按论文对逐条核查，并列出所有已检查的论文对。`}
                </p>
                {report && (
                  <p className="text-xs opacity-70">
                    来源：{report.cached ? '预置示例（非实时）' : '本次实时调用'} · {report.model ?? '模型未记录'} ·{' '}
                    {report.derivedFrom?.rulesVersion ?? '规则未知'}/{report.promptVersion ?? '提示词未知'}
                  </p>
                )}
                <button
                  type="button"
                  className="text-xs font-bold border border-white/30 px-3 py-2 rounded hover:bg-white/10 transition-colors w-full"
                  disabled={busy || papers.length === 0}
                  style={busy || papers.length === 0 ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                  onClick={onGenerate}
                >
                  {busy ? '分析中…' : report ? '重新分析' : '分析待调查问题'}
                </button>
                <button
                  type="button"
                  className="text-xs font-bold border border-white/30 px-3 py-2 rounded hover:bg-white/10 transition-colors w-full"
                  disabled={!report}
                  style={!report ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                  onClick={exportAll}
                >
                  导出全部为 Markdown
                </button>
                {busy && onCancel && (
                  <button type="button" className="text-xs underline opacity-80 w-full" onClick={onCancel}>
                    停止等待（只停止本机等待）
                  </button>
                )}
                {!report && (
                  <button type="button" className="text-xs underline opacity-80 w-full" onClick={onUseSample}>
                    查看预置示例结果
                  </button>
                )}
              </div>
              <DraftIcon name="sparkles" className="absolute -bottom-2 -right-2 text-6xl opacity-10" />
            </div>
          </aside>

          {/* ---------------- 右栏：搜索 + 页签 + 问题卡 ---------------- */}
          <section className="col-span-12 lg:col-span-9 min-w-0 space-y-8">
            {staleNotes && staleNotes.length > 0 && (
              <Banner kind="warn">
                <strong>该分析的部分内容来自早期版本：</strong>
                {/* 列表项是「承载解释的整句」，按项目口径取 --fs-aux(13.5px)；Banner 默认给的是 13px */}
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 'var(--fs-aux)' }}>
                  {staleNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
                其中「已检查的论文对」与各条发现的可比性已由程序按当前规则重算，规则结论不存在过期问题；模型给出的文字说明仍来自旧版提示词。
              </Banner>
            )}

            <div className="flex flex-col gap-6">
              <div className="flex justify-between items-end gap-6 flex-wrap">
                <div className="space-y-1">
                  <p className="text-[var(--fg-3)] tracking-[0.3em] uppercase text-xs font-bold">
                    Knowledge Gaps &amp; Future Directions
                  </p>
                  <h1 className="text-4xl font-serif font-bold tracking-tight">待调查问题</h1>
                </div>
                <div className="flex items-center gap-4 search-bar px-4 py-2 w-72">
                  <DraftIcon name="search" className="text-[var(--fg-3)]" />
                  <input
                    type="text"
                    placeholder="搜索问题关键词…"
                    className="bg-transparent text-sm outline-none w-full"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setShown(PAGE_SIZE);
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 border-b border-[var(--line)]">
                <TabButton
                  active={tab === 'all'}
                  onClick={() => setTab('all')}
                  label="全部"
                  count={findings.length}
                  title="当前语料里的全部发现"
                />
                <TabButton
                  active={tab === 'verified'}
                  onClick={() => setTab('verified')}
                  label="引文已核验"
                  count={verifiedCount}
                  title="每一条立场都有引文，且都通过了全文定位校验"
                />
                <TabButton
                  active={tab === 'pending'}
                  onClick={() => setTab('pending')}
                  label="待核查"
                  count={findings.length - verifiedCount}
                  title="至少一条立场没有引文，或引文未能在论文全文中定位"
                />
                {filterActive && (
                  <button
                    type="button"
                    className="ml-auto pb-4 text-xs font-bold text-[var(--accent)] hover:underline"
                    onClick={resetFilters}
                  >
                    清除筛选
                  </button>
                )}
              </div>
            </div>

            {!report && (
              <div className="lite">
                <p className="small" style={{ margin: 0 }}>
                  尚未分析。分析会同时给出「已检查的论文对」清单，用于说明没有为了展示而制造冲突。
                </p>
              </div>
            )}

            {report && filtered.length === 0 && (
              <div className="lite">
                <p className="small" style={{ margin: 0 }}>
                  {filterActive
                    ? `当前筛选条件下没有条目（共 ${findings.length} 条）。`
                    : '当前语料未发现待调查问题：这与「已检查」是两回事，全部论文对的检查结果在页面底部列出。'}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-6">
              {visible.map((f) => {
                const ev = pickEvidence(f.sides);
                const titles = f.paperIds.map((id) => paperById.get(id)?.title ?? id);
                return (
                  <article className="content-card bg-white flex flex-col gap-4" key={f.id}>
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`cmp-badge cmp-${f.comparabilityLevel}`} title="与「跨论文比较」页同源的程序判定">
                          {LEVEL_LABELS[f.comparabilityLevel]}
                        </span>
                        <span className="cat-tag">{DIVERGENCE_LABELS[f.kind]}</span>
                        <span className="cat-tag">
                          {f.claimType === 'numeric' ? '数值结果' : f.claimType === 'qualitative' ? '定性主张' : '类型未标注'}
                        </span>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg-3)] transition-colors"
                          title={titles.length > 1 ? `打开相关论文（共 ${titles.length} 篇，先打开第一篇）` : '打开相关论文'}
                          disabled={!onOpenPaper || f.paperIds.length === 0}
                          onClick={() => f.paperIds[0] && onOpenPaper?.(f.paperIds[0])}
                        >
                          <DraftIcon name="book-open" className="text-lg text-[var(--fg-3)]" />
                        </button>
                        <button
                          type="button"
                          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg-3)] transition-colors"
                          title="导出这一条（Markdown）"
                          onClick={() => exportOne(f)}
                        >
                          <DraftIcon name="download" className="text-lg text-[var(--fg-3)]" />
                        </button>
                      </div>
                    </div>

                    <h3 className="text-lg font-bold leading-snug">{f.topic}</h3>
                    <p className="text-sm text-[var(--fg-2)]" style={{ margin: 0 }}>
                      {f.explanation}
                    </p>
                    <p className="text-sm text-[var(--fg-2)]" style={{ margin: 0 }}>
                      <span className="font-bold text-[var(--fg)]">下一步核查：</span>
                      {f.nextAction}
                    </p>

                    <div className="flex items-center justify-between gap-4 mt-2 pt-4 border-t border-[var(--line)] flex-wrap">
                      {/* 论文标题是实打实的内容（不是元数据），按项目口径用 ≥13.5px，不用草稿的 12px */}
                      <span className="text-sm text-[var(--fg-3)]">
                        涉及论文：
                        <span className="text-[var(--fg-2)] font-medium">{titles.join('、')}</span>
                      </span>
                      <button
                        type="button"
                        className="text-[var(--accent)] text-xs font-bold hover:underline flex items-center gap-1"
                        disabled={!ev || !onOpenEvidence}
                        style={!ev || !onOpenEvidence ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                        title={ev ? undefined : '这一条没有可定位的引文'}
                        onClick={() => ev && onOpenEvidence?.(ev.ev, ev.label)}
                      >
                        查看相关段落 <DraftIcon name="arrow-up-right" />
                      </button>
                    </div>

                    {/* 固定声明必须常显：收进折叠里等于没写（折叠内容不在 innerText 里，用户也看不到） */}
                    <p className="text-xs text-[var(--fg-3)]" style={{ margin: 0 }}>
                      {f.disclaimer}
                    </p>

                    {/* 草稿卡面只有「题 + 一段说明 + 底栏」；我们的真实依据比它多，收在展开里，默认不占版面 */}
                    <details className="fold">
                      <summary>
                        查看完整判断依据（立场对照 · 条件差异 · 程序复核）
                        {f.comparabilityLevel !== 'comparable' && (
                          <span className="text-[var(--fg-3)]"> · 可比性：{LEVEL_LABELS[f.comparabilityLevel]}</span>
                        )}
                      </summary>

                      <div className="small" style={{ marginBottom: 6 }}>
                        <span className="dim">共同比较范围：</span>
                        {f.commonScope || (
                          <span style={{ color: 'var(--warn)' }}>模型未给出共同对象，因此不认定为分歧</span>
                        )}
                      </div>

                      {f.sides.length > 0 && (
                        <div className="table-wrap" style={{ marginBottom: 10 }}>
                          <table className="cmp">
                            <thead>
                              <tr>
                                <th style={{ width: 220 }}>论文</th>
                                <th>该论文的结论 / 做法</th>
                              </tr>
                            </thead>
                            <tbody>
                              {f.sides.map((s, i) => (
                                <tr key={i}>
                                  <td>{paperById.get(s.paperId)?.title ?? s.paperId}</td>
                                  <td>
                                    {s.claim}
                                    {s.quote && (
                                      <div className="ev-quote" style={{ marginTop: 6, fontSize: 12.5 }}>
                                        {s.quote}
                                        {/* 页码只在定位校验通过时才有；模型自称的页码一律不展示 */}
                                        {s.quoteEvidence?.verified
                                          ? `　（原文已定位${s.page ? `：p.${s.page}` : ''}）`
                                          : ''}
                                      </div>
                                    )}
                                    {s.quote && !s.quoteEvidence?.verified && (
                                      <div className="small" style={{ marginTop: 4, color: 'var(--pending)' }}>
                                        <Tag kind="pending">待核查</Tag>{' '}
                                        {s.quoteNote || '该引文未能在论文全文中定位，不能作为已核验证据。'}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {f.conditionDifferences && f.conditionDifferences.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <div className="small dim" style={{ marginBottom: 4 }}>
                            条件差异（这些差异使结果无法归因于方法本身）
                          </div>
                          {f.conditionDifferences.map((d, i) => (
                            <div className="small" key={i} style={{ color: 'var(--warn)' }}>
                              · {d.label}：{d.detail}
                            </div>
                          ))}
                        </div>
                      )}

                      {f.ruleNotes && f.ruleNotes.length > 0 && (
                        <div className="small" style={{ marginBottom: 6 }}>
                          <Tag kind="info">程序复核</Tag>
                          {f.ruleNotes.map((n, i) => (
                            <div key={i} style={{ marginTop: 3 }}>
                              {n}
                            </div>
                          ))}
                        </div>
                      )}
                    </details>
                  </article>
                );
              })}
            </div>

            {report && filtered.length > shown && (
              <div className="flex justify-center mt-12">
                <button
                  type="button"
                  className="btn-outline flex items-center gap-2 px-8 py-3"
                  onClick={() => setShown(shown + PAGE_SIZE)}
                >
                  加载更多问题 <DraftIcon name="refresh-cw" />
                </button>
              </div>
            )}

            {report && (
              <details className="fold">
                <summary>
                  已检查的论文对（{checkedPairs.length}，按当前论文集合实时重算）
                </summary>
                <p className="small dim" style={{ marginTop: 0 }}>
                  与「跨论文比较」页调用同一套规则，因此同一论文对在两页的结论与理由一致。未列为分歧的组合都在这里，
                  说明系统没有为了展示而生成冲突。
                </p>
                <div className="table-wrap">
                  <table className="cmp" style={{ minWidth: 520 }}>
                    <thead>
                      <tr>
                        <th>论文对</th>
                        <th>检查结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checkedPairs.map((c) => (
                        <tr key={c.pair}>
                          <td className="small">{c.pair}</td>
                          <td className="small">{c.result}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small dim" style={{ marginTop: 8 }}>
                  {SCREENING_NOTICE}
                </p>
              </details>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ============================ 辅助 ============================ */

const PAGE_SIZE = 6;

type CmpLevel = DivergenceReport['findings'][number]['comparabilityLevel'];
type DivergenceKind = DivergenceReport['findings'][number]['kind'];

/** 展示顺序：从「能直接比较」到「信息不足」 */
const CMP_LEVELS: CmpLevel[] = ['comparable', 'limited', 'not_comparable', 'unknown'];

/**
 * 一条发现的引文校验状态。判据**只有** `evidence.ts` 校验出来的 `verified`，界面不得自造。
 * - verified：**每一条立场**都有引文、且都通过了全文定位（少一条就说明这条发现还有没核验的部分）；
 * - pending：至少一条立场没有引文，或引文未通过定位（含「尚未取回全文」）。
 */
function evidenceState(sides: DivergenceReport['findings'][number]['sides']): 'verified' | 'pending' {
  if (sides.length === 0) return 'pending';
  return sides.every((s) => !!s.quote && s.quoteEvidence?.verified === true) ? 'verified' : 'pending';
}

/** 「查看相关段落」用哪一条引文：优先已核验的，其次任意有定位结果的 */
function pickEvidence(
  sides: DivergenceReport['findings'][number]['sides'],
): { ev: Evidence; label: string } | undefined {
  const withEv = sides.filter((s) => s.quoteEvidence);
  const chosen = withEv.find((s) => s.quoteEvidence!.verified) ?? withEv[0];
  if (!chosen) return undefined;
  return { ev: chosen.quoteEvidence!, label: chosen.quote?.slice(0, 40) ?? '原文依据' };
}

/** 单条发现的 Markdown（整份导出与「导出这一条」共用，口径必须一致） */
function findingToMarkdown(
  f: DivergenceReport['findings'][number],
  paperById: Map<string, Paper>,
): string[] {
  const lines: string[] = [];
  lines.push(`## [${DIVERGENCE_LABELS[f.kind]}] ${f.topic}`);
  lines.push(`- 可比性（程序按论文对计算）：${LEVEL_LABELS[f.comparabilityLevel]}`);
  lines.push(`- 涉及论文：${f.paperIds.map((id) => paperById.get(id)?.title ?? id).join('；') || '—'}`);
  lines.push(
    `- 主张类型：${f.claimType === 'numeric' ? '数值结果' : f.claimType === 'qualitative' ? '定性主张' : '未标注'}`,
  );
  lines.push(`- 共同比较范围：${f.commonScope || '（未给出）'}`);
  f.sides.forEach((s) => {
    lines.push(`- 立场（${paperById.get(s.paperId)?.title ?? s.paperId}）：${s.claim}`);
    if (s.quote) {
      const mark = s.quoteEvidence?.verified
        ? `（原文已定位${s.page ? `：p.${s.page}` : ''}）`
        : '（待核查：该引文未通过全文定位校验）';
      lines.push(`  > ${s.quote}${mark}`);
    }
  });
  if (f.conditionDifferences?.length) {
    lines.push(`- 条件差异：${f.conditionDifferences.map((d) => `${d.label}：${d.detail}`).join('；')}`);
  }
  lines.push(`- 说明：${f.explanation}`);
  lines.push(`- 下一步：${f.nextAction}`);
  if (f.ruleNotes?.length) lines.push(`- 程序复核：${f.ruleNotes.join(' ')}`);
  lines.push(`- 声明：${f.disclaimer}`);
  lines.push('');
  return lines;
}

/** 草稿里的页签是 `<button class="… border-b-2 … pb-4">`，激活态只换颜色与字重 */
function TabButton({
  active,
  label,
  count,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`text-sm pb-4 ${
        active
          ? 'font-bold border-b-2 border-[var(--accent)] text-[var(--fg)]'
          : 'font-medium text-[var(--fg-3)] hover:text-[var(--fg)]'
      }`}
      onClick={onClick}
    >
      {label}
      <span className={`ml-2 text-xs ${active ? 'opacity-70' : 'opacity-50'}`}>{count}</span>
    </button>
  );
}
