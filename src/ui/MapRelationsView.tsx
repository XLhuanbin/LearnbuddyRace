import React, { useEffect, useMemo, useState } from 'react';
import type { Evidence, ExperimentRecord, Method, Paper, Relation } from '../core/types';
import { effectiveFieldValue } from '../core/effective';
import { RELATION_LABELS } from '../core/types';
import { pickComparableExperimentPair } from '../core/experiments';
import { buildMethodProfile, pickExploreRelation, relationExplanation, relationSentence } from '../core/grouping';
import { Status } from './common';

interface Props {
  papers: Paper[];
  methods: Method[];
  relations: Relation[];
  onOpenEvidence: (ev: Evidence) => void;
  /** 从地图选中两个方法后进入时预置的对照；[] = 用户要求自己选（不要替他挑） */
  initialPair?: string[];
  requireChoice?: boolean;
}

const STATE_LABEL: Record<string, string> = { explicit: '原文已说明', inferred: '系统推断', candidate: '待核查' };
const STATE_KIND: Record<string, string> = { explicit: 'ok', inferred: 'info', candidate: 'pending' };

/**
 * 联系与区别：关系的**明细视图**（与地图同一份数据）。
 *
 * 版面顺序（本轮调整）：
 *   1. 两方法对照 —— 先回答「这两个方法到底有什么不同」（默认给出关系证据最明确的一对）
 *   2. 关系明细表 —— 再看全部关系（方向、类型、证据状态、原文依据）
 *   3. 发表顺序（时间线）—— 只表示发表先后，不代表技术继承
 *
 * 约定：方向以「起点 → 指向」为准，从任一端查看都不会讲反；对称关系不声明方向；
 * 证据状态一律标注，无引文的关系明确写「无引文」；「比较实验表现」是可展开的次级入口，不是评分。
 */
