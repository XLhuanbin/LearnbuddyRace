import React, { useEffect, useMemo, useState } from 'react';
import type { Evidence, ExperimentRecord, Paper } from '../core/types';
import { TASK_TAG_LABELS } from '../core/types';
import { EXPERIMENT_LEVEL_LABELS, compareExperiments, suggestComparablePairs } from '../core/experiments';
import type { CorpusKey, CorpusScope } from '../core/corpus';
import { Crumb, NextStep, PageHead, SectionHead, Status } from './common';

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

/** 结论层的一句人话解释（不是排名、不给因果结论） */
const LEVEL_PLAIN: Record<string, string> = {
  directly_comparable:
    '两条记录的评估数据、指标与已记录条件一致，可以在已知协议下放在一起看。注意：仍有未记录的因素（如训练轮数）不在判断范围内。',
  comparable_with_conditions:
    '两条记录的条件不同，数值差异不能直接归因于架构本身。请结合下面列出的差异讨论——例如预训练数据、分辨率或蒸馏。',
  insufficient_info:
    '至少有一条记录的关键条件未知（如额外数据、测试时增强），无法确认两者是否在同一口径下。先补齐信息，再判断能不能比。',
  not_comparable: '两条记录的任务、评估数据集或指标不同，两个数字不在同一个口径上，不能直接比较。',
};

/** 结论下面只展示最关键差异：六个维度 */
const KEY_DIMS: { field: string; key: keyof ExperimentRecord; label: string }[] = [
  { field: 'evalDataset', key: 'evalDataset', label: '评估集' },
  { field: 'inputResolution', key: 'inputResolution', label: '输入分辨率' },
  { field: 'extraData', key: 'extraData', label: '额外数据' },
  { field: 'pretrainData', key: 'pretrainData', label: '预训练' },
  { field: 'testTimeAug', key: 'testTimeAug', label: '测试时增强' },
  { field: 'inferenceMode', key: 'inferenceMode', label: '单模型或集成' },
];

/** 用第一条差异/未知项生成一句具体的解释 */
function specificReason(diffs: string[], unknowns: string[], level: string): string | null {
  if (level === 'not_comparable') return null;
  if (diffs.length >= 2) return `两者在「${diffs[0]}」「${diffs[1]}」上不同，直接比较会把条件差异算成方法差异。`;
  if (diffs.length === 1) return `两者在「${diffs[0]}」上不同，这一项会影响结论。`;
  if (unknowns.length) return `「${unknowns.slice(0, 2).join('」「')}」的取值未知，无法确认口径是否一致。`;
  return null;
}

