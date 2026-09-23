import React, { useEffect, useMemo, useState } from 'react';
import type { Evidence, ExperimentRecord, Method, Paper } from '../core/types';
import { compareExperiments } from '../core/experiments';
import type { CorpusScope } from '../core/corpus';
import { Status } from './common';

interface Props {
  papers: Paper[];
  methods: Method[];
  scope: CorpusScope;
  onOpenEvidence: (ev: Evidence) => void;
  onGoEvolution: () => void;
}

/** 结论 → 用户能直接看懂的一句话（不含内部术语） */
const LEVEL_SENTENCE: Record<string, string> = {
  directly_comparable: '两项结果的评估数据与已写明的条件一致，可以直接比较。',
  comparable_with_conditions: '两项结果的条件不同，分数差异不能直接归因于模型结构。',
  insufficient_info: '信息不足，不能直接判断谁更好。',
  not_comparable: '两项结果不在同一个口径上，不能直接比较。',
};

const LEVEL_TAG: Record<string, string> = {
  directly_comparable: '能直接比较',
  comparable_with_conditions: '需要结合条件看',
  insufficient_info: '仍需确认',
  not_comparable: '不能直接比较',
};

const LEVEL_KIND: Record<string, string> = {
  directly_comparable: 'ok',
  comparable_with_conditions: 'info',
  insufficient_info: 'pending',
  not_comparable: 'bad',
};

/** 条件的中文名（面向用户，不用内部字段名） */
const COND_LABEL: Record<string, string> = {
  pretrainData: '预训练数据',
  trainData: '训练数据',
  evalSplit: '评估划分',
  inputResolution: '输入分辨率',
  extraData: '额外训练数据',
  distillation: '知识蒸馏',
  testTimeAug: '测试时增强',
  inferenceMode: '单模型 / 集成',
  evalDataset: '评估数据集',
  metricName: '评价指标',
  taskTag: '任务类型',
  tableBinding: '数据在表格中的位置',
};

const label = (k: string) => COND_LABEL[k] ?? k;

/**
 * 结果页：先给出一组推荐比较，直接展示结论。
 * 用户只看三类信息：结论是什么、为什么这样判断、去哪里看原文依据。
 */
