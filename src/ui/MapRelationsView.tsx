import React, { useEffect, useMemo, useState } from 'react';
import type { Evidence, ExperimentRecord, Method, Paper, Relation } from '../core/types';
import { RELATION_LABELS } from '../core/types';
import { compareExperiments } from '../core/experiments';
import { buildMethodProfile, relationExplanation, relationSentence } from '../core/grouping';
import { Status } from './common';

interface Props {
  papers: Paper[];
  methods: Method[];
  relations: Relation[];
  onOpenEvidence: (ev: Evidence) => void;
  /** 从地图选中两个方法后进入时预置的对照 */
  initialPair?: string[];
}

const STATE_LABEL: Record<string, string> = { explicit: '原文已说明', inferred: '系统推断', candidate: '待核查' };
const STATE_KIND: Record<string, string> = { explicit: 'ok', inferred: 'info', candidate: 'pending' };

/**
 * 联系与区别：关系的**明细视图**（与地图同一份数据）。
 * - 关系方向以「起点 → 指向」为准，说明文字按同一方向生成，从任一端查看都不会讲反；
 * - 对称关系（相近/不明确）不强行加方向；
 * - 选两个方法先给「问题 / 做法 / 局限 / 数据集 / 指标」对照，「比较实验表现」是可展开的次级入口。
 */
