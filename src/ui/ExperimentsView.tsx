import React, { useEffect, useMemo, useState } from 'react';
import type { Evidence, ExperimentRecord, Paper } from '../core/types';
import { TASK_TAG_LABELS } from '../core/types';
import { EXPERIMENT_LEVEL_LABELS, compareExperiments, suggestComparablePairs } from '../core/experiments';
import type { CorpusKey, CorpusScope } from '../core/corpus';
import { Status, NextStep } from './common';

interface Props {
  papers: Paper[];
  methods: import('../core/types').Method[];
  onOpenEvidence: (ev: Evidence) => void;
  onGo?: (tab: 'library' | 'graph' | 'decision') => void;
  onLoadSample?: () => void;
  scope: CorpusScope;
  corpusLoading: CorpusKey | null;
  loadResult?: { key: CorpusKey; ok: boolean; papers: number; experiments: number; relations: number; message: string; at: number };
  focusPaper?: string | null;
  onProgress?: (p: { picked: number; compared: boolean }) => void;
}

const LEVEL_KIND: Record<string, string> = {
  directly_comparable: 'ok',
  comparable_with_conditions: 'info',
  insufficient_info: 'pending',
  not_comparable: 'bad',
};

/** 每个结论配一句人话解释（不是排名、不给因果结论） */
const LEVEL_PLAIN: Record<string, string> = {
  directly_comparable:
    '两条记录的评估数据、指标与已记录条件一致，可以在已知协议下放在一起看。注意：仍有未记录的因素（如训练轮数）不在判断范围内。',
  comparable_with_conditions:
    '两条记录的条件不同，数值差异不能直接归因于架构本身。请结合下面列出的差异讨论——例如预训练数据、分辨率或蒸馏。',
  insufficient_info:
    '至少有一条记录的关键条件未知（如额外数据、测试时增强），无法确认两者是否在同一口径下。先补齐信息，再判断能不能比。',
  not_comparable: '两条记录的任务、评估数据集或指标不同，两个数字不在同一个口径上，不能直接比较。',
};

/** 用第一条差异/未知项生成一句具体的解释 */
function specificReason(diffs: string[], unknowns: string[], level: string): string | null {
  if (level === 'not_comparable') return null;
  if (diffs.length >= 2) return `两者在「${diffs[0]}」「${diffs[1]}」上不同，直接比较会把条件差异算成方法差异。`;
  if (diffs.length === 1) return `两者在「${diffs[0]}」上不同，这一项会影响结论。`;
  if (unknowns.length) return `「${unknowns.slice(0, 2).join('」「')}」的取值未知，无法确认口径是否一致。`;
  return null;
}

function flagList(e: ExperimentRecord): { text: string; kind: string }[] {
  const out: { text: string; kind: string }[] = [];
  const pre = e.pretrainData ?? '未知';
  if (/21K|22K/i.test(pre)) out.push({ text: '额外预训练 IN-' + pre.replace(/ImageNet-/, ''), kind: 'pending' });
  else if (/jft/i.test(pre)) out.push({ text: '额外预训练 JFT', kind: 'pending' });
  else if (/^(none|无)$/i.test(pre)) out.push({ text: '无额外预训练', kind: 'cached' });
  if (e.distillation && !/^(无|未知)$/.test(e.distillation) && !/无蒸馏/.test(e.distillation)) {
    out.push({ text: /regnet|conv/i.test(e.distillation) ? '蒸馏（CNN 教师）' : '蒸馏', kind: 'pending' });
  }
  if (e.testTimeAug && !/^(无|未知)$/.test(e.testTimeAug)) out.push({ text: '测试时增强', kind: 'pending' });
  if (e.inferenceMode && /ensemble|集成/i.test(e.inferenceMode)) out.push({ text: '集成结果', kind: 'pending' });
  return out;
}

