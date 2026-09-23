import React, { useRef, useState } from 'react';
import { NextStep, Status } from './common';
import type { CorpusKey, CorpusScope } from '../core/corpus';
import type { Evidence, FieldKey, Method, Paper } from '../core/types';
import {
  CONDITION_DIMENSIONS,
  CONDITION_LABELS,
  ISSUE_CODE_TEXT,
  METHOD_FIELD_LABELS,
  TRAINING_STAGE_LABELS,
} from '../core/types';
import { FIELD_KEYS_ORDER } from '../core/cache';
import { FieldCard, Tag, Banner } from './common';

/**
 * 方法标签：只根据**已抽取的文本**做关键词派生，用于卡片上快速识别方法路线。
 * 不新增任何结论，也不改变数据。
 */
export function methodTags(m?: Method): { text: string; style: string }[] {
  if (!m) return [];
  const text = [m.fields.methodName?.value, m.fields.coreIdea?.value].filter(Boolean).join(' ');
  const tags: { text: string; style: string }[] = [];
  const has = (re: RegExp) => re.test(text);
  if (has(/CNN|卷积|ConvNet|ResNet|residual/i)) tags.push({ text: 'CNN', style: '' });
  if (has(/Transformer|ViT|attention|注意力/i)) tags.push({ text: 'Vision Transformer', style: 'alt' });
  if (has(/蒸馏|distillation/i)) tags.push({ text: '蒸馏', style: 'neutral' });
  if (has(/层次|hierarchical|窗口|window|shifted/i)) tags.push({ text: '层次化 / 窗口注意力', style: 'neutral' });
  if (has(/数据高效|data-efficient/i)) tags.push({ text: '数据高效训练', style: 'neutral' });
  if (has(/残差|residual/i)) tags.push({ text: '残差连接', style: 'neutral' });
  if (has(/自监督|masked|预训练|pretrain/i)) tags.push({ text: '预训练', style: 'neutral' });
  return tags.slice(0, 4);
}

/** 该论文有多少个字段证据可核验 */
export function verifiedOf(m: Method): number {
  return FIELD_KEYS_ORDER.filter((k) => m.fields[k]?.evidence?.verified).length;
}

/** 条件状态文案：把「未提取到」与「论文明确没有」严格区分 */
const CONDITION_STATUS_TEXT: Record<string, string> = {
  verified: '可核验',
  unverified: '引文不支撑主张',
  not_reported: '论文明确没有',
  not_extracted: '本次片段中未提取到',
  unclear: '无法确认',
};

export interface JobState {
  paperId: string;
  stage: string;
  message: string;
  status: 'running' | 'done' | 'failed' | 'canceled';
  attempts: number;
  error?: string;
}