export function MapRelationsView({ papers, methods, relations, onOpenEvidence, initialPair, requireChoice }: Props) {
  const [pair, setPair] = useState<string[]>(initialPair ?? []);
  // requireChoice：从「比较实验表现」进来但没有明确对端 → 保持"用户已动过手"，不自动替他挑一对
  const [pairTouched, setPairTouched] = useState(Boolean(initialPair?.length) || Boolean(requireChoice));
  const [showExp, setShowExp] = useState(false);

  useEffect(() => {
    if (initialPair && initialPair.length) {
      setPair(initialPair);
      setPairTouched(true);
    }
  }, [initialPair]);

  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const profileOf = useMemo(() => {
    const m = new Map<string, ReturnType<typeof buildMethodProfile>>();
    for (const x of methods) m.set(x.id, buildMethodProfile(x, paperById.get(x.paperId), papers));
    return m;
  }, [methods, paperById, papers]);
  const nameOf = (id: string) => profileOf.get(id)?.shortName ?? id;

  /** 默认对照对：从现有关系里挑一条最值得先看的（与地图上的探索问题同一套规则） */
  const suggested = useMemo(() => {
    const best = pickExploreRelation(relations);
    return best ? [best.toMethodId, best.fromMethodId] : [];
  }, [relations]);

  useEffect(() => {
    if (!pairTouched && pair.length !== 2 && suggested.length === 2) setPair(suggested);
  }, [pairTouched, pair.length, suggested]);

  const linkedIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of relations) {
      s.add(r.fromMethodId);
      s.add(r.toMethodId);
    }
    return s;
  }, [relations]);

  // 去重后再取：同一个 methodId 不允许自我比较
  const pairMethods = [...new Set(pair)]
    .map((id) => methods.find((m) => m.id === id))
    .filter(Boolean) as Method[];
  const cmpExp = useMemo(() => {
    if (pairMethods.length !== 2 || pairMethods[0].id === pairMethods[1].id) return null;
    // 在两个方法各自的实验记录里挑「同口径」的一对；挑不到就不给对照
    return pickComparableExperimentPair(pairMethods[0].experiments ?? [], pairMethods[1].experiments ?? []);
  }, [pairMethods]);

  /** 只有「可直接比较 / 有条件可比较」才展示并排数字；不可比时只讲原因，不摆数字 */
  const expNumbersAllowed = Boolean(
    cmpExp && (cmpExp.cmp.level === 'directly_comparable' || cmpExp.cmp.level === 'comparable_with_conditions'),
  );

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

  const pickChip = (id: string) => {
    setPairTouched(true);
    setPair((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 2 ? [cur[1], id] : [...cur, id]));
  };

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
            方向以数据为准（起点 → 指向）；相近/不明确的关系不声明方向。系统没有凭年份或关键词连边。
          </span>
        </div>
      </div>

      {/* ---------- 1. 两方法对照（放在长关系表之前） ---------- */}
      <h3 style={{ margin: '4px 0 8px' }}>两方法对照</h3>
      <p className="small dim" style={{ margin: '0 0 10px' }}>
        {suggested.length === 2 && !pairTouched
          ? `默认给出关系证据最明确的一对（${nameOf(suggested[1])} → ${nameOf(suggested[0])}）；也可以自己选两个方法。`
          : '选两个方法，对照它们的问题、做法、局限、家族与策略；实验表现比较是可展开的次级入口。'}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {methods.map((m) => (
          <button key={m.id} className={`chip${pair.includes(m.id) ? ' on' : ''}`} onClick={() => pickChip(m.id)}>
            {nameOf(m.id)}
          </button>
        ))}
      </div>

      {pairMethods.length === 2 ? (
        <div className="card">
          {pairRelations.length > 0 ? (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="small dim">两者之间的关系：</span>
              {pairRelations.map(({ rel, sentence }) => (
                <Status key={rel.id} kind={STATE_KIND[rel.evidenceState]}>
                  {sentence}
                </Status>
              ))}
            </div>
          ) : (
            <p className="small dim" style={{ marginTop: 0 }}>
              这两个方法之间没有可核验的关系证据，因此只做逐项对照，不声称技术继承。
            </p>
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
                    // 读取人工修正后的有效值（用户改过数据集/指标，这里必须跟着变）
                    ['数据集（已抽取）', (id: string) => effectiveFieldValue(methods.find((m) => m.id === id), 'datasets')],
                    ['评价指标（已抽取）', (id: string) => effectiveFieldValue(methods.find((m) => m.id === id), 'metrics')],
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
                  {expNumbersAllowed ? (
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
                      <Status kind={cmpExp.cmp.unknowns.length ? 'pending' : 'info'}>
                        {cmpExp.cmp.unknowns.length ? '仍需确认' : '条件不同'}
                      </Status>
                    </div>
                  ) : (
                    /* 没有同口径实验：不并排摆两个不可比的数字，只说明为什么不能比 */
                    <p className="small" style={{ margin: '0 0 4px', color: 'var(--warn)' }}>
                      这两篇没有能在同一口径下对照的实验记录，因此<strong>不并列数字</strong>——并排两个不可比的值会造成误导。
                    </p>
                  )}
                  <ul className="small" style={{ paddingLeft: 18, marginTop: 10 }}>
                    {cmpExp.cmp.reasons.slice(0, 4).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                    {cmpExp.cmp.unknowns.slice(0, 3).map((u, i) => (
                      <li key={`u${i}`}>「{u.label}」的取值未知，无法确认口径是否一致。</li>
                    ))}
                  </ul>
                  <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {[cmpExp.a, cmpExp.b].map((e, i) =>
                      e.evidence ? (
                        <button key={i} className="btn ghost sm" onClick={() => onOpenEvidence(e.evidence!)}>
                          查看 {nameOf(pairMethods[i].id)} 的原文依据（p.{e.evidence.page ?? '?'}）
                        </button>
                      ) : null,
                    )}
                  </div>
                </>
              ) : (
                <p className="small dim" style={{ marginBottom: 0 }}>
                  这两篇在已抽取结果里没有可比对的实验记录（或分属不同任务 / 数据集 / 指标），因此不做表现比较，也不摆数字。
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="small dim">在上面选两个方法，这里给出「问题 / 做法 / 局限 / 家族 / 策略 / 数据集 / 指标」对照。</p>
      )}

      {/* ---------- 2. 关系明细（长表放在对照之后） ---------- */}
      <h3 style={{ margin: '24px 0 8px' }}>关系明细（{relations.length} 条）</h3>
      <p className="small dim" style={{ margin: '0 0 10px' }}>
        含「关系不明确」的配对与待核查关系；每条都标注证据状态，没有绑定引文的写「无引文」。
      </p>
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

      {/* ---------- 3. 发表顺序（时间线） ---------- */}
      <div className="card tight" style={{ marginTop: 14 }}>
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
    </div>
  );
}