export function ExperimentsView({
  papers,
  methods,
  onOpenEvidence,
  onGo,
  onLoadSample,
  scope,
  corpusLoading,
  loadResult,
  focusPaper,
  onProgress,
}: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [paperFilter, setPaperFilter] = useState<string | null>(focusPaper ?? null);
  const [onlyConfirmed, setOnlyConfirmed] = useState(false);
  const [query, setQuery] = useState('');
  const [showOthers, setShowOthers] = useState(false);
  const [autoPicked, setAutoPicked] = useState(false);

  useEffect(() => {
    if (focusPaper) setPaperFilter(focusPaper);
  }, [focusPaper]);

  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  /** 只用当前语料集的方法与实验记录（不混入其它语料集） */
  const scopedMethods = useMemo(() => [...scope.presetMethods, ...scope.ownMethods], [scope]);
  const all = useMemo(() => scopedMethods.flatMap((m) => m.experiments ?? []), [scopedMethods]);
  const classification = all.filter((e) => e.taskTag === 'classification');
  const others = all.filter((e) => e.taskTag !== 'classification');
  const confirmed = classification.filter((e) => e.verification?.rowColConfirmed);
  const loading = corpusLoading === scope.key;

  const shown = (showOthers ? [...classification, ...others] : classification).filter((e) => {
    if (paperFilter && e.paperId !== paperFilter) return false;
    if (onlyConfirmed && !e.verification?.rowColConfirmed) return false;
    if (query) {
      const q = query.toLowerCase();
      const hay = `${e.modelVariant} ${e.metricName} ${e.metricValue} ${e.evalDataset} ${e.pretrainData ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const pickedList = picked.map((id) => all.find((e) => e.id === id)).filter(Boolean) as ExperimentRecord[];
  const cmp = pickedList.length === 2 ? compareExperiments(pickedList[0], pickedList[1]) : null;

  const shortName = (paperId: string) => {
    const t = paperById.get(paperId)?.title ?? '';
    if (/Residual/.test(t)) return 'ResNet';
    if (/AN IMAGE/.test(t)) return 'ViT';
    if (/data-efficient/.test(t)) return 'DeiT';
    if (/Swin/.test(t)) return 'Swin';
    if (/ConvNet/.test(t)) return 'ConvNeXt';
    return t.slice(0, 10);
  };
  const labelOf = (e: ExperimentRecord) => `${shortName(e.paperId)} · ${e.modelVariant}`;

  const suggestions = useMemo(() => {
    const good = suggestComparablePairs(classification);
    if (good.length) return good.slice(0, 3);
    const scored: { a: ExperimentRecord; b: ExperimentRecord; cmp: ReturnType<typeof compareExperiments> }[] = [];
    for (let i = 0; i < classification.length; i++) {
      for (let j = i + 1; j < classification.length; j++) {
        const a = classification[i];
        const b = classification[j];
        if (a.paperId === b.paperId) continue;
        const c = compareExperiments(a, b);
        if (c.level === 'not_comparable') continue;
        scored.push({ a, b, cmp: c });
      }
    }
    return scored
      .sort((x, y) => x.cmp.unknowns.length - y.cmp.unknowns.length || x.cmp.differences.length - y.cmp.differences.length)
      .slice(0, 3);
  }, [classification]);

  /** 口径不同的典型例子（错误率 vs 准确率）——用于演示「不能直接比较」 */
  const crossMetric = useMemo(() => {
    for (const a of classification) {
      for (const b of classification) {
        if (a.paperId === b.paperId) continue;
        const c = compareExperiments(a, b);
        if (c.level === 'not_comparable' && c.blocked.some((x) => x.field === 'metricName')) return { a, b, cmp: c };
      }
    }
    return null;
  }, [classification]);

  useEffect(() => {
    if (!autoPicked && !picked.length && suggestions.length) {
      setPicked([suggestions[0].a.id, suggestions[0].b.id]);
      setAutoPicked(true);
    }
  }, [suggestions, autoPicked, picked.length]);

  useEffect(() => {
    onProgress?.({ picked: picked.length, compared: picked.length === 2 });
  }, [picked.length, onProgress]);

  const toggle = (id: string) => {
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= 2) return [cur[1], id];
      return [...cur, id];
    });
  };

  const diffs = cmp ? [...cmp.blocked, ...cmp.differences] : [];
  const unknownLabels = cmp ? cmp.unknowns.map((u) => u.label) : [];
  const specific = cmp ? specificReason(diffs.map((d) => d.label), unknownLabels, cmp.level) : null;

  /* ---------------- 空状态：分清「没有语料」与「有论文但无实验记录」 ---------------- */
  if (!all.length) {
    const hasPapers = scope.paperCount > 0;
    return (
      <div>
        <h2 className="page">这些 ImageNet 结果，真的可以直接比较吗？</h2>
        <p className="lead">
          实验比较以「一条实验记录」为单位：某个模型变体 + 一套训练与评估条件。
        </p>
        <div className="corpus-card">
          <div className="title">
            <b>当前语料集：{scope.meta.label}</b>
            <Status kind={scope.paperCount ? 'ok' : 'info'}>{scope.paperCount} 篇论文</Status>
            <Status kind={all.length ? 'ok' : 'pending'}>{all.length} 条实验记录</Status>
            {loading && <Status kind="info">正在加载…</Status>}
          </div>
          <p className="meta" style={{ marginTop: 8 }}>
            {hasPapers
              ? '论文已加载，但当前语料还没有生成实验记录。可以重新加载演示案例来补齐（不会重复添加论文）。'
              : '还没有加载语料。点下面的主按钮加载演示案例，5 篇论文与实验记录会一起就绪。'}
          </p>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {onLoadSample && (
              <button className="btn primary" onClick={() => onLoadSample?.()} disabled={loading}>
                {loading ? '正在加载…' : hasPapers ? '重新加载演示案例（补齐实验记录）' : '加载演示案例'}
              </button>
            )}
            <button className="btn ghost" onClick={() => onGo?.('library')}>
              去论文库查看论文
            </button>
          </div>
          {loadResult && (
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <Status kind={loadResult.ok ? 'ok' : 'bad'}>{loadResult.ok ? '上次加载完成' : '上次加载失败'}</Status>
              <span className="small dim">{loadResult.message}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ① 当前语料集 + 已选记录数 */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <Status kind={scope.key === 'vision' ? 'ok' : 'cached'}>当前语料集：{scope.meta.label}</Status>
        <Status kind="info">{scope.presetPaperCount} 篇论文</Status>
        <Status kind="info">{classification.length} 条分类实验</Status>
        <Status kind={picked.length === 2 ? 'ok' : 'info'}>已选 {picked.length} / 2 条记录</Status>
        {loading && <Status kind="info">正在加载…</Status>}
        {loadResult?.key === scope.key && loadResult.ok && (
          <button className="btn ghost sm" onClick={() => onLoadSample?.()} disabled={loading}>
            重新加载演示案例
          </button>
        )}
      </div>

      {/* ② 问题 */}
      <h2 className="page">这些 ImageNet 结果，真的可以直接比较吗？</h2>
      <p className="lead">
        比较的单位是<strong>一条实验记录</strong>（模型变体 + 训练/评估条件），不是整篇论文。
        下面先给推荐对照，右侧给出结论；详细条件与原文证据在结论下方。
      </p>

      {/* ③ 推荐对照（长名称可展开查看） */}
      {(suggestions.length > 0 || crossMetric) && (
        <div className="card tight" style={{ marginBottom: 14 }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>推荐对照</strong>
            <span className="small dim">（程序按条件差异挑出，不是排名；长名称悬停或展开可看完整名称）</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {crossMetric && (
              <button
                className="chip"
                onClick={() => setPicked([crossMetric.a.id, crossMetric.b.id])}
                title={`${labelOf(crossMetric.a)}（错误率） ↔ ${labelOf(crossMetric.b)}（准确率）`}
              >
                口径不同的例子：{labelOf(crossMetric.a)}（错误率）↔ {labelOf(crossMetric.b)}（准确率）
              </button>
            )}
            {suggestions.map((s, i) => (
              <button
                key={i}
                className="chip"
                onClick={() => setPicked([s.a.id, s.b.id])}
                title={`${labelOf(s.a)} ↔ ${labelOf(s.b)}｜${EXPERIMENT_LEVEL_LABELS[s.cmp.level]}｜${s.cmp.reasons.join('；')}`}
              >
                {labelOf(s.a)} ↔ {labelOf(s.b)}（{EXPERIMENT_LEVEL_LABELS[s.cmp.level].replace('信息不足，不能直接比较', '信息不足')}）
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="workspace">
        <div className="ws-left">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <Status kind="ok">行列已核验 {confirmed.length} 条</Status>
            <Status kind="pending">待核查 {classification.length - confirmed.length} 条</Status>
            {others.length > 0 && <Status kind="cached">非分类 {others.length} 条（不参与分类比较）</Status>}
          </div>

          <div className="filters">
            <span className="small dim">按论文：</span>
            <button className={`chip${paperFilter === null ? ' on' : ''}`} onClick={() => setPaperFilter(null)}>
              全部
            </button>
            {[...new Set(classification.map((e) => e.paperId))].map((pid) => (
              <button key={pid} className={`chip${paperFilter === pid ? ' on' : ''}`} onClick={() => setPaperFilter(pid)}>
                {shortName(pid)}
              </button>
            ))}
          </div>
          <div className="filters">
            <input
              className="f"
              style={{ width: 170 }}
              placeholder="搜索模型 / 数值"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索实验记录"
            />
            <label className="small row" style={{ gap: 6 }}>
              <input type="checkbox" checked={onlyConfirmed} onChange={(e) => setOnlyConfirmed(e.target.checked)} />
              只看行列已核验
            </label>
            {others.length > 0 && (
              <label className="small row" style={{ gap: 6 }}>
                <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} />
                含检测/分割
              </label>
            )}
            <span className="small dim">{shown.length} 条</span>
          </div>

          {shown.map((e) => {
            const sel = picked.includes(e.id);
            const ok = !!e.verification?.rowColConfirmed;
            return (
              <button
                key={e.id}
                className={`exprow${sel ? ' sel' : ''}${ok ? '' : ' pending'}`}
                onClick={() => toggle(e.id)}
                aria-pressed={sel}
                title={`${labelOf(e)}｜${e.metricName} ${e.metricValue}${e.metricUnit ?? ''}｜${ok ? '行列已核验' : '表格行列待核查'}`}
              >
                <span className="n">{sel ? '✓' : ''}</span>
                <span className="b">
                  <span className="top">
                    <span className="model">{e.modelVariant}</span>
                    <span className="val">
                      {e.metricName} {e.metricValue}
                      {e.metricUnit ?? ''}
                    </span>
                    <Status kind={ok ? 'ok' : 'pending'}>{ok ? '行列已核验' : '待核查'}</Status>
                  </span>
                  <span className="cond">
                    {shortName(e.paperId)} · {TASK_TAG_LABELS[e.taskTag]} · {e.evalDataset}
                    {e.evalSplit ? ` / ${e.evalSplit}` : ''} · {e.inputResolution ?? '分辨率未知'} · 预训练{' '}
                    {e.pretrainData ?? '未知'}
                  </span>
                  <span className="flags">
                    {flagList(e).map((f, i) => (
                      <span key={i} className={`status ${f.kind}`}>
                        {f.text}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            );
          })}
          {!shown.length && (
            <div className="card tight small dim" style={{ marginTop: 8 }}>
              当前筛选下没有记录，可以清空搜索或取消「只看行列已核验」。
            </div>
          )}
        </div>

        <div className="ws-right">
          {/* ④ 结论（已选摘要 + 大结论卡） */}
          <div className="pickbar">
            {pickedList.length === 0 ? (
              <span className="small dim">已选 0 / 2：在左边挑两条记录（同一条再点一次可取消）</span>
            ) : (
              <div className="row" style={{ gap: 10 }}>
                {pickedList.map((e) => (
                  <span key={e.id} className="status info" title={labelOf(e)}>
                    {labelOf(e)}　{e.metricValue}
                    {e.metricUnit ?? ''}
                    <button className="btn ghost sm" style={{ padding: '0 4px' }} onClick={() => toggle(e.id)} aria-label="取消选择">
                      ×
                    </button>
                  </span>
                ))}
                <span className="spacer" />
                <button className="btn ghost sm" onClick={() => setPicked([])}>
                  清空选择
                </button>
              </div>
            )}
          </div>

          {pickedList.length === 2 && cmp ? (
            <>
              <div className={`verdict ${LEVEL_KIND[cmp.level]}`}>
                <div className="verdict-head">
                  <span className="verdict-level">{EXPERIMENT_LEVEL_LABELS[cmp.level]}</span>
                  <Status kind={LEVEL_KIND[cmp.level]}>{cmp.level === 'insufficient_info' ? '需要先补齐条件' : '见下方说明'}</Status>
                </div>
                <p className="verdict-explain">{LEVEL_PLAIN[cmp.level]}</p>
                {specific && (
                  <p className="verdict-explain" style={{ marginTop: 6 }}>
                    <strong>具体到这里：</strong>
                    {specific}
                  </p>
                )}
                <div className="verdict-numbers">
                  <div>
                    <div className="num-big">
                      {pickedList[0].metricValue}
                      {pickedList[0].metricUnit ?? ''}
                    </div>
                    <div className="num-cap">
                      {labelOf(pickedList[0])} · {pickedList[0].metricName}
                    </div>
                  </div>
                  <span className="dim">对比</span>
                  <div>
                    <div className="num-big">
                      {pickedList[1].metricValue}
                      {pickedList[1].metricUnit ?? ''}
                    </div>
                    <div className="num-cap">
                      {labelOf(pickedList[1])} · {pickedList[1].metricName}
                    </div>
                  </div>
                </div>
                <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  {pickedList.map(
                    (e) =>
                      e.evidence && (
                        <button key={e.id} className="btn primary sm fl" onClick={() => onOpenEvidence(e.evidence!)}>
                          查看原文证据（{labelOf(e)} · p.{e.evidence.page ?? '?'}）
                        </button>
                      ),
                  )}
                </div>
              </div>

              {/* ⑤ 详细条件与证据（折叠） */}
              <details className="fold" open>
                <summary>查看详细条件差异（{diffs.length + cmp.unknowns.length} 项）</summary>
                <div className="fold-body">
                  {diffs.length > 0 && (
                    <div className="table-wrap" style={{ marginBottom: 12 }}>
                      <table className="cmp">
                        <thead>
                          <tr>
                            <th style={{ width: 150 }}>条件</th>
                            <th>{labelOf(pickedList[0])}</th>
                            <th>{labelOf(pickedList[1])}</th>
                            <th style={{ width: 110 }}>判断</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diffs.map((d, i) => (
                            <tr key={i}>
                              <td className="small">{d.label}</td>
                              <td className="small">{d.a}</td>
                              <td className="small">{d.b}</td>
                              <td className="small">
                                <Status kind={cmp.blocked.includes(d) ? 'bad' : 'info'}>
                                  {cmp.blocked.includes(d) ? '不能比较' : '条件不同'}
                                </Status>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {cmp.unknowns.length > 0 && (
                    <p>
                      <strong>信息不足项：</strong>
                      {cmp.unknowns
                        .map((u) => `${u.label}（${u.which === 'both' ? '双方' : u.which === 'a' ? '左侧' : '右侧'}未知）`)
                        .join('、')}
                    </p>
                  )}
                  {cmp.reasons.length > 0 && (
                    <ul style={{ paddingLeft: 18 }}>
                      {cmp.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                  {cmp.caveats.length > 0 && (
                    <ul style={{ paddingLeft: 18 }}>
                      {cmp.caveats.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  )}
                  <div className="table-wrap" style={{ marginTop: 12 }}>
                    <table className="cmp">
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>完整条件</th>
                          <th>{labelOf(pickedList[0])}</th>
                          <th>{labelOf(pickedList[1])}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            ['模型变体', 'modelVariant'],
                            ['预训练数据', 'pretrainData'],
                            ['训练/微调数据', 'trainData'],
                            ['评估数据集', 'evalDataset'],
                            ['评估划分', 'evalSplit'],
                            ['输入分辨率', 'inputResolution'],
                            ['额外数据', 'extraData'],
                            ['蒸馏与教师', 'distillation'],
                            ['测试时增强', 'testTimeAug'],
                            ['单模型/集成', 'inferenceMode'],
                            ['参数量', 'params'],
                            ['FLOPs', 'flops'],
                            ['原文页码', 'page'],
                          ] as [string, string][]
                        ).map(([label, key], i) => {
                          const val = (e: ExperimentRecord) =>
                            key === 'page' ? `p.${e.evidence?.page ?? '?'}` : ((e as unknown as Record<string, string>)[key] ?? '未知');
                          return (
                            <tr key={i}>
                              <td className="small">{label}</td>
                              <td className="small">{val(pickedList[0])}</td>
                              <td className="small">{val(pickedList[1])}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {pickedList.some((e) => e.aliasNotes?.length) && (
                    <p style={{ marginTop: 10 }}>名称归一：{pickedList.flatMap((e) => e.aliasNotes ?? []).join('；')}</p>
                  )}
                  <p style={{ marginTop: 10 }}>{cmp.disclaimer}</p>
                </div>
              </details>

              {onGo && (
                <NextStep
                  title="看懂差异之后"
                  desc="可以继续看方法之间的原文关系，或按你的基础与目标生成阅读建议。"
                  actionLabel="查看方法关系"
                  onAction={() => onGo('graph')}
                  secondary={{ label: '看阅读建议', onAction: () => onGo('decision') }}
                />
              )}
            </>
          ) : (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>选择两条实验记录</h3>
              <p className="small dim" style={{ marginTop: 0 }}>
                左边每一条都是一次完整设置（模型变体 + 数据集 + 分辨率 + 训练条件）。
                点两条后，这里会给出「能不能直接比较」的结论、具体差在哪，以及原文证据入口。
              </p>
              <p className="small dim" style={{ marginBottom: 0 }}>
                已选中 {pickedList.length} 条{pickedList.length === 1 ? '，再点一条即可对照。' : '。'}
              </p>
            </div>
          )}

          <details className="fold">
            <summary>判断口径（程序怎么判、哪些不做）</summary>
            <div className="fold-body">
              <p>
                程序逐项对照：预训练数据、训练/微调数据、评估数据集与划分、输入分辨率、额外数据、蒸馏（含教师来源）、
                测试时增强、单模型或集成。任一项未知 → 信息不足；任一项不同 → 只能结合条件讨论；
                任务/数据集/指标不同 → 不能直接比较。
              </p>
              <p>
                表格行列：数值能定位到原文但版面行列无法确认时，一律标<strong>待核查</strong>（橙色），
                不进入「可以直接比较」，也不参与任何排名。
              </p>
              <p>本页不做排名，也不给「某种架构本身更优」的因果结论；吞吐量在不同硬件/批量下不比较快慢。</p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