export function LibraryView({
  papers,
  methods,
  jobs,
  modelReady,
  onImport,
  onPaste,
  onExtract,
  onCancel,
  onRemove,
  onOverride,
  onOpenEvidence,
  onLoadSample,
  scope,
  corpusLoading,
  loadResult,
  onClearForeign,
  onOpenSettings,
  onGoExperiments,
  onOpenExperiments,
  onGoGraph,
  corpus,
  corpusLabel,
  onSwitchCorpus,
  otherCorpusCount,
  logLines,
  staleNotes,
}: {
  papers: Paper[];
  methods: Method[];
  jobs: Record<string, JobState>;
  modelReady: boolean;
  onImport: (files: FileList) => void;
  onPaste: (title: string, text: string) => void;
  onExtract: (paperId: string, force?: boolean) => void;
  /** 停止等待：只停止本次等待，不代表服务端已停止计算或不再计费 */
  onCancel: (paperId: string) => void;
  onRemove: (paperId: string) => void;
  onOverride: (paperId: string, field: FieldKey, value: string) => void;
  onOpenEvidence: (e: Evidence, label: string, paper?: Paper) => void;
  onLoadSample: () => void;
  scope: CorpusScope;
  corpusLoading: CorpusKey | null;
  loadResult?: { key: CorpusKey; ok: boolean; papers: number; experiments: number; relations: number; message: string; at: number };
  onClearForeign: () => void;
  onOpenSettings: () => void;
  onGoExperiments: () => void;
  /** 打开实验比较页并聚焦某篇论文 */
  onOpenExperiments: (paperId: string) => void;
  onGoGraph: () => void;
  corpus: 'vision' | 'nlp-dev';
  corpusLabel: string;
  onSwitchCorpus: (c: 'vision' | 'nlp-dev') => void;
  otherCorpusCount: number;
  logLines: string[];
  /** 预置语料相对当前规则/提示词的过期说明（为空表示无过期） */
  staleNotes?: string[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** 重新分析的两步确认：避免误触消耗模型额度 */
  const [confirmReanalyze, setConfirmReanalyze] = useState<Record<string, boolean>>({});
  /** 当前语料可见论文的实验记录总数（仅用于案例信息条与进度） */
  const experimentsOfCorpus = papers.reduce(
    (a, x) => a + (methods.find((m) => m.paperId === x.id)?.experiments?.length ?? 0),
    0,
  );
  /** 当前语料可见的论文：预置 + 用户自己上传（其它语料集不混入） */
  const visiblePapers = [...scope.presetPapers, ...scope.ownPapers];
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');

  const methodByPaper = new Map(methods.map((m) => [m.paperId, m]));

  return (
    <div>
      <h2 className="page">论文库</h2>
      <p className="lead" style={{ marginBottom: 16 }}>
        这里放论文本身：加载案例或上传 PDF，然后看每篇论文的字段、实验条件与原文依据。
      </p>

      <div className="corpus-card primary">
        <div className="title">
          <b>{scope.meta.label}</b>
          <Status kind={corpus === 'vision' ? 'ok' : 'cached'}>{corpus === 'vision' ? '正式演示案例' : '仅用于回归测试'}</Status>
          {scope.paperCount > 0 && <Status kind="cached">缓存案例（离线真实模型生成）</Status>}
          {corpusLoading === scope.key && <Status kind="info">正在加载…</Status>}
          {loadResult && !loadResult.ok && loadResult.key === scope.key && <Status kind="bad">上次加载失败</Status>}
        </div>
        <div className="case-facts">
          <div className="f">
            <div className="v">{scope.paperCount}</div>
            <div className="k">论文数量（当前语料）</div>
          </div>
          <div className="f">
            <div className="v">{scope.meta.domain}</div>
            <div className="k">研究领域</div>
          </div>
          <div className="f">
            <div className="v">{scope.experimentCount}</div>
            <div className="k">实验记录</div>
          </div>
          <div className="f">
            <div className="v">{scope.meta.purpose}</div>
            <div className="k">案例用途</div>
          </div>

        </div>
        {scope.foreignPapers.length > 0 && (
          <div className="next" style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn-line)', margin: '4px 0 12px' }}>
            <div className="t">
              <b>检测到其它语料集的数据（{scope.foreignPapers.length} 篇）</b>
              <span>
                它们属于另一套语料集，<strong>不计入上方数量</strong>，也不会混入当前语料的关系与推荐。
                你可以切换过去查看，或直接清理掉它们。
              </span>
            </div>
            <button className="btn sm" onClick={() => onSwitchCorpus(scope.key === 'vision' ? 'nlp-dev' : 'vision')}>
              切换到{scope.key === 'vision' ? '开发回归样例' : '视觉论文案例'}
            </button>
            <button className="btn ghost sm" onClick={() => onClearForeign()}>
              清理这些数据
            </button>
          </div>
        )}

        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => onLoadSample()} disabled={corpusLoading === scope.key}>
            {corpusLoading === scope.key ? '正在加载…' : scope.paperCount === 0 ? '加载演示案例' : '重新加载演示案例'}
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            上传 PDF
          </button>
          <button className="btn ghost" onClick={() => (corpus === 'vision' ? onSwitchCorpus('nlp-dev') : onSwitchCorpus('vision'))}>
            {corpus === 'vision' ? '换成开发回归样例（NLP）' : '换成正式视觉案例'}
          </button>
          <span className="small dim">
            两套语料各自独立计算关系与推荐，不会混在一起；演示案例的预置结果由真实模型离线生成，界面处处标明来源。
            {otherCorpusCount > 0 ? `（另有 ${otherCorpusCount} 篇属另一语料集，已隐藏）` : ''}
          </span>
        </div>
      </div>

      {loadResult && loadResult.key === scope.key && (
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <Status kind={loadResult.ok ? 'ok' : 'bad'}>{loadResult.ok ? '加载完成' : '加载失败'}</Status>
          <span className="small dim">{loadResult.message}</span>
          {!loadResult.ok && (
            <button className="btn sm" onClick={() => onLoadSample()}>
              重试加载
            </button>
          )}
        </div>
      )}

      {!modelReady && (
        <div className="next" style={{ background: 'var(--st-warn-bg)', borderColor: 'var(--st-warn)' }}>
          <div className="t">
            <b>未配置模型：仍可完整演示</b>
            <span>
              预置结果由真实模型离线生成，界面处处标明来源；只有「上传自己的论文做实时抽取」需要模型接口。
            </span>
          </div>
          <button className="btn primary sm" onClick={() => onLoadSample()}>
            用预置结果演示
          </button>
          <button className="btn ghost sm" onClick={onOpenSettings}>
            去配置接口
          </button>
        </div>
      )}

      <details className="fold">
        <summary>论文要求与解析规则</summary>
        <div className="fold-body">
          <p>支持含文本层的 PDF（单文件不超过 120 页）；扫描件会明确报错，而不是返回空结果。</p>
          <p>
            导入后系统在<strong>本机浏览器</strong>解析出全文与页码，再调用你配置的模型做结构化抽取；
            每个字段都必须带一条能在全文中定位到的原文引文，定位不到就标「待人工核对」或「未找到证据」。
          </p>
        </div>
      </details>

      <div className="card">
        <div className="row">
          <button className="btn primary" onClick={() => fileRef.current?.click()}>
            导入 PDF（可多选）
          </button>
          <button className="btn" onClick={() => setPasteOpen((v) => !v)}>
            粘贴论文文本
          </button>
          <span className="spacer" />
          <span className="small dim">已有 {papers.length} 篇</span>
        </div>
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
        <p className="small dim" style={{ margin: '10px 0 0' }}>
          限制：单文件不超过 120 页；仅支持含文本层的 PDF，扫描件会明确报错而不是返回空结果。
        </p>

        {pasteOpen && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <label className="f">论文标题</label>
            <input className="f" value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} placeholder="例如：Attention Is All You Need" />
            <label className="f" style={{ marginTop: 10 }}>
              论文正文（直接从论文复制；系统会按页分隔存储，证据定位能力与 PDF 一致）
            </label>
            <textarea className="f" rows={7} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
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
      </div>

      {staleNotes && staleNotes.length > 0 && (
        <Banner kind="warn">
          <strong>部分结果为早期版本产物，已标记为过期，不作为当前结论：</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {staleNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <div style={{ marginTop: 6 }}>
            可比性与关系可信度由程序按当前规则实时重算，不受影响；模型抽取类结果（字段、实验条件、决策）需要重新生成才能反映新规则与提示词。
          </div>
        </Banner>
      )}

      {visiblePapers.length === 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>还没有论文：先做这一步</h3>
          <p className="small dim" style={{ marginTop: 0 }}>
            推荐从<strong>正式视觉案例</strong>开始：点上面的主按钮加载，5 篇论文与预置分析结果会一起就绪，
            不需要配置模型也能走完整流程。
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary sm" onClick={() => onLoadSample()}>
              加载正式视觉案例
            </button>
            <button className="btn sm" onClick={() => fileRef.current?.click()}>
              上传自己的 PDF
            </button>
            <button className="btn ghost sm" onClick={() => setPasteOpen(true)}>
              粘贴论文文本
            </button>
          </div>
        </div>
      )}

      {visiblePapers.map((p) => {
        const m = methodByPaper.get(p.id);
        const job = jobs[p.id];
        const open = expanded === p.id;
        const verified = m ? FIELD_KEYS_ORDER.filter((k) => m.fields[k].evidence?.verified).length : 0;
        const withValue = m ? FIELD_KEYS_ORDER.filter((k) => m.fields[k].value).length : 0;

        return (
          <div className="paper" key={p.id}>
            <div className="paper-head">
              <div className="meta">
                <div className="paper-title">{p.title}</div>
                                    <div className="mtags">
                      {methodTags(m).map((tg, ti) => (
                        <span key={ti} className={`mtag ${tg.style}`}>
                          {tg.text}
                        </span>
                      ))}
                    </div>
                    <div className="paper-sub">
                      <span>{p.year ?? '年份未知'}</span>
                      <span>{p.pageCount ?? '?'} 页</span>
                      <span>{p.charCount ?? '?'} 字符</span>
                      <span className="mono">{p.source?.url?.replace('https://arxiv.org/abs/', 'arXiv:') ?? ''}</span>
                      {p.titleFrom === 'model-verified' && <span>标题经模型校正并在原文中验证</span>}
                      {p.parseStatus === 'failed' && <span style={{ color: 'var(--bad)' }}>解析失败：{p.parseError}</span>}
                    </div>
                    <div className="row" style={{ gap: 8, marginTop: 8 }}>
                      {m ? (
                        <>
                          <Status kind={verifiedOf(m) === 7 ? 'ok' : verifiedOf(m) > 0 ? 'pending' : 'bad'}>
                            字段证据 {verifiedOf(m)}/7
                          </Status>
                          <Status kind="cached">缓存案例</Status>
                          {(m.overrides?.length ?? 0) > 0 && <Status kind="manual">人工修正 {m.overrides.length}</Status>}
                          <Status kind={(m.experiments ?? []).some((x) => x.verification?.rowColConfirmed) ? 'ok' : 'pending'}>
                            实验 {(m.experiments ?? []).length} 条
                          </Status>
                        </>
                      ) : (
                        <Status kind="info">尚未分析</Status>
                      )}
                    </div>
<div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {m && (
                  <button className="btn sm" onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                    {expanded === p.id ? '收起论文' : '查看论文'}
                  </button>
                )}
                {m && (m.experiments ?? []).length > 0 && (
                  <button className="btn primary sm" onClick={() => onOpenExperiments(p.id)}>
                    查看实验
                  </button>
                )}
                {p.parseStatus === 'ok' && !m && (
                  <button className="btn sm" disabled={!!job && job.status === 'running'} onClick={() => onExtract(p.id, false)}>
                    分析这篇论文
                  </button>
                )}
                {p.parseStatus === 'failed' && (
                  <button className="btn sm" disabled={!!job && job.status === 'running'} onClick={() => onExtract(p.id, true)}>
                    重试解析
                  </button>
                )}
                {p.parseStatus === 'ok' && m && job?.status !== 'running' && !confirmReanalyze[p.id] && (
                  <button className="btn ghost sm" onClick={() => setConfirmReanalyze((c) => ({ ...c, [p.id]: true }))}>
                    重新分析
                  </button>
                )}
                {p.parseStatus === 'ok' && m && confirmReanalyze[p.id] && (
                  <>
                    <span className="small" style={{ color: 'var(--warn)' }}>
                      会消耗模型额度；分析期间保留原结果，人工修正不会被覆盖
                    </span>
                    <button
                      className="btn sm"
                      onClick={() => {
                        setConfirmReanalyze((c) => ({ ...c, [p.id]: false }));
                        onExtract(p.id, true);
                      }}
                    >
                      确认重新分析
                    </button>
                    <button className="btn ghost sm" onClick={() => setConfirmReanalyze((c) => ({ ...c, [p.id]: false }))}>
                      取消
                    </button>
                  </>
                )}
                {job?.status === 'running' && (
                  <button className="btn sm" onClick={() => onCancel(p.id)}>
                    停止等待
                  </button>
                )}
                <button className="btn ghost sm" onClick={() => onRemove(p.id)}>
                  移除
                </button>
              </div>

            </div>
            {job?.status === 'running' && (
              <p className="small dim" style={{ margin: '8px 0 0' }}>
                正在等待模型响应（{job.message}）。分析期间原结果仍然保留，可随时停止等待。
              </p>
            )}
            {job?.status === 'canceled' && (
              <p className="small" style={{ margin: '8px 0 0', color: 'var(--pending)' }}>
                已停止等待：本次调用未完成，原结果保持不变。停止等待不代表服务端已停止计算或不再计费。
              </p>
            )}
            {job?.error && (
              <p className="small" style={{ margin: '8px 0 0', color: 'var(--bad)' }}>
                {job.error}
              </p>
            )}
          </div>

            {open && m && (
              <div className="paper-body">
                <div className="row" style={{ marginBottom: 12 }}>
                  <Status kind={m.cached ? 'cached' : 'live'}>{m.cached ? '缓存案例' : '实时分析'}</Status>
                  <span className="small dim">
                    字段证据 {verified}/7 · 有值 {withValue}/7{m.model ? ` · 模型 ${m.model}` : ''}
                  </span>
                  <span className="spacer" />
                  {(staleNotes?.length ?? 0) > 0 && <Status kind="stale">结果已过期提示 {staleNotes!.length} 条</Status>}
                </div>

                <div className="fields">
                  {FIELD_KEYS_ORDER.map((k) => {
                    const ov = m.overrides.find((o) => o.field === k);
                    return (
                      <FieldCard
                        key={k}
                        field={k as FieldKey}
                        result={m.fields[k as FieldKey]}
                        paper={p}
                        override={ov ? { newValue: ov.newValue, at: ov.at } : undefined}
                        onOverride={(field, value) => onOverride(p.id, field, value)}
                        onOpenEvidence={(e, label) => onOpenEvidence(e, label, p)}
                      />
                    );
                  })}
                </div>

                <h3 style={{ margin: '20px 0 8px' }}>实验条件（论文报告的原始条件）</h3>
                <div className="table-wrap">
                  <table className="cmp">
                    <thead>
                      <tr>
                        <th className="rowhead">条件维度</th>
                        <th>论文报告的取值</th>
                        <th style={{ width: 130 }}>状态</th>
                        <th style={{ width: 160 }}>适用范围 / 阶段</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CONDITION_DIMENSIONS.map((dim) => {
                        const c = m.conditions ? m.conditions[dim] : undefined;
                        if (!c) {
                          return (
                            <tr key={dim}>
                              <td className="rowhead">{CONDITION_LABELS[dim]}</td>
                              <td className="missing">本次片段中未提取到</td>
                              <td className="small dim">—</td>
                              <td className="small dim">—</td>
                            </tr>
                          );
                        }
                        const kind =
                          c.status === 'verified'
                            ? 'ok'
                            : c.status === 'not_reported'
                              ? 'cached'
                              : c.status === 'not_extracted'
                                ? 'pending'
                                : 'warn';
                        return (
                          <tr key={dim} className={c.status === 'verified' ? '' : 'warnrow'}>
                            <td className="rowhead">{CONDITION_LABELS[dim]}</td>
                            <td>
                              {c.values.length ? c.values.join('、') : <span className="missing">无取值</span>}
                              {c.note && (
                                <div className="small dim" style={{ marginTop: 4 }}>
                                  {c.note}
                                </div>
                              )}
                              {c.evidence && (
                                <button
                                  className="ev-btn"
                                  onClick={() => onOpenEvidence(c.evidence as Evidence, CONDITION_LABELS[dim] + '的原文依据', p)}
                                >
                                  {c.evidence.verified ? '查看原文依据' : '查看实际匹配位置'}
                                  {c.evidence.page ? `（p.${c.evidence.page}）` : ''}
                                </button>
                              )}
                            </td>
                            <td className="small">
                              <Status kind={kind}>{CONDITION_STATUS_TEXT[c.status] || c.status}</Status>
                            </td>
                            <td className="small dim">
                              {c.scope === 'paper' ? '整篇论文' : c.scope === 'experiment' ? c.scopeDetail || '单个实验' : '范围未知'}
                              {c.stage ? ` · ${TRAINING_STAGE_LABELS[c.stage]}` : ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {m.validation && m.validation.length > 0 && (
                  <>
                    <h3 style={{ margin: '20px 0 8px' }}>程序校验问题（{m.validation.length} 条）</h3>
                    <div className="table-wrap">
                      <table className="cmp">
                        <thead>
                          <tr>
                            <th className="rowhead">问题</th>
                            <th>说明</th>
                            <th style={{ width: 120 }}>涉及字段</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.validation.map((v, i) => (
                            <tr key={i}>
                              <td className="rowhead">{ISSUE_CODE_TEXT[v.code] || v.code}</td>
                              <td className="small">{v.message || '—'}</td>
                              <td className="small dim">{v.field ? METHOD_FIELD_LABELS[v.field as FieldKey] || v.field : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {visiblePapers.length > 0 && (
        <NextStep
          title="论文已就绪"
          desc={'已加载 ' + visiblePapers.length + ' 篇。下一步建议进「实验比较」，挑两条分类实验看它们能不能直接比；每个数值旁都有「查看原文」。'}
          actionLabel="进入实验比较"
          onAction={onGoExperiments}
          secondary={{ label: '查看方法关系', onAction: onGoGraph }}
        />
      )}

      {logLines.length > 0 && (
        <details className="fold">
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
    </div>
  );
}