export function ResultsView({ papers, methods, scope, onOpenEvidence, onGoEvolution }: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const scopedMethods = useMemo(() => [...scope.presetMethods, ...scope.ownMethods], [scope]);
  const all = useMemo(() => scopedMethods.flatMap((m) => m.experiments ?? []), [scopedMethods]);
  const classification = useMemo(() => all.filter((e) => e.taskTag === 'classification'), [all]);

  const shortName = (paperId: string) => {
    const t = paperById.get(paperId)?.title ?? '';
    if (/Residual/.test(t)) return 'ResNet';
    if (/AN IMAGE/.test(t)) return 'ViT';
    if (/data-efficient/.test(t)) return 'DeiT';
    if (/Swin/.test(t)) return 'Swin';
    if (/ConvNet/.test(t)) return 'ConvNeXt';
    return t.slice(0, 12);
  };

  const nameOf = (e: ExperimentRecord) => `${shortName(e.paperId)} · ${e.modelVariant}`;
  const datasetOf = (e: ExperimentRecord) => e.evalDataset.replace(/ validation| val|\/test-dev/g, '');

  /** 条件字段（面向用户展示的 8 项） */
  const COND_FIELDS: [string, string][] = [
    ['预训练数据', 'pretrainData'],
    ['训练数据', 'trainData'],
    ['评估数据集', 'evalDataset'],
    ['输入分辨率', 'inputResolution'],
    ['额外训练数据', 'extraData'],
    ['知识蒸馏', 'distillation'],
    ['测试时增强', 'testTimeAug'],
    ['单模型 / 集成', 'inferenceMode'],
  ];

  /**
   * 推荐组合：优先「同一指标、条件写得比较全」的组合（用户能看到真正的可比性讨论）；
   * 「口径不同」（错误率 vs 准确率）的例子作为备选放在最后，用于演示不能直接比较。
   */
  const recommended = useMemo(() => {
    const discussable: { a: ExperimentRecord; b: ExperimentRecord; score: number }[] = [];
    const crossMetric: { a: ExperimentRecord; b: ExperimentRecord }[] = [];
    for (let i = 0; i < classification.length; i++) {
      for (let j = i + 1; j < classification.length; j++) {
        const a = classification[i];
        const b = classification[j];
        if (a.paperId === b.paperId || a.metricValue === b.metricValue) continue;
        const c = compareExperiments(a, b);
        if (c.blocked.some((x) => x.field === 'metricName')) {
          if (crossMetric.length < 1) crossMetric.push({ a, b });
          continue;
        }
        if (c.level === 'not_comparable') continue;
        discussable.push({ a, b, score: c.unknowns.length * 10 + c.differences.length });
      }
    }
    discussable.sort((x, y) => x.score - y.score);
    return [...discussable.slice(0, 3), ...crossMetric];
  }, [classification]);

  useEffect(() => {
    if (!picked.length && recommended.length) {
      const first = recommended.find((p) => compareExperiments(p.a, p.b).level !== 'not_comparable') ?? recommended[0];
      setPicked([first.a.id, first.b.id]);
    }
  }, [recommended, picked.length]);

  const pickedList = picked.map((id) => all.find((e) => e.id === id)).filter(Boolean) as ExperimentRecord[];
  const cmp = pickedList.length === 2 ? compareExperiments(pickedList[0], pickedList[1]) : null;

  if (!all.length) {
    return (
      <div>
        <h1 className="page">这些结果，真的能直接比较吗？</h1>
        <p className="lead">案例还没有准备完成，回到上一步开始查看案例即可。</p>
      </div>
    );
  }

  const diffs = cmp ? [...cmp.blocked, ...cmp.differences] : [];
  const unknowns = cmp ? cmp.unknowns : [];
  const knownSame = cmp
    ? COND_FIELDS.filter(
        ([labelText, field]) =>
          !diffs.some((d) => d.field === field || label(d.field) === labelText) &&
          !unknowns.some((u) => u.field === field || label(u.field) === labelText),
      ).map(([labelText]) => labelText)
    : [];

  const reasonSentence = cmp
    ? diffs.length
      ? `两个结果的${diffs.slice(0, 2).map((d) => label(d.field)).join('、')}不同，分数差异不能直接归因于模型结构。`
      : unknowns.length
        ? `有几项关键条件没有写清楚（${unknowns.slice(0, 2).map((u) => label(u.field)).join('、')}），无法确认两个分数是否在同一口径下。`
        : '两项结果的条件一致，可以直接比较。'
    : '';

  return (
    <div>
      <h2 className="page" style={{ textAlign: 'center', marginBottom: 4 }}>
        这些结果，真的能直接比较吗？
      </h2>
      <p className="lead" style={{ textAlign: 'center', margin: '0 auto 22px' }}>
        下面是一组推荐比较（不是排名，也不代表谁更好）。
      </p>

      {pickedList.length === 2 && cmp && (
        <>
          <div className="resultpair">
            {pickedList.map((e, i) => (
              <React.Fragment key={e.id}>
                {i === 1 && <div className="vs">对比</div>}
                <div className="rcard">
                  <div className="who">{nameOf(e)}</div>
                  <div className="ds">{datasetOf(e)}</div>
                  <div className="big">
                    {e.metricValue}
                    {e.metricUnit ?? ''}
                  </div>
                  <div className="metric">{e.metricName}</div>
                </div>
              </React.Fragment>
            ))}
          </div>

          <div className={`verdict-big ${LEVEL_KIND[cmp.level]}`}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <Status kind={LEVEL_KIND[cmp.level]}>{LEVEL_TAG[cmp.level]}</Status>
            </div>
            <h2>{LEVEL_SENTENCE[cmp.level]}</h2>
            <p>{reasonSentence}</p>
          </div>

          {/* 简单可视化：相同 / 不同 / 未知 三列 */}
          <div className="condgrid" style={{ marginBottom: 16 }}>
            <div className="condcol same">
              <h4>
                <Status kind="ok">一致</Status>
              </h4>
              <ul>
                {knownSame.map((k) => (
                  <li key={k}>{k}</li>
                ))}
                {!knownSame.length && <li className="dim">暂无可确认的一致项</li>}
              </ul>
            </div>
            <div className="condcol diff">
              <h4>
                <Status kind="pending">不同</Status>
              </h4>
              <ul>
                {diffs.map((d, i) => (
                  <li key={i}>
                    {label(d.field)}
                    <div className="small dim">
                      {String(d.a).slice(0, 26)} / {String(d.b).slice(0, 26)}
                    </div>
                  </li>
                ))}
                {!diffs.length && <li className="dim">没有发现不同的条件</li>}
              </ul>
            </div>
            <div className="condcol unknown">
              <h4>
                <Status kind="warn">仍需确认</Status>
              </h4>
              <ul>
                {unknowns.map((u, i) => (
                  <li key={i}>{label(u.field)}</li>
                ))}
                {!unknowns.length && <li className="dim">没有未写明的条件</li>}
              </ul>
            </div>
          </div>

          {/* 三类可折叠信息 */}
          <details className="fold">
            <summary>为什么这样判断</summary>
            <div className="fold-body">
              <p>
                程序逐项对照论文里写明的条件：预训练数据、训练数据、评估数据集与划分、输入分辨率、
                额外的训练数据、知识蒸馏、测试时增强、单模型或集成。
              </p>
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
              <p className="dim">
                这套判断只看「论文写明的条件是否一致」，不评价方法优劣，也不做排名。
              </p>
            </div>
          </details>

          <details className="fold">
            <summary>哪些条件不同</summary>
            <div className="fold-body">
              <div className="table-wrap">
                <table className="cmp">
                  <thead>
                    <tr>
                      <th style={{ width: 150 }}>条件</th>
                      <th>{nameOf(pickedList[0])}</th>
                      <th>{nameOf(pickedList[1])}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COND_FIELDS.map(([k, key], i) => (
                      <tr key={i}>
                        <td className="small">{k}</td>
                        <td className="small">
                          {String((pickedList[0] as unknown as Record<string, string>)[key] ?? '未写明')}
                        </td>
                        <td className="small">
                          {String((pickedList[1] as unknown as Record<string, string>)[key] ?? '未写明')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>

          <details className="fold">
            <summary>查看原文依据</summary>
            <div className="fold-body">
              <p className="dim" style={{ marginBottom: 10 }}>
                每个数值都能回到论文原文的某一行；下面可以打开原文确认，或查看两个结果的出处页码。
              </p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {pickedList.map(
                  (e) =>
                    e.evidence && (
                      <button key={e.id} className="btn sm" onClick={() => onOpenEvidence(e.evidence!)}>
                        {nameOf(e)} 的原文依据（p.{e.evidence.page ?? '?'}）
                      </button>
                    ),
                )}
              </div>
            </div>
          </details>

          <div className="row" style={{ gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => setShowPicker((v) => !v)}>
              {showPicker ? '收起候选结果' : '换一组结果比较'}
            </button>
            <button className="btn ghost" onClick={onGoEvolution}>
              看方法演进
            </button>
          </div>

          {showPicker && (
            <div className="card" style={{ marginTop: 12 }}>
              <p className="small dim" style={{ marginTop: 0 }}>
                推荐组合（点一下即可切换）：
              </p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {recommended.map((p, i) => (
                  <button key={i} className="chip" onClick={() => setPicked([p.a.id, p.b.id])}>
                    {nameOf(p.a)} ↔ {nameOf(p.b)}
                  </button>
                ))}
              </div>
              <p className="small dim">或者自己挑两个结果：</p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {classification.map((e) => (
                  <button
                    key={e.id}
                    className={`chip${picked.includes(e.id) ? ' on' : ''}`}
                    onClick={() =>
                      setPicked((cur) => (cur.includes(e.id) ? cur.filter((x) => x !== e.id) : cur.length >= 2 ? [cur[1], e.id] : [...cur, e.id]))
                    }
                  >
                    {nameOf(e)} {e.metricValue}
                    {e.metricUnit ?? ''}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
