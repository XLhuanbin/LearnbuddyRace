import React, { useMemo } from 'react';
import type { DivergenceReport, Method, Paper } from '../core/types';
import { DIVERGENCE_LABELS } from '../core/types';
import { LEVEL_LABELS, pairLevel, differingDimensions, SCREENING_NOTICE } from '../core/comparability';
import { Banner, Tag, downloadText } from './common';

const KIND_KIND: Record<DivergenceReport['findings'][number]['kind'], string> = {
  conclusion_divergence: 'bad',
  condition_confounded: 'warn',
  shared_limitation: 'info',
  individual_limitations: '',
  none_found: '',
};

export function DivergenceView({
  papers,
  methods,
  report,
  busy,
  onGenerate,
  onCancel,
  onUseSample,
  staleNotes,
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
}) {
  const paperById = new Map(papers.map((p) => [p.id, p]));

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
  }, [papers, methods]);

  const exportMd = () => {
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
    for (const f of report.findings) {
      lines.push(`## [${DIVERGENCE_LABELS[f.kind]}] ${f.topic}`);
      lines.push(`- 涉及论文：${f.paperIds.map((id) => paperById.get(id)?.title ?? id).join('；') || '—'}`);
      lines.push(`- 主张类型：${f.claimType === 'numeric' ? '数值结果' : f.claimType === 'qualitative' ? '定性主张' : '未标注'}`);
      lines.push(`- 共同比较范围：${f.commonScope || '（未给出）'}`);
      lines.push(`- 可比性（程序按论文对计算）：${LEVEL_LABELS[f.comparabilityLevel]}`);
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
    }
    lines.push('## 已检查的论文对（按当前论文集合实时重算）', '');
    checkedPairs.forEach((c) => lines.push(`- ${c.pair}：${c.result}`));
    lines.push('', '---', '本文件不包含任何 API 密钥。');
    downloadText('researchpilot-分歧与待调查问题.md', lines.join('\n'), 'text/markdown');
  };

  return (
    <div>
      <h2 className="page">待调查问题</h2>
      <p className="sub">
        先判断主张类型与共同比较范围，再做结论：数值结果差异需要实验可比才能讨论；定性主张按具体陈述范围核查。
        条件不一致时正确的表述是「无法排除条件差异的影响，也不能归因于方法本身」。共同局限必须针对同一对象，否则分别展示。
      </p>

      <div className="card tight">
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={onGenerate}>
            {busy ? '分析中…' : report ? '重新分析' : '分析待调查问题'}
          </button>
          {busy && onCancel && (
            <button className="btn ghost" onClick={onCancel}>
              停止等待
            </button>
          )}
          <button className="btn" disabled={busy} onClick={onUseSample}>
            查看预置示例结果
          </button>
          {report?.cached && <Tag kind="warn">预置示例（非实时）</Tag>}
          <span className="spacer" />
          {report && (
            <button className="btn sm" onClick={exportMd}>
              导出 Markdown
            </button>
          )}
        </div>
      </div>

      {!report && <Banner kind="info">尚未分析。分析会同时给出「已检查的论文对」清单，用于说明没有为了展示而制造冲突。</Banner>}

      {staleNotes && staleNotes.length > 0 && (
        <Banner kind="warn">
          <strong>该分析的部分内容来自早期版本：</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {staleNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          其中「已检查的论文对」与各条发现的可比性已由程序按当前规则重算，规则结论不存在过期问题；模型给出的文字说明仍来自旧版提示词。
        </Banner>
      )}

      {report && (
        <>
          {report.findings.map((f) => (
            <div className="card" key={f.id}>
              <div className="row" style={{ marginBottom: 8 }}>
                <Tag kind={KIND_KIND[f.kind]}>{DIVERGENCE_LABELS[f.kind]}</Tag>
                <strong style={{ fontSize: 13.5 }}>{f.topic}</strong>
                <span className="spacer" />
                <Tag>{f.claimType === 'numeric' ? '数值结果' : f.claimType === 'qualitative' ? '定性主张' : '类型未标注'}</Tag>
                <Tag>可比性：{LEVEL_LABELS[f.comparabilityLevel]}</Tag>
              </div>

              <div className="small" style={{ marginBottom: 6 }}>
                <span className="dim">共同比较范围：</span>
                {f.commonScope || <span style={{ color: 'var(--warn)' }}>模型未给出共同对象，因此不认定为分歧</span>}
              </div>

              <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                {f.paperIds.map((id) => (
                  <span key={id} className="small dim">
                    {paperById.get(id)?.title ?? id}
                  </span>
                ))}
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
                                {s.quoteEvidence?.verified ? `　（原文已定位${s.page ? `：p.${s.page}` : ''}）` : ''}
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

              <div className="small" style={{ lineHeight: 1.8, marginBottom: 6 }}>
                <span className="dim">说明：</span>
                {f.explanation}
              </div>
              <div className="small" style={{ lineHeight: 1.8, marginBottom: 6 }}>
                <span className="dim">下一步核查：</span>
                {f.nextAction}
              </div>

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

              <p className="small dim" style={{ margin: 0 }}>
                {f.disclaimer}
              </p>
            </div>
          ))}

          <div className="card">
            <h3>已检查的论文对（{checkedPairs.length}，按当前论文集合实时重算）</h3>
            <p className="small dim" style={{ marginTop: 0 }}>
              与「跨论文比较」页调用同一套规则，因此同一论文对在两页的结论与理由一致。未列为分歧的组合都在这里，
              说明系统没有为了展示而生成冲突。
            </p>
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
            <p className="small dim" style={{ marginTop: 8 }}>
              {SCREENING_NOTICE}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
