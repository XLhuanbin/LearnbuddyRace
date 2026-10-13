import React from 'react';
import type { Evidence, FieldKey, Method, Paper, Relation } from '../core/types';
import { FIELD_STATUS_TEXT, METHOD_FIELD_LABELS, RELATION_LABELS, RELATION_STATE_LABELS } from '../core/types';
import { LEVEL_LABELS, type ComparabilityReport } from '../core/comparability';
import { buildComparison, toMarkdown } from '../core/compare';
import { withEffectiveMethods } from '../core/effective';
import { buildMethodProfile } from '../core/grouping';
import { DraftIcon } from '../draft-icons';
import { innovationColor } from './innovationScale';
import { Banner, Tag, downloadText } from './common';

const LEVEL_KIND: Record<ComparabilityReport['overall']['level'], string> = {
  comparable: 'ok',
  limited: 'warn',
  not_comparable: 'bad',
  unknown: '',
};

/**
 * 对比维度：草稿 5 行 → 我们真实的字段（不新增维度，只把草稿的编造文案换成真实取值）
 * 草稿行名保留（解决什么问题 / 核心方法是什么 / 使用什么数据场景 / 效果如何 / 有什么局限），
 * 「效果如何」那行额外挂**真实的可比性判定**（规则计算，不是模型自评）。
 */
const DIMENSIONS: { label: string; field: FieldKey; compare?: boolean }[] = [
  { label: '解决什么问题', field: 'researchTask' },
  { label: '核心方法是什么', field: 'coreIdea' },
  { label: '使用什么数据/场景', field: 'datasets' },
  { label: '效果如何', field: 'metrics', compare: true },
  { label: '有什么局限', field: 'limitations' },
];

