import React, { useEffect, useRef, useState } from 'react';
import { Crumb, NextStep, PageHead, SectionHead, Status } from './common';
import type { CorpusKey, CorpusScope } from '../core/corpus';
import type { Evidence, FieldKey, Method, Paper, Relation } from '../core/types';
import {
  CONDITION_DIMENSIONS,
  CONDITION_LABELS,
  ISSUE_CODE_TEXT,
  METHOD_FIELD_LABELS,
  TRAINING_STAGE_LABELS,
} from '../core/types';
import { FIELD_KEYS_ORDER } from '../core/cache';
import { buildMethodProfile, shortContribution } from '../core/grouping';
import { FieldCard, Tag, Banner } from './common';

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

/** 关系措辞（与地图/对照页同一套真实关系数据，不新增判断） */
const REL_VERB: Record<string, string> = {
  extends: '在此基础上继续发展',
  improves: '对它做了改进',
  combines: '与之组合使用',
  similar: '思路相近',
};
const REL_STATE: Record<string, string> = { explicit: '原文明示', inferred: '系统推断', candidate: '待核查' };

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

/** 列表里唯一的分析状态：只由真实状态派生，等待模型绝不显示成完成 */
function primaryStatus(p: Paper, m: Method | undefined, job: JobState | undefined): { kind: string; text: string } {
  if (p.parseStatus === 'failed') return { kind: 'bad', text: '解析失败' };
  if (job?.status === 'running') return { kind: 'info', text: '正在等待模型响应' };
  if (job?.status === 'canceled') return { kind: 'pending', text: '已停止等待（未完成）' };
  if (job?.status === 'failed') return { kind: 'bad', text: '分析失败（未完成）' };
  if (m) return m.cached ? { kind: 'cached', text: '分析完成 · 缓存结果' } : { kind: 'live', text: '分析完成 · 实时分析' };
  return { kind: 'pending', text: '尚未提取方法字段' };
}

