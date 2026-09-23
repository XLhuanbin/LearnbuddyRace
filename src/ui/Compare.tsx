import React from 'react';
import type { Evidence, Method, Paper, Relation } from '../core/types';
import { FIELD_STATUS_TEXT, RELATION_LABELS, RELATION_STATE_LABELS } from '../core/types';
import { LEVEL_LABELS, type ComparabilityReport } from '../core/comparability';
import { buildComparison, toMarkdown } from '../core/compare';
import { Banner, Tag, downloadText } from './common';

const LEVEL_KIND: Record<ComparabilityReport['overall']['level'], string> = {
  comparable: 'ok',
  limited: 'warn',
  not_comparable: 'bad',
  unknown: '',
};

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
    const payload = {
      exportedAt: new Date().toISOString(),
      notice:
        '本文件由 ResearchPilot 导出。字段状态含义：可核验=引文已通过全文定位；待人工核对=引文未通过定位；' +
        '未找到证据=模型未给引文；缺失=论文未报告或未提取到。comparability 为规则计算结果，系统不做排名。',
      comparability: cmp?.comparability,
      papers: chosen.map((m) => {
        const p = paperById.get(m.paperId);
        return { title: p?.title, year: p?.year, source: p?.source.url, parseStatus: p?.parseStatus };
      }),
      methods: chosen.map((m) => ({
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
              evidence: v.evidence
                ? { page: v.evidence.page, verified: v.evidence.verified, quote: v.evidence.quote, matchType: v.evidence.matchType }
                : null,
            },
          ]),
        ),
        conditions: m.conditions,
        validation: m.validation,
        overrides: m.overrides,
      })),
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
    <div>
      <h2 className="page">跨论文比较</h2>
      <p className="sub">
        勾选两篇及以上论文，系统会先用规则检查数据集、数据划分、指标、额外训练数据、预训练模型与实验设置，
        给出「可以直接比较 / 只能有限比较 / 当前不能直接比较」的结论。条件不一致时禁止直接比较数值。
      </p>

      <div className="card">
        <h3>选择要比较的论文（{selected.length} 篇已选）</h3>
        <div className="row">
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
            <button className="btn ghost sm" onClick={() => onSelectedChange(methods.map((m) => m.paperId))}>
              全选
            </button>
          )}
        </div>
      </div>

      {!cmp && <Banner kind="info">请至少选择两篇论文以生成可比性判断与比较表。</Banner>}

      {cmp && (
        <>
          <div className="row between" style={{ marginBottom: 10 }}>
            <div className="row">
              <Tag kind="ok">已选 {cmp.columns.length} 篇</Tag>
              <Tag kind="warn">系统不做排名</Tag>
            </div>
            <div className="row">
              <button className="btn sm" onClick={exportMarkdown}>
                导出 Markdown
              </button>
              <button className="btn sm" onClick={exportJson}>
                导出 JSON
              </button>
            </div>
          </div>

          <ComparabilityPanel report={cmp.comparability} onOpenEvidence={onOpenEvidence} paperById={paperById} />

          {cmp.globalWarnings.slice(1).map((w, i) => (
            <Banner key={i} kind="warn">
              {w}
            </Banner>
          ))}

          <div className="table-wrap">
            <table className="cmp">
              <thead>
                <tr>
                  <th className="rowhead">字段</th>
                  {cmp.columns.map((m) => {
                    const p = paperById.get(m.paperId);
                    return (
                      <th key={m.paperId}>
                        {p?.title ?? m.paperId}
                        <div className="small dim" style={{ fontWeight: 400 }}>
                          {p?.year ?? '年份未识别'} {m.cached ? '· 缓存' : '· 实时'}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {cmp.rows.map((row) => (
                  <tr key={row.field}>
                    <td className="rowhead">{row.label}</td>
                    {row.cells.map((c, i) => (
                      <td key={i} className={c.state === 'missing' ? 'missing' : c.state === 'verified' ? '' : 'partial'}>
                        {c.display}
                        <div className="small" style={{ marginTop: 3 }}>
                          <Tag kind={c.state === 'verified' ? 'ok' : c.state === 'missing' ? 'bad' : 'warn'}>{c.stateText}</Tag>
                        </div>
                        {c.note && c.state !== 'verified' && (
                          <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>
                            {c.note}
                          </div>
                        )}
                        {(() => {
                          const ev = c.method?.fields[row.field]?.evidence;
                          if (!ev) return null;
                          return (
                            <div style={{ marginTop: 6 }}>
                              <button
                                className={`ev-btn ${ev.verified ? '' : 'bad'}`}
                                onClick={() =>
                                  onOpenEvidence(
                                    ev,
                                    `${(paperById.get(cmp.columns[i].paperId)?.title ?? '').slice(0, 26)} · ${row.label}`,
                                    paperById.get(cmp.columns[i].paperId),
                                  )
                                }
                              >
                                {ev.verified ? `原文 p.${ev.page ?? '?'}` : '引文未通过校验'}
                              </button>
                            </div>
                          );
                        })()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="small dim" style={{ marginTop: 10 }}>
            「论文未报告」表示该论文原文中确实没有该信息，「未提取到」表示本次片段中没有，两者都不会用推测值填充。
            点击「原文」按钮可查看该引文所在的真实上下文。
          </p>
        </>
      )}
    </div>
  );
}