export function ComparabilityPanel({
  report,
  onOpenEvidence,
  paperById,
}: {
  report: ComparabilityReport;
  onOpenEvidence: (e: Evidence, label: string, paper?: Paper) => void;
  paperById: Map<string, Paper>;
}) {
  const [expanded, setExpanded] = React.useState<string | null>(null);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>可比性判断（规则计算，非模型自评）</h3>
        <Tag kind={LEVEL_KIND[report.overall.level]}>
          {LEVEL_LABELS[report.overall.level]}
        </Tag>
        {!report.overall.numericComparisonAllowed && <Tag kind="bad">禁止直接比较数值</Tag>}
      </div>

      <Banner kind={report.overall.level === 'comparable' ? 'ok' : report.overall.level === 'not_comparable' ? 'bad' : 'warn'}>
        {report.overall.summary}
      </Banner>

      <div className="table-wrap">
        <table className="cmp">
          <thead>
            <tr>
              <th className="rowhead">条件维度</th>
              <th style={{ width: 130 }}>结论</th>
              <th>具体差异 / 依据</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {report.dimensions.map((d) => (
              <React.Fragment key={d.dimension}>
                <tr>
                  <td className="rowhead">{d.label}</td>
                  <td>
                    <Tag kind={LEVEL_KIND[d.level]}>{LEVEL_LABELS[d.level]}</Tag>
                  </td>
                  <td>
                    {d.differences.length > 0 ? (
                      d.differences.map((x, i) => (
                        <div key={i} className={d.level === 'not_comparable' ? 'small' : 'small dim'} style={{ color: d.level === 'not_comparable' ? 'var(--bad)' : undefined }}>
                          {x}
                        </div>
                      ))
                    ) : (
                      <span className="small dim">
                        {d.basis[d.basis.length - 1]?.text || '—'}
                      </span>
                    )}
                    {d.missing.length > 0 && (
                      <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>
                        缺失信息：{d.missing.join('；')}
                      </div>
                    )}
                  </td>
                  <td>
                    <button className="btn ghost sm" onClick={() => setExpanded(expanded === d.dimension ? null : d.dimension)}>
                      {expanded === d.dimension ? '收起' : '依据'}
                    </button>
                  </td>
                </tr>
                {expanded === d.dimension && (
                  <tr>
                    <td className="rowhead">依据明细</td>
                    <td colSpan={3}>
                      {d.basis.map((b, i) => (
                        <div key={i} className="small" style={{ marginBottom: 4 }}>
                          <Tag kind={b.kind === 'evidence' ? 'ok' : b.kind === 'missing' ? 'warn' : ''}>
                            {b.kind === 'evidence' ? '原文证据' : b.kind === 'missing' ? '信息缺失' : '判定规则'}
                          </Tag>{' '}
                          {b.text}
                        </div>
                      ))}
                      <div className="small dim" style={{ marginTop: 6 }}>
                        各论文取值：
                        {d.cells.map((c) => (
                          <div key={c.paperId} style={{ marginTop: 3 }}>
                            · {c.paperTitle.slice(0, 40)}：{c.values.join('、') || '—'}（
                            {c.status === 'verified' ? `可核验 p.${c.evidence?.page ?? '?'}` : c.status}）
                            {c.evidence && (
                              <button
                                className={`ev-btn ${c.evidence.verified ? '' : 'bad'}`}
                                style={{ marginLeft: 6, marginTop: 0 }}
                                onClick={() => onOpenEvidence(c.evidence!, `${d.label} · ${c.paperTitle.slice(0, 20)}`, paperById.get(c.paperId))}
                              >
                                {c.evidence.verified ? '原文' : '对照'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {report.notices.map((n, i) => (
        <p className="small dim" key={i} style={{ marginTop: 8 }}>
          {n}
        </p>
      ))}
    </div>
  );
}

export function CompareView({
  papers,
  methods,
  relations,
  selected,
  onSelectedChange,
  onToggle,
  onOpenEvidence,
}: {
  papers: Paper[];
  methods: Method[];
  relations: Relation[];
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  /** 单篇切换：用函数式状态更新，避免连续快速点击时用陈旧的选择集计算 */
  onToggle: (paperId: string) => void;
  onOpenEvidence: (e: Evidence, label: string, paper?: Paper) => void;
}) {
  const paperById = new Map(papers.map((p) => [p.id, p]));
  const chosen = methods.filter((m) => selected.includes(m.paperId));
  const cmp = chosen.length >= 2 ? buildComparison(chosen, papers) : undefined;
  /** 「修改选中」面板的展开状态：由真按钮控制，面板独立成块（不再用 <details> 的 summary 当按钮） */
  const [selectOpen, setSelectOpen] = React.useState(false);

  const exportMarkdown = () => {
    const rel = relations.map((r) => {
      const a = methods.find((m) => m.id === r.fromMethodId);
      const b = methods.find((m) => m.id === r.toMethodId);
      return {
        fromPaperTitle: paperById.get(a?.paperId ?? '')?.title ?? '未知',
        toPaperTitle: paperById.get(b?.paperId ?? '')?.title ?? '未知',
        type: RELATION_LABELS[r.type],
        evidenceState: RELATION_STATE_LABELS[r.evidenceState],
        evidence: r.evidence?.quote,
        rationale: r.rationale,
      };
    });
    downloadText('researchpilot-方法对比.md', toMarkdown(chosen, papers, rel), 'text/markdown');
  };

  const exportJson = () => {
    // 与 Markdown 导出同口径：都写人工修正后的有效值；AI 原值另存 aiValue，避免丢信息
    const eff = withEffectiveMethods(chosen);
    const rawByPaper = new Map(chosen.map((m) => [m.paperId, m]));
    const payload = {
      exportedAt: new Date().toISOString(),
      notice:
        '本文件由 ResearchPilot 导出。字段值（value / status）为人工修正后的**有效值**，与 Markdown 导出口径一致；' +
        '字段状态含义：可核验=引文已通过全文定位；待人工核对=引文未通过定位或该值为人工修正；' +
        '未找到证据=模型未给引文；缺失=论文未报告或未提取到。' +
        'aiValue 为 AI 原始抽取，仅供对照。comparability 为规则计算结果，系统不做排名。',
      comparability: cmp?.comparability,
      papers: eff.map((m) => {
        const p = paperById.get(m.paperId);
        return { title: p?.title, year: p?.year, source: p?.source.url, parseStatus: p?.parseStatus };
      }),
      methods: eff.map((m) => {
        const raw = rawByPaper.get(m.paperId);
        return {
          paperId: m.paperId,
          model: m.model,
          promptVersion: m.promptVersion,
          cached: !!m.cached,
          fields: Object.fromEntries(
            Object.entries(m.fields).map(([k, v]) => [
              k,
              {
                value: v.value ?? null,
                status: v.status,
                statusText: FIELD_STATUS_TEXT[v.status],
                userCorrected: !!v.userCorrected,
                // AI 原值：这一项被人工修正前的抽取值（未修正时与 value 相同）
                aiValue: raw?.fields[k as FieldKey]?.value ?? null,
                evidence: v.evidence
                  ? { page: v.evidence.page, verified: v.evidence.verified, quote: v.evidence.quote, matchType: v.evidence.matchType }
                  : null,
              },
            ]),
          ),
          conditions: m.conditions,
          validation: m.validation,
          overrides: m.overrides,
        };
      }),
      relations: relations.map((r) => ({
        from: r.fromMethodId,
        to: r.toMethodId,
        type: r.type,
        evidenceState: r.evidenceState,
        evidenceQuote: r.evidence?.quote ?? null,
        rationale: r.rationale ?? null,
        stateAdjusted: r.stateAdjusted ?? [],
        userEdited: !!r.userEdited,
        aiOriginal: r.aiOriginal ?? null,
      })),
    };
    downloadText('researchpilot-方法对比.json', JSON.stringify(payload, null, 2), 'application/json');
  };

  return (
    <div className="cmppage sdpage">
      <div className="max-w-[1440px] mx-auto px-10 pt-14 pb-24">
        {/* 标题行：只有 eyebrow + 4xl 衬线标题（按钮挪到下一行，
            否则展开「修改选中」的面板会把标题挤换行） */}
        <div className="space-y-1 mb-6">
          <p className="text-[var(--fg-3)] tracking-[0.3em] uppercase text-xs font-bold">Comparative Analysis</p>
          <h1 className="text-4xl font-serif font-bold tracking-tight">跨论文比较</h1>
        </div>

        {/* 按钮行：两个等规格的按钮（都用真 button，宽度由文案决定，不再因展开面板而变形） */}
        <div className="flex items-center gap-3 mb-8">
          <button className="btn-outline cmpbtn" onClick={() => setSelectOpen((v) => !v)} aria-expanded={selectOpen}>
            <DraftIcon name="edit-3" />
            修改选中（{selected.length}）
          </button>
          <button className="btn-outline cmpbtn" onClick={exportMarkdown} disabled={!cmp}>
            <DraftIcon name="download" />
            导出对比报告
          </button>
        </div>

        {/* 选择面板：独立区块（展开与否都不改变上面按钮的尺寸） */}
        {selectOpen && (
          <div className="content-card bg-white mb-8">
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {methods.length === 0 && <span className="muted">还没有已完成抽取的论文。</span>}
              {methods.map((m) => {
                const p = paperById.get(m.paperId);
                const on = selected.includes(m.paperId);
                return (
                  <button
                    key={m.paperId}
                    className={`btn sm ${on ? 'primary' : ''}`}
                    onClick={() => onToggle(m.paperId)}
                  >
                    {on ? '✓ ' : ''}
                    {(p?.title ?? m.paperId).slice(0, 30)}
                  </button>
                );
              })}
              {methods.length > 0 && (
                <>
                  <button className="btn ghost sm" onClick={() => onSelectedChange(methods.map((m) => m.paperId))}>
                    全选
                  </button>
                  <button className="btn ghost sm" onClick={() => onSelectedChange([])}>
                    清空
                  </button>
                </>
              )}
            </div>
            <p className="text-xs text-[var(--fg-3)] mt-3">
              至少选两篇才会生成对比表；可比性由程序按当前规则实时计算，条件不一致时禁止直接比较数值。
            </p>
          </div>
        )}

        {!cmp && (
          <div className="content-card bg-white">
            <p className="text-sm text-[var(--fg-2)] leading-relaxed">
              请至少选择两篇论文（点上方「修改选中」）。选好后会先用规则检查数据集、数据划分、指标、
              额外训练数据、预训练模型与实验设置，给出「可以直接比较 / 只能有限比较 / 当前不能直接比较」的结论；
              条件不一致时禁止直接比较数值，系统也不做排名。可比性判断由程序按当前规则实时计算。
            </p>
          </div>
        )}

        {cmp && (
          <>
            <div className="w-full overflow-x-auto rounded-2xl border border-[var(--line)] bg-white shadow-sm">
              <table className="w-full comparison-table">
                <thead className="comparison-header">
                  <tr>
                    <th className="dim-label bg-[var(--bg-4)]">对比维度</th>
                    {cmp.columns.map((m, i) => {
                      const p = paperById.get(m.paperId);
                      const prof = buildMethodProfile(m, p, papers);
                      const score = m.assessment?.innovation?.value;
                      return (
                        <th className="paper-cell bg-white" key={m.paperId}>
                          <div className="flex flex-col gap-2">
                            <span className="text-[10px] font-bold text-[var(--fg-3)]">
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            {/* 草稿的 h1/h2/h3 都是衬线（它的 style 块写了 Noto Serif SC），这里补上 */}
                            <h3 className="text-lg font-serif font-bold leading-tight">{p?.title ?? m.paperId}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              <span
                                className="text-xs font-bold"
                                style={{ color: innovationColor(typeof score === 'number' ? score : undefined) }}
                                title="创新度是模型评估，不是论文给出的分数"
                              >
                                {typeof score === 'number' ? `${score.toFixed(1)} / 10` : '未评估'}
                              </span>
                              {/* 草稿这里写「• Devlin et al.」—— 我们没有作者数据，统一换成真实的方法族 */}
                              <span className="text-[10px] text-[var(--fg-3)]">• {prof.family.name}</span>
                            </div>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {DIMENSIONS.map((dim) => (
                    <tr className="comparison-row" key={dim.field}>
                      <td className="dim-label">{dim.label}</td>
                      {cmp.columns.map((m) => {
                        const p = paperById.get(m.paperId);
                        const cell = m.fields[dim.field];
                        const ev = cell?.evidence;
                        return (
                          <td className="paper-cell" key={m.paperId}>
                            {/* 可比性判定：程序按规则算出来的，不是模型自评（草稿的标签是编的文案） */}
                            {dim.compare && (
                              <div className="mb-2">
                                <span
                                  className={`tag-fair ${
                                    cmp.comparability.overall.level === 'comparable'
                                      ? 'tag-fair-true'
                                      : 'tag-fair-false'
                                  }`}
                                  title={cmp.comparability.overall.summary}
                                >
                                  {cmp.comparability.overall.level === 'comparable'
                                    ? '可公平比较'
                                    : cmp.comparability.overall.level === 'not_comparable'
                                      ? '当前不能直接比较'
                                      : `慎重对比：${cmp.comparability.overall.summary.slice(0, 24)}`}
                                </span>
                              </div>
                            )}
                            <p className="text-sm text-[var(--fg-2)] leading-relaxed">
                              {cell?.value || <span className="text-[var(--fg-3)]">—</span>}
                            </p>
                            <div className="mt-2">
                              <Tag kind={cell?.status === 'verified' ? 'ok' : cell?.status === 'missing' ? 'bad' : 'warn'}>
                                {FIELD_STATUS_TEXT[cell?.status ?? 'missing']}
                              </Tag>
                            </div>
                            {ev && (
                              <button
                                className="ev-btn text-[10px] font-bold text-[var(--accent)] mt-3 flex items-center gap-1 hover:underline"
                                onClick={() =>
                                  onOpenEvidence(ev, `${(p?.title ?? '').slice(0, 26)} · ${dim.label}`, p)
                                }
                              >
                                {ev.verified ? `查看原文证据 p.${ev.page ?? '?'}` : '查看实际匹配位置'}
                                <DraftIcon name="chevron-down" />
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 可比性明细：草稿没有这一块，但它是本页的核心证据，收进折叠保留 */}
            <details className="fold" style={{ marginTop: 20 }}>
              <summary>可比性判断明细（规则计算，非模型自评）</summary>
              <div className="fold-body">
                <ComparabilityPanel
                  report={cmp.comparability}
                  onOpenEvidence={onOpenEvidence}
                  paperById={paperById}
                />
              </div>
            </details>

            {cmp.globalWarnings.slice(1).map((w, i) => (
              <Banner key={i} kind="warn">
                {w}
              </Banner>
            ))}

            {/* 页脚（照草稿结构，内容换成真实的） */}
            <div className="mt-12 flex items-center justify-between">
              <button
                className="text-sm font-bold text-[var(--fg-3)] hover:text-[var(--accent)] flex items-center gap-2 transition-colors"
                onClick={() => onSelectedChange([])}
              >
                <DraftIcon name="arrow-left" /> 清空选择
              </button>
              <div className="flex items-center gap-4 text-xs text-[var(--fg-3)]">
                <span>字段与引文由 ResearchPilot 从论文原文抽取并回原文定位</span>
                <span className="w-1 h-1 bg-[var(--line-2)] rounded-full" />
                <span>可比性由程序按当前规则实时计算 · 系统不做排名</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