/**
 * 论文集合：编辑部式列表。
 *
 * 版面：案例摘要（名称 / 篇数 / 已分析 / 数据来源 + 一个主按钮）→ 一行式工具栏 →
 * 分隔行列表（标题 / 方法标签 / 一句话作用 → 分析状态 / 字段与实验数量 → 查看论文 / 查看实验 / 更多操作），
 * 证据与条件全部收进展开区。不再是一叠等高卡片。
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
  onCancel,
  onRemove,
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
  /** 当前语料的真实关系（只用于列表里那一句摘要，不新增判断） */
  relations?: Relation[];
  jobs: Record<string, JobState>;
  modelReady: boolean;
  onImport: (files: FileList) => void;
  onPaste: (title: string, text: string) => void;
  onExtract: (paperId: string, force?: boolean) => void;
  /** 停止等待：只停止本次等待，不代表服务端已停止计算或不再计费 */
  onCancel: (paperId: string) => void;
  onRemove: (paperId: string) => void;
  /** 撤销移除：把论文与已有分析结果写回本机 */
  onRestore: (paper: Paper, method?: Method) => void;
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
  /** 移除的两步确认与撤销 */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ paper: Paper; method?: Method } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');

  /** 当前语料可见的论文：预置 + 用户自己上传（其它语料集不混入） */
  const visiblePapers = [...scope.presetPapers, ...scope.ownPapers];
  const methodByPaper = new Map(methods.map((m) => [m.paperId, m]));
  const analysedCount = visiblePapers.filter((p) => methodByPaper.has(p.id)).length;
  const loading = corpusLoading === scope.key;
  const experimentCount = visiblePapers.reduce((a, p) => a + (methodByPaper.get(p.id)?.experiments?.length ?? 0), 0);

  /** 撤销窗口：12 秒后自动收起（期间可一键恢复） */
  useEffect(() => {
    if (!removed) return;
    const t = window.setTimeout(() => setRemoved(null), 12000);
    return () => window.clearTimeout(t);
  }, [removed]);

  const nameOf = (methodId: string) => {
    const m = methods.find((x) => x.id === methodId);
    if (!m) return methodId;
    return buildMethodProfile(m, papers.find((p) => p.id === m.paperId), papers).shortName;
  };

  /** 论文短标题：取方法短名（真实标题仍在展开区与悬停提示里） */
  const methodShortName = (paperId: string): string => {
    const m = methods.find((x) => x.paperId === paperId);
    if (!m) return papers.find((x) => x.id === paperId)?.title?.slice(0, 24) ?? paperId;
    return buildMethodProfile(m, papers.find((x) => x.id === paperId), papers).shortName;
  };

  /** 方法族（真实归组结果，只用于列表里那一行低权重元数据） */
  const methodFamilyOf = (paperId: string): string => {
    const m = methods.find((x) => x.paperId === paperId);
    if (!m) return '未提取';
    return buildMethodProfile(m, papers.find((p) => p.id === paperId), papers).family.name;
  };

  /** 一句话摘要：核心思路首句 + 关系摘要（「关系不明确」不当作关系），控制在一句以内 */
  const summaryOf = (paperId: string, method?: Method): string => {
    if (!method) return '还没有方法分析结果。';
    const idea = shortContribution(method.fields.coreIdea?.value ?? '');
    const all = relations.filter((r) => r.fromMethodId === method.id || r.toMethodId === method.id);
    const mine = all.filter((r) => r.type !== 'unclear');
    if (!mine.length) {
      return `${idea || '未提取到核心思路'}${all.length ? `；与它相关的 ${all.length} 个配对都判为「关系不明确」` : '；这组论文里暂时没有可核验的方法关系'}`;
    }
    const r = mine[0];
    const other = nameOf(r.fromMethodId === method.id ? r.toMethodId : r.fromMethodId);
    const clause =
      r.fromMethodId === method.id
        ? `${other} ${REL_VERB[r.type] ?? '关系不明确'}`
        : `${other} 是它的前置方法`;
    const rest = mine.length > 1 ? `，另有 ${mine.length - 1} 条关系` : '';
    return `${idea ? idea + '；' : ''}${clause}（${REL_STATE[r.evidenceState] ?? r.evidenceState}${r.evidence ? ' · 有引文' : ' · 无直接引文'}）${rest}`;
  };

  return (
    <div>
      <Crumb trail={[{ label: '首页', on: onGoHome }, { label: '论文集合' }]} />

      {/* 1. 顶部案例摘要 */}
      <PageHead
        title="论文集合"
        sub={
          <>
            当前案例里的全部论文，每篇都有解析出来的字段、实验条件与原文依据；证据与条件收进「查看论文」，列表本身只讲清楚
            <strong>这是什么、分析到哪一步、在研究链条里处在什么位置</strong>。
          </>
        }
        badges={
          <>
            <Status kind={scope.presetPaperCount ? 'ok' : 'info'}>{scope.meta.label}</Status>
            <Status kind="info">{visiblePapers.length} 篇论文</Status>
            <Status kind={analysedCount ? 'ok' : 'pending'}>已完成分析 {analysedCount}/{visiblePapers.length}</Status>
            <span className="metaline">
              <span>{scope.meta.domain}</span>
              <span className="sep">·</span>
              <span>{scope.meta.purpose}</span>
              <span className="sep">·</span>
              <span>{visiblePapers.some((p) => p.cached) ? '来源：缓存案例（离线真实模型生成）' : modelReady ? '来源：实时分析' : '未配置模型'}</span>
              <span className="sep">·</span>
              <span>实验记录 {experimentCount} 条</span>
            </span>
            {loading && <Status kind="info">正在加载…</Status>}
          </>
        }
        actions={
          <button className="btn primary" onClick={onGoMap} disabled={!visiblePapers.length}>
            进入研究地图
          </button>
        }
      />

      {/* 2. 一行式工具栏：上传与语料管理（次要操作） */}
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
        <span className="spacer" />
        <span className="lab">两套语料独立计算，不会混在一起{otherCorpusCount > 0 ? `；另有 ${otherCorpusCount} 篇属另一语料集，已隐藏` : ''}</span>
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
      {pasteOpen && (
        <div className="quiet-group tint" style={{ marginTop: 0 }}>
          <label className="f">论文标题</label>
          <input className="f" value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} placeholder="例如：Attention Is All You Need" />
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

      {loadResult && loadResult.key === scope.key && !loadResult.ok && (
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <Status kind="bad">上次加载失败</Status>
          <span className="small dim">{loadResult.message}</span>
          <button className="btn sm" onClick={() => onLoadSample()}>
            重试加载
          </button>
        </div>
      )}

      {!modelReady && (
        <div className="confirmbar" style={{ marginTop: 0 }}>
          <div className="t">
            <strong>未配置模型</strong>：预置结果由真实模型离线生成，界面处处标明来源；只有「上传自己的论文做实时抽取」需要模型接口。
          </div>
          <button className="btn ghost sm" onClick={onOpenSettings}>
            去配置接口
          </button>
        </div>
      )}

      {staleNotes && staleNotes.length > 0 && (
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
      )}

      {visiblePapers.length === 0 ? (
        <div className="quiet-group tint">
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
      ) : (
        <>
          <SectionHead
            title={`论文列表（${visiblePapers.length} 篇）`}
            sub="标题 → 方法标签 → 一句话作用 → 分析状态与数量 → 操作；证据与条件收进「查看论文」"
          />

          <div className="lrows">
            {visiblePapers.map((p) => {
              const m = methodByPaper.get(p.id);
              const job = jobs[p.id];
              const open = expanded === p.id;
              const verified = m ? verifiedOf(m) : 0;
              const withValue = m ? FIELD_KEYS_ORDER.filter((k) => m.fields[k]?.value).length : 0;
              const exps = m?.experiments ?? [];
              const expsConfirmed = exps.filter((x) => x.verification?.rowColConfirmed).length;
              const st = primaryStatus(p, m, job);

              return (
                <div className={`lrow${open ? ' open' : ''}`} key={p.id}>
                  {/* 第一行：论文短标题 · 方法族 · 查看论文 / 更多操作 */}
                  <div className="lrow-r1">
                    <h3 className="paper-title lrow-short" title={p.title}>
                      {methodShortName(p.id)}
                    </h3>
                    <span className="lrow-fam">{m ? methodFamilyOf(p.id) : "未提取方法族"}</span>
                    <span className="spacer" />
                    {m && (
                      <button className="btn sm" onClick={() => setExpanded(open ? null : p.id)} aria-expanded={open}>
                        {open ? '收起论文' : '查看论文'}
                      </button>
                    )}
                    {p.parseStatus === 'ok' && !m && (
                      <button className="btn primary sm" disabled={!!job && job.status === 'running'} onClick={() => onExtract(p.id, false)}>
                        {modelReady ? '分析方法字段' : '配置模型后分析'}
                      </button>
                    )}
                    {p.parseStatus === 'failed' && (
                      <button className="btn primary sm" disabled={!!job && job.status === 'running'} onClick={() => onExtract(p.id, true)}>
                        重试解析
                      </button>
                    )}
                    {job?.status === 'running' && (
                      <button className="btn ghost sm" onClick={() => onCancel(p.id)}>
                        停止等待
                      </button>
                    )}
                    {m && (
                      <details className="moreprop">
                        <summary>更多操作</summary>
                        <div className="morebody">
                          <p style={{ margin: '0 0 8px' }}>
                            重新分析会重新调用模型并消耗额度，分析期间保留原结果、人工修正不会被覆盖；
                            移除只删除本机这份数据，12 秒内可撤销。
                          </p>
                          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                            {p.parseStatus === 'ok' && job?.status !== 'running' && !confirmReanalyze[p.id] && (
                              <button className="btn sm" onClick={() => setConfirmReanalyze((c) => ({ ...c, [p.id]: true }))}>
                                重新分析
                              </button>
                            )}
                            <button className="btn danger sm" onClick={() => setConfirmRemove(p.id)}>
                              移除论文
                            </button>
                          </div>
                        </div>
                      </details>
                    )}
                  </div>

                  {/* 第二行：一句话作用 · 当前状态 · 实验数量 */}
                  <div className="lrow-r2">
                    <span className="lrow-role">{summaryOf(p.id, m)}</span>
                    <span className="lrow-stats">
                      <Status kind={st.kind}>{st.text}</Status>
                      <span className="kv">实验 {m ? exps.length + " 条" : "0 条"}</span>
                      {(m?.overrides?.length ?? 0) > 0 && <span className="kv">人工修正 {m!.overrides.length} 处</span>}
                    </span>
                  </div>

                  {job?.status === 'running' && (
                    <p className="small dim" style={{ margin: '6px 0 0' }}>
                      正在等待模型响应（{job.message}）。分析期间原结果仍然保留，可随时停止等待。
                    </p>
                  )}
                  {job?.status === 'canceled' && (
                    <p className="small" style={{ margin: '6px 0 0', color: 'var(--pending)' }}>
                      已停止等待：本次调用未完成，原结果保持不变。停止等待不代表服务端已停止计算或不再计费。
                    </p>
                  )}
                  {job?.status === 'failed' && job.error && !open && (
                    <p className="small" style={{ margin: '6px 0 0', color: 'var(--bad)' }}>分析失败：{job.error}</p>
                  )}

                  {confirmReanalyze[p.id] && (
                    <div className="confirmbar">
                      <div className="t">
                        重新分析会重新调用模型并<strong>消耗额度</strong>；分析期间<strong>保留原结果</strong>，
                        <strong>人工修正不会被覆盖</strong>。
                      </div>
                      <button
                        className="btn primary sm"
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
                    </div>
                  )}

                  {confirmRemove === p.id && (
                    <div className="confirmbar" style={{ background: 'var(--bad-soft)', borderColor: 'var(--bad-line)' }}>
                      <div className="t">
                        确认移除《{p.title.slice(0, 40)}》？只会删除本机这份数据；移除后 12 秒内可以一键撤销。
                      </div>
                      <button
                        className="btn danger sm"
                        onClick={() => {
                          setConfirmRemove(null);
                          setRemoved({ paper: p, method: m });
                          onRemove(p.id);
                        }}
                      >
                        确认移除
                      </button>
                      <button className="btn ghost sm" onClick={() => setConfirmRemove(null)}>
                        取消
                      </button>
                    </div>
                  )}

                  {open && m && (
                    <div className="lrow-body expand-in">
                      {/* 次要信息与「查看实验」：默认隐藏在详情里 */}
                      <div className="row" style={{ gap: 12, marginBottom: 12, alignItems: 'center' }}>
                        <span className="lrow-meta">
                          {[
                            p.year ?? '年份未知',
                            `${p.pageCount ?? '?'} 页`,
                            `${p.charCount ?? '?'} 字符`,
                            p.source?.url?.replace('https://arxiv.org/abs/', 'arXiv:') ?? '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        <span className="spacer" />
                        {exps.length > 0 && (
                          <button className="btn ghost sm" onClick={() => onOpenExperiments(p.id)}>
                            查看实验（{exps.length} 条）→
                          </button>
                        )}
                      </div>
                      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
                        <Status kind={m.cached ? 'cached' : 'live'}>{m.cached ? '缓存结果（离线真实模型生成）' : '实时分析结果'}</Status>
                        <span className="small dim">
                          字段证据 {verified}/7 · 有值 {withValue}/7{m.model ? ` · 模型 ${m.model}` : ''}
                        </span>
                        <span className="spacer" />
                        {(staleNotes?.length ?? 0) > 0 && <Status kind="stale">结果已过期提示 {staleNotes!.length} 条</Status>}
                      </div>

                      {p.parseStatus === 'failed' && (
                        <div className="confirmbar" style={{ background: 'var(--bad-soft)', borderColor: 'var(--bad-line)' }}>
                          <div className="t">
                            <strong>失败在哪一步：</strong>解析 PDF 文本。
                            <br />
                            <strong>原因：</strong>
                            {p.parseError}
                            <br />
                            <strong>已有数据：</strong>该论文的元数据已保存（标题、页数、内容哈希），移除前一直保留。
                          </div>
                          <button className="btn sm" onClick={() => onExtract(p.id, true)}>
                            重试解析
                          </button>
                        </div>
                      )}

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

                      <details className="fold" style={{ marginTop: 14 }}>
                        <summary>实验条件（论文报告的原始条件）</summary>
                        <div className="fold-body">
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
                        </div>
                      </details>

                      {m.validation && m.validation.length > 0 && (
                        <details className="fold" style={{ marginTop: 10 }}>
                          <summary>程序校验问题（{m.validation.length} 条）</summary>
                          <div className="fold-body">
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
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {removed && (
            <div className="undobar" role="status">
              <span style={{ flex: '1 1 240px' }}>
                已移除《{removed.paper.title.slice(0, 40)}》。本机数据已删除，可一键恢复（不会重新调用模型）。
              </span>
              <button
                className="btn sm"
                onClick={() => {
                  onRestore(removed.paper, removed.method);
                  setRemoved(null);
                }}
              >
                撤销移除
              </button>
              <button className="btn ghost sm" onClick={() => setRemoved(null)}>
                知道了
              </button>
            </div>
          )}
        </>
      )}

      {visiblePapers.length > 0 && (
        <NextStep
          title="进入研究地图"
          desc={`已加载 ${visiblePapers.length} 篇、完成分析 ${analysedCount} 篇。地图里可以看方法分组、方法之间的真实关系，以及从哪里开始读。`}
          actionLabel="进入研究地图"
          onAction={onGoMap}
          secondary={{ label: '看实验能不能直接比较', onAction: onGoExperiments }}
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