/**
 * 实验可比性：结论优先。
 *
 * 版面顺序：流程条 → 页头 → **结论** → 六个关键差异 → 完整条件（折叠）→ 推荐对照 → 实验记录（紧凑可扫描）→ 判断口径。
 * 结论完全来自 `compareExperiments()`，页面不自行推导任何新判断，也不做排名。
 */
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
  /** 推荐对照默认只展示 3 条，但要能明确展开其余，不做静默隐藏 */
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  /** 每个方法组是否展开显示全部记录 */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (focusPaper) setPaperFilter(focusPaper);
  }, [focusPaper]);

  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  /**
   * 只用**当前分析范围**的方法与实验记录：案例模式 = 当前案例预置；我上传模式 = 我上传的论文。
   * 不把案例与用户上传的论文叠在一起统计（否则两边会互相进入对方的可比性结论）。
   */
  const scopedMethods = useMemo(() => scope.methods, [scope]);
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

  /** 按方法（论文短名）分组，保持首次出现的顺序 */
  const groups = (() => {
    const map = new Map<string, { key: string; name: string; items: ExperimentRecord[] }>();
    for (const e of shown) {
      const name = shortName(e.paperId);
      if (!map.has(name)) map.set(name, { key: name, name, items: [] });
      map.get(name)!.items.push(e);
    }
    return [...map.values()];
  })();


  /** 全部可比对候选（不截断）；截断只发生在展示层，而且用户能一键展开 */
  const allSuggestions = useMemo(() => {
    const good = suggestComparablePairs(classification);
    if (good.length) return good;
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
    return scored.sort(
      (x, y) => x.cmp.unknowns.length - y.cmp.unknowns.length || x.cmp.differences.length - y.cmp.differences.length,
    );
  }, [classification]);
  const suggestions = showAllSuggestions ? allSuggestions : allSuggestions.slice(0, 3);

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

  /** 六个关键维度的状态（只读 compareExperiments 的结果，不自行推导） */
  const dimState = (field: string): 'diff' | 'same' | 'unknown' => {
    if (!cmp) return 'unknown';
    if (cmp.blocked.some((x) => x.field === field) || cmp.differences.some((x) => x.field === field)) return 'diff';
    if (cmp.unknowns.some((x) => x.field === field)) return 'unknown';
    return 'same';
  };

  /* ---------------- 空状态：分清「没有语料」与「有论文但无实验记录」 ---------------- */
  if (!all.length) {
    const hasPapers = scope.papers.length > 0;
    return (
      <div>
        <Crumb trail={[{ label: '研究地图', on: () => onGo?.('graph') }, { label: '实验可比性' }]} />
        <PageHead
          title="实验可比性"
          sub="实验比较以「一条实验记录」为单位：某个模型变体 + 一套训练与评估条件。这一页只回答一件事——两个结果能不能直接放在一起比。"
          badges={
            <>
              <Status kind={scope.papers.length ? 'ok' : 'info'}>
                {scope.mode === 'own' ? '当前集合：我上传的论文' : `当前语料集：${scope.meta.label}`}
              </Status>
              <Status kind={scope.papers.length ? 'ok' : 'info'}>{scope.papers.length} 篇论文</Status>
              <Status kind="pending">0 条实验记录</Status>
              {loading && <Status kind="info">正在加载…</Status>}
            </>
          }
          actions={
            onLoadSample ? (
              <button className="btn primary" onClick={() => onLoadSample()} disabled={loading}>
                {loading ? '正在加载…' : hasPapers ? '重新加载演示案例（补齐实验记录）' : '加载演示案例'}
              </button>
            ) : undefined
          }
        />
        <div className="lite">
          <p className="small dim" style={{ marginTop: 0 }}>
            {hasPapers
              ? '论文已加载，但当前语料还没有生成实验记录。可以重新加载演示案例来补齐（不会重复添加论文）。'
              : '还没有加载语料。点右上角的主按钮加载演示案例，5 篇论文与实验记录会一起就绪。'}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn ghost sm" onClick={() => onGo?.('library')}>
              去论文集合查看论文
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
      <Crumb trail={[{ label: '论文集合', on: () => onGo?.('library') }, { label: '实验可比性' }]} />

      {/* ① 页头：一个主入口 + 数据状态 */}
      <PageHead
        title="实验可比性"
        sub={
          <>
            这些 ImageNet 结果，真的可以直接比较吗？比较的单位是<strong>一条实验记录</strong>（模型变体 + 训练/评估条件），不是整篇论文。
            本页<strong>不做排名</strong>，也不给「某种架构本身更优」之类的<strong>因果结论</strong>。
          </>
        }
        badges={
          <>
            <Status kind={scope.key === 'vision' ? 'ok' : 'cached'}>
              {scope.mode === 'own' ? '当前集合：我上传的论文' : `当前语料集：${scope.meta.label}`}
            </Status>
            <Status kind="info">{classification.length} 条分类实验</Status>
            <Status kind={picked.length === 2 ? 'ok' : 'info'}>已选 {picked.length} / 2 条记录</Status>
            {others.length > 0 && <Status kind="cached">非分类 {others.length} 条（不参与分类比较）</Status>}
            {loadResult?.key === scope.key && loadResult.ok && (
              <button className="btn ghost sm" onClick={() => onLoadSample?.()} disabled={loading}>
                重新加载演示案例
              </button>
            )}
          </>
        }
      />

      <section className="exchart">
        <h3 className="exchart-title">已报告实验结果</h3>
        {(() => {
          const groups = new Map<string, ExperimentRecord[]>();
          for (const e of classification) {
            const key = `${e.metricName}|${e.metricUnit ?? ''}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(e);
          }
          return [...groups.entries()].slice(0, 4).map(([key, list]) => {
            const [name, unit] = key.split('|');
            const nums = list.map((e) => Number(e.metricValue)).filter((n) => Number.isFinite(n));
            const max = nums.length ? Math.max(...nums) : 0;
                  const axisMax = (unit ?? '').includes('%') ? 100 : max > 0 ? max : 1;
                  const min = nums.length ? Math.min(...nums) : 0;
                  const numeric = nums.length > 0;
            return (
              <div className="exgroup" key={key}>
                <div className="exgroup-head">
                  <span className="nm">
                    {name}
                    {unit ? `（${unit}）` : ''}
                  </span>
                  <span className="dim">
                          {list.length} 条记录 · 横轴 {axisMax}{unit ?? ''}
                        </span>
                </div>
                {list.slice(0, 8).map((e) => {
                  const v = Number(e.metricValue);
                  const num = Number((String(e.metricValue).match(/-?[0-9]+(?:\.[0-9]+)?/) || [])[0]);
                        const pct = Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round((num / axisMax) * 100))) : 0;
                  return (
                    <div className="exrow" key={e.id}>
                      <span className="lab">{e.modelVariant}</span>
                      <span className="bar">
                              <i style={{ width: `${pct}%` }} />
                            </span>
                      <span className="val">
                        {e.metricValue}
                        {unit ?? ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          });
        })()}
        <p className="exnote">条长＝原文报告的数值（百分比指标按 0–100% 横轴，不同单位各自独立）；数值大小不代表好坏，不同指标或不同条件不自动代表可比。</p>
      </section>

      {/* ② 结论优先：先说能不能比，再说差在哪 */}
      <div className="verdict-first">
        {pickedList.length === 2 && cmp ? (
          <>
            <div className={`verdict ${LEVEL_KIND[cmp.level]}`}>
              <div className="verdict-head">
                <span className="verdict-level">{EXPERIMENT_LEVEL_LABELS[cmp.level]}</span>
                <Status kind={LEVEL_KIND[cmp.level]}>
                  {cmp.level === 'insufficient_info' ? '需要先补齐条件' : cmp.level === 'not_comparable' ? '不在同一口径' : '见下方说明'}
                </Status>
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
                      <button key={e.id} className="btn ghost sm" onClick={() => onOpenEvidence(e.evidence!)}>
                        查看原文证据（{labelOf(e)} · p.{e.evidence.page ?? '?'}）
                      </button>
                    ),
                )}
                <button className="btn ghost sm" onClick={() => setPicked([])}>
                  清空选择
                </button>
              </div>
            </div>

            {/* 已报告实验结果：只展示原始数值，按 指标+单位 分组，不做综合分与跨指标排名 */}

            {/* ③ 比较依据（条件 · 差异 · 证据）：默认收起 */}
            <details className="fold compared">
              <summary>查看比较依据（关键条件 · 完整条件差异 · 原文证据）</summary>
              <div className="fold-body">
            <div style={{ marginTop: 14 }}>
              <div className="small dim" style={{ marginBottom: 6 }}>
                决定结论的关键条件（先看这 4 项，其余条件默认收起）
              </div>
              <div className="matrix">
                <div className="mhead">
                  <span>条件</span>
                  <span>{labelOf(pickedList[0])}</span>
                  <span>{labelOf(pickedList[1])}</span>
                </div>
                {KEY_DIMS.slice(0, 4).map((d) => {
                  const st = dimState(d.field);
                  const raw = (e: ExperimentRecord) => ((e as unknown as Record<string, string>)[d.key] ?? '') || '未知';
                  return (
                    <div className={`mrow ${st}`} key={d.field}>
                      <span className="mc">
                        <i className={`dot ${st === 'same' ? 'ok' : st === 'diff' ? 'warn' : 'mute'}`} />
                        {d.label}
                        <em>{st === 'same' ? '一致' : st === 'diff' ? '不同' : '未知'}</em>
                      </span>
                      <span className="mv">{raw(pickedList[0])}</span>
                      <span className="mv">{raw(pickedList[1])}</span>
                    </div>
                  );
                })}
              </div>
              {KEY_DIMS.length > 4 && (
                <details className="fold" style={{ marginTop: 10 }}>
                  <summary>
                    查看其余 {KEY_DIMS.length - 4} 项条件（{KEY_DIMS.slice(4).map((d) => d.label).join(' · ')}）
                  </summary>
                  <div className="fold-body">
                    <div className="matrix">
                      {KEY_DIMS.slice(4).map((d) => {
                        const st = dimState(d.field);
                        const raw = (e: ExperimentRecord) => ((e as unknown as Record<string, string>)[d.key] ?? '') || '未知';
                        return (
                          <div className={`mrow ${st}`} key={d.field}>
                            <span className="mc">
                              <i className={`dot ${st === 'same' ? 'ok' : st === 'diff' ? 'warn' : 'mute'}`} />
                              {d.label}
                              <em>{st === 'same' ? '一致' : st === 'diff' ? '不同' : '未知'}</em>
                            </span>
                            <span className="mv">{raw(pickedList[0])}</span>
                            <span className="mv">{raw(pickedList[1])}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </details>
              )}
            </div>

            </div>
            </details>

            {/* ④ 完整条件 / 证据 / 警告（折叠） */}
            <details className="fold" style={{ marginTop: 12 }}>
              <summary>查看完整条件差异与原文证据（{diffs.length + cmp.unknowns.length} 项）</summary>
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
          </>
        ) : (
          <div className="lite">
            <h3 style={{ margin: '0 0 6px' }}>先选两条实验记录</h3>
            <p className="small dim" style={{ margin: 0 }}>
              左边每一条都是一次完整设置（模型变体 + 数据集 + 分辨率 + 训练条件）。点两条后，这里会给出
              「能不能直接比较」的结论、不能比较的具体原因，以及需要补充什么信息。
              {pickedList.length === 1 ? ' 已选 1 条，再点一条即可对照。' : ' 也可以直接点下面的推荐对照。'}
            </p>
          </div>
        )}
      </div>

      {/* ⑤ 推荐对照 */}
      {(suggestions.length > 0 || crossMetric) && (
        <div className="lite" style={{ padding: '10px 14px' }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong style={{ fontSize: 13.5 }}>推荐对照（最多 3 条，可展开全部）</strong>
            <span className="small dim">
              （程序按条件差异挑出，不是排名；共 {allSuggestions.length} 对可直接对照）
            </span>
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
            {!showAllSuggestions && allSuggestions.length > 3 && (
              <button className="btn ghost sm" onClick={() => setShowAllSuggestions(true)}>
                显示其余 {allSuggestions.length - 3} 对
              </button>
            )}
            {showAllSuggestions && allSuggestions.length > 3 && (
              <button className="btn ghost sm" onClick={() => setShowAllSuggestions(false)}>
                只看前 3 对
              </button>
            )}
          </div>
        </div>
      )}

      {/* ⑥ 筛选：默认收起，需要时再展开 */}
      <details className="fold" style={{ marginTop: 0 }}>
        <summary>筛选与搜索实验记录（按论文 / 搜索 / 只看行列已核验）</summary>
        <div className="fold-body">
      <div className="toolbar" style={{ marginTop: 0 }}>
        <span className="lab">按论文</span>
        <button className={`chip${paperFilter === null ? ' on' : ''}`} onClick={() => setPaperFilter(null)}>
          全部
        </button>
        {[...new Set(classification.map((e) => e.paperId))].map((pid) => (
          <button key={pid} className={`chip${paperFilter === pid ? ' on' : ''}`} onClick={() => setPaperFilter(pid)}>
            {shortName(pid)}
          </button>
        ))}
        <span className="sep" style={{ color: 'var(--line-2)' }}>·</span>
        <input
          className="f"
          style={{ width: 160 }}
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
        <span className="spacer" />
        <span className="lab">
          显示 {shown.length} 条 · 行列已核验 {shown.filter((e) => e.verification?.rowColConfirmed).length} 条
        </span>
        </div>
      </div>
      </details>

      {/* ⑦ 实验记录：按方法分组，每组默认 2 条（其余可展开） */}
      <SectionHead
        title={`实验记录（${shown.length} 条 / ${groups.length} 组）`}
        sub="按方法分组；待核查的记录降权显示，它们不能进入「可以直接比较」"
        right={<span className="small dim">已选 {picked.length} / 2</span>}
      />
      <div className="explist">
        {groups.map((g) => {
          const open = !!openGroups[g.key];
          const items = open ? g.items : g.items.slice(0, 2);
          const rest = g.items.length - items.length;
          return (
            <div className="expgroup" key={g.key}>
              <div className="ghead">
                <strong>{g.name}</strong>
                <span className="dim">{g.items.length} 条</span>
                {g.items.length > 2 && (
                  <button
                    className="btn ghost sm"
                    onClick={() => setOpenGroups((o) => ({ ...o, [g.key]: !open }))}
                  >
                    {open ? '收起本组' : `展开本组剩余 ${g.items.length - 2} 条记录`}
                  </button>
                )}
              </div>
              {items.map((e) => {
                const sel = picked.includes(e.id);
                const ok = !!e.verification?.rowColConfirmed;
                return (
                  <button
                    key={e.id}
                    className={`exprow3${sel ? ' sel' : ''}`}
                    onClick={() => toggle(e.id)}
                    aria-pressed={sel}
                    title={`${labelOf(e)}｜${e.metricName} ${e.metricValue}${e.metricUnit ?? ''}｜${ok ? '行列已核验' : '表格行列待核查'}`}
                  >
                    <span className="lv" aria-hidden="true">
                      {sel ? '✓' : ''}
                    </span>
                    <span className="bx">
                      <span className="l1">
                        <span className="m">{e.modelVariant}</span>
                        <span className="v">
                          {e.metricName} {e.metricValue}
                          {e.metricUnit ?? ''}
                        </span>
                      </span>
                      <span className="l2">
                        {TASK_TAG_LABELS[e.taskTag]} · {e.evalDataset}
                        {e.evalSplit ? ` / ${e.evalSplit}` : ''} · {e.inputResolution ?? '分辨率未知'}
                        {e.pretrainData ? ` · 预训练 ${e.pretrainData}` : ''}
                        {e.evidence ? ` · 原文 p.${e.evidence.page ?? '?'}` : ''}
                      </span>
                    </span>
                    <span className="rt">
                      <Status kind={ok ? 'ok' : 'pending'}>{ok ? '行列已核验' : '待核查'}</Status>
                    </span>
                  </button>
                );
              })}
              {rest > 0 && !open && <p className="gmore">本组还有 {rest} 条未显示</p>}
            </div>
          );
        })}
        {!shown.length && (
          <div className="quiet-group small dim" style={{ marginTop: 8, borderTop: 'none' }}>
            当前筛选下没有记录，可以清空搜索或取消「只看行列已核验」。
          </div>
        )}
      </div>

      {cmp && onGo && (
        <NextStep
          title="看懂差异之后"
          desc="可以继续看方法之间的原文关系，或按你的基础与目标生成阅读路线。"
          actionLabel="查看方法关系"
          onAction={() => onGo('graph')}
          secondary={{ label: '看阅读路线', onAction: () => onGo('decision') }}
        />
      )}
    </div>
  );
}