export function MapRelationsView({ papers, methods, relations, onOpenEvidence, initialPair }: Props) {
  const [pair, setPair] = useState<string[]>(initialPair ?? []);
  const [showExp, setShowExp] = useState(false);

  useEffect(() => {
    if (initialPair && initialPair.length) setPair(initialPair);
  }, [initialPair]);

  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const profileOf = useMemo(() => {
    const m = new Map<string, ReturnType<typeof buildMethodProfile>>();
    for (const x of methods) m.set(x.id, buildMethodProfile(x, paperById.get(x.paperId), papers));
    return m;
  }, [methods, paperById, papers]);
  const nameOf = (id: string) => profileOf.get(id)?.shortName ?? id;

  const linkedIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of relations) {
      s.add(r.fromMethodId);
      s.add(r.toMethodId);
    }
    return s;
  }, [relations]);

  const pairMethods = pair.map((id) => methods.find((m) => m.id === id)).filter(Boolean) as Method[];
  const cmpExp = useMemo(() => {
    if (pairMethods.length !== 2) return null;
    const exps = pairMethods.map((m) => (m.experiments ?? []).filter((e) => e.taskTag === 'classification'));
    if (!exps[0]?.length || !exps[1]?.length) return null;
    const a: ExperimentRecord = exps[0][0];
    const b: ExperimentRecord = exps[1][0];
    return { a, b, cmp: compareExperiments(a, b) };
  }, [pairMethods]);

  /** 两个选中方法之间的关系说明（双向都不颠倒） */
  const pairRelations = useMemo(() => {
    if (pairMethods.length !== 2) return [];
    const [a, b] = pairMethods;
    return relations
      .filter((r) => (r.fromMethodId === a.id && r.toMethodId === b.id) || (r.fromMethodId === b.id && r.toMethodId === a.id))
      .map((r) => ({ rel: r, sentence: relationSentence(r, a.id, nameOf).text }));
  }, [pairMethods, relations, profileOf]);

  const timeline = useMemo(
    () =>
      [...methods]
        .map((m) => ({ m, year: paperById.get(m.paperId)?.year ?? null }))
        .sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999)),
    [methods, paperById],
  );

  return (
    <div>
      <h2 className="page">联系与区别</h2>
      <p className="lead">这些方法如何关联？它们到底有什么不同？（与地图是同一份关系数据）</p>

      <div className="card tight" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong style={{ fontSize: 14 }}>关系图例</strong>
          <Status kind="ok">原文明示</Status>
          <Status kind="info">系统推断</Status>
          <Status kind="pending">待核查</Status>
          <span className="small dim">
            关系表里的方向以数据为准（起点 → 指向）；相近/不明确的关系不声明方向。系统没有凭年份或关键词连边。
          </span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="cmp">
          <thead>
            <tr>
              <th style={{ width: 130 }}>起点方法</th>
              <th style={{ width: 110 }}>关系类型</th>
              <th style={{ width: 130 }}>指向方法</th>
              <th>说明（按同一方向描述）</th>
              <th style={{ width: 110 }}>证据状态</th>
              <th style={{ width: 120 }}>原文依据</th>
            </tr>
          </thead>
          <tbody>
            {relations.map((r) => (
              <tr key={r.id}>
                <td className="small">{nameOf(r.fromMethodId)}</td>
                <td className="small">
                  {RELATION_LABELS[r.type]}
                  {r.userEdited ? <span className="dim"> ·人工</span> : null}
                </td>
                <td className="small">{nameOf(r.toMethodId)}</td>
                <td className="small">
                  {relationSentence(r, r.toMethodId, nameOf).text}
                  <div className="dim" style={{ marginTop: 3 }}>
                    {relationExplanation(r).slice(0, 120)}
                  </div>
                </td>
                <td className="small">
                  <Status kind={STATE_KIND[r.evidenceState]}>{STATE_LABEL[r.evidenceState]}</Status>
                </td>
                <td className="small">
                  {r.evidence ? (
                    <button className="btn ghost sm" onClick={() => onOpenEvidence(r.evidence!)}>
                      查看原文
                    </button>
                  ) : (
                    <span className="dim">无引文</span>
                  )}
                </td>
              </tr>
            ))}
            {!relations.length && (
              <tr>
                <td colSpan={6} className="small dim" style={{ padding: 14 }}>
                  当前论文集合还没有可核验的方法关系。系统不会凭年份或关键词连边；补充更多论文或做一次关系分析后再看这里。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {methods.filter((m) => !linkedIds.has(m.id)).length > 0 && (
        <p className="small dim" style={{ marginTop: 10 }}>
          独立节点（暂无关系证据）：{methods.filter((m) => !linkedIds.has(m.id)).map((m) => nameOf(m.id)).join('、')}
        </p>
      )}

      <div className="card tight" style={{ marginTop: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong style={{ fontSize: 14 }}>发表顺序（时间线）</strong>
          <Status kind="cached">仅表示发表先后，不代表技术继承</Status>
        </div>
        <div className="route" style={{ paddingBottom: 4 }}>
          {timeline.map(({ m, year }, i) => (
            <React.Fragment key={m.id}>
              {i > 0 && <span className="sep">·</span>}
              <span className="mtag neutral" style={{ padding: '6px 12px' }}>
                {year ?? '年份未识别'}　{nameOf(m.id)}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>

      <h3 style={{ margin: '22px 0 10px' }}>选择两个方法，看它们的区别</h3>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {methods.map((m) => (
          <button
            key={m.id}
            className={`chip${pair.includes(m.id) ? ' on' : ''}`}
            onClick={() =>
              setPair((cur) => (cur.includes(m.id) ? cur.filter((x) => x !== m.id) : cur.length >= 2 ? [cur[1], m.id] : [...cur, m.id]))
            }
          >
            {nameOf(m.id)}
          </button>
        ))}
      </div>

      {pairMethods.length === 2 ? (
        <div className="card">
          {pairRelations.length > 0 && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="small dim">两者之间的关系：</span>
              {pairRelations.map(({ rel, sentence }) => (
                <Status key={rel.id} kind={STATE_KIND[rel.evidenceState]}>
                  {sentence}
                </Status>
              ))}
            </div>
          )}

          <div className="table-wrap">
            <table className="cmp">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>对比项</th>
                  <th>{nameOf(pairMethods[0].id)}</th>
                  <th>{nameOf(pairMethods[1].id)}</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['解决什么问题', (id: string) => profileOf.get(id)?.problem ?? ''],
                    ['核心做法', (id: string) => profileOf.get(id)?.approach ?? ''],
                    ['主要局限（论文自述）', (id: string) => profileOf.get(id)?.limitations ?? ''],
                    ['方法家族', (id: string) => `${profileOf.get(id)?.family.name ?? '待确认'}${profileOf.get(id)?.family.note ? `（${profileOf.get(id)?.family.note}）` : ''}`],
                    ['技术策略', (id: string) => (profileOf.get(id)?.strategies ?? []).map((s) => s.name).join('、') || '未识别到策略标签'],
                    ['数据集（已抽取）', (id: string) => methods.find((m) => m.id === id)?.fields.datasets?.value ?? ''],
                    ['评价指标（已抽取）', (id: string) => methods.find((m) => m.id === id)?.fields.metrics?.value ?? ''],
                  ] as [string, (id: string) => string][]
                ).map(([label, get], i) => (
                  <tr key={i}>
                    <td className="rowhead small">{label}</td>
                    <td className="small">{get(pairMethods[0].id).slice(0, 240) || '未提取到（仍需确认）'}</td>
                    <td className="small">{get(pairMethods[1].id).slice(0, 240) || '未提取到（仍需确认）'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {pairMethods.map((m) =>
              m.fields.coreIdea?.evidence ? (
                <button key={m.id} className="btn sm" onClick={() => onOpenEvidence(m.fields.coreIdea!.evidence!)}>
                  {nameOf(m.id)} 的原文依据（p.{m.fields.coreIdea.evidence.page ?? '?'}）
                </button>
              ) : null,
            )}
            <button className="btn ghost sm" onClick={() => setShowExp((v) => !v)}>
              {showExp ? '收起实验表现比较' : '比较实验表现（次级）'}
            </button>
          </div>

          {showExp && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <p className="small dim" style={{ marginTop: 0 }}>
                这一项只核对论文报告的实验结果能否放在同一口径下比较；它<strong>不是</strong>系统给论文的评分。
              </p>
              {cmpExp ? (
                <>
                  <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span>
                      <span className="mono" style={{ fontSize: 20 }}>
                        {cmpExp.a.metricValue}
                        {cmpExp.a.metricUnit ?? ''}
                      </span>
                      <span className="small dim">
                        {' '}
                        {nameOf(pairMethods[0].id)} · {cmpExp.a.metricName}
                      </span>
                    </span>
                    <span className="dim">对比</span>
                    <span>
                      <span className="mono" style={{ fontSize: 20 }}>
                        {cmpExp.b.metricValue}
                        {cmpExp.b.metricUnit ?? ''}
                      </span>
                      <span className="small dim">
                        {' '}
                        {nameOf(pairMethods[1].id)} · {cmpExp.b.metricName}
                      </span>
                    </span>
                    <Status kind={cmpExp.cmp.blocked.length ? 'bad' : cmpExp.cmp.unknowns.length ? 'pending' : 'info'}>
                      {cmpExp.cmp.blocked.length ? '不能直接比较' : cmpExp.cmp.unknowns.length ? '仍需确认' : '条件不同'}
                    </Status>
                  </div>
                  <ul className="small" style={{ paddingLeft: 18, marginTop: 10 }}>
                    {cmpExp.cmp.reasons.slice(0, 3).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                    {cmpExp.cmp.unknowns.slice(0, 2).map((u, i) => (
                      <li key={`u${i}`}>「{u.label}」的取值未知，无法确认口径是否一致。</li>
                    ))}
                  </ul>
                  <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {[cmpExp.a, cmpExp.b].map((e, i) =>
                      e.evidence ? (
                        <button key={i} className="btn ghost sm" onClick={() => onOpenEvidence(e.evidence!)}>
                          查看 {nameOf(pairMethods[i].id)} 的原文（p.{e.evidence.page ?? '?'}）
                        </button>
                      ) : null,
                    )}
                  </div>
                </>
              ) : (
                <p className="small dim" style={{ marginBottom: 0 }}>
                  这两篇在已抽取结果里没有可比对的实验记录（或分属不同任务），因此不做表现比较。
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="small dim">选择两个方法后，这里给出「问题 / 做法 / 局限 / 家族 / 策略 / 数据集 / 指标」对照；实验表现比较是可展开的次级入口。</p>
      )}
    </div>
  );
}
