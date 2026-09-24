import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Evidence, Method, Paper, Relation, RelationEvidenceState } from '../core/types';
import { RELATION_LABELS } from '../core/types';
import {
  buildMethodProfile,
  exploreQuestion,
  firstSentence,
  pickExploreRelation,
  relationExplanation,
  relationSentence,
  shortContribution,
  type MethodProfile,
} from '../core/grouping';
import { Status } from './common';

interface Props {
  papers: Paper[];
  methods: Method[];
  relations: Relation[];
  onOpenEvidence: (ev: Evidence) => void;
  /** 查看两个方法的完整对照（切到「联系与区别」并预置这一对） */
  onOpenPair: (a: string, b: string) => void;
  /** 选中两个方法后，进入次级入口做实验表现比较 */
  onCompareExperiments: (a: string, b: string) => void;
  /** 显示选项（由工作区的「选项」弹层控制，避免工具栏堆开关） */
  showPending: boolean;
  showUnclear: boolean;
  /** 只看绑定了可核验引文的关系 */
  onlyEvidence?: boolean;
}

/**
 * 线型 + 颜色双重区分（不只靠颜色），沿用项目既有约定：
 *   原文明示 = 深绿实线 ／ 系统推断 = 铜色虚线 ／ 待核查 = 低对比度虚线
 */
const EDGE_STYLE: Record<RelationEvidenceState, { color: string; dash?: string; width: number; label: string }> = {
  explicit: { color: '#2f6b4a', width: 2.2, label: '原文明示' },
  inferred: { color: '#9e5326', dash: '9 6', width: 2, label: '系统推断' },
  candidate: { color: '#a49a8c', dash: '2 6', width: 1.7, label: '待核查' },
};

const STATE_TEXT: Record<RelationEvidenceState, string> = {
  explicit: '原文已说明',
  inferred: '系统推断',
  candidate: '待核查',
};
const STATE_KIND: Record<RelationEvidenceState, string> = {
  explicit: 'ok',
  inferred: 'info',
  candidate: 'pending',
};

const LANE_ORDER: MethodProfile['family']['id'][] = ['cnn', 'transformer', 'hybrid', 'pending'];
const NODE_W = 250;
const NODE_H = 96;
const LANE_GAP = 152;
const PAD = 26;
const HEADER = 48;

interface Placed {
  profile: MethodProfile;
  method: Method;
  paper?: Paper;
  x: number;
  y: number;
  lane: number;
}

/**
 * 探索画布：泳道 = 方法家族（只按真实归组结果分栏，篇数由数据动态给出），
 * 节点 = 短名称 + 年份 + 一条短贡献；连线只画真实关系。
 *
 * 版面：三步引导（完整地图之前）→ 画布 → 图例与缩放 → 浮层详情。
 * 不自动轮播、不循环动画；所有动效都支持 prefers-reduced-motion。
 */
export function MethodMap({
  papers,
  methods,
  relations,
  onOpenEvidence,
  onOpenPair,
  onCompareExperiments,
  showPending,
  showUnclear,
  onlyEvidence = false,
}: Props) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);

  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const profiles = useMemo(
    () => methods.map((m) => buildMethodProfile(m, paperById.get(m.paperId), papers)),
    [methods, paperById, papers],
  );
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.methodId, p])), [profiles]);
  const nameOf = (methodId: string) => profileById.get(methodId)?.shortName ?? methodId;

  const visibleRelations = useMemo(
    () =>
      relations
        .filter((r) => (showUnclear ? true : r.type !== 'unclear'))
        .filter((r) => (showPending ? true : r.evidenceState !== 'candidate'))
        .filter((r) => (onlyEvidence ? Boolean(r.evidence) : true)),
    [relations, showPending, showUnclear, onlyEvidence],
  );

  /** 当前筛选下没有连线时，如实说明为什么（不伪造网络） */
  const hiddenNote = useMemo(() => {
    const unclear = relations.filter((r) => r.type === 'unclear').length;
    const candidate = relations.filter((r) => r.evidenceState === 'candidate' && r.type !== 'unclear').length;
    const withEv = relations.filter((r) => r.evidence).length;
    const bits: string[] = [];
    if (!showUnclear && unclear) bits.push(`${unclear} 条「关系不明确」默认不画（避免制造不存在的联系）`);
    if (!showPending && candidate) bits.push(`${candidate} 条待核查默认隐藏`);
    if (onlyEvidence && withEv === 0) bits.push('当前没有任何关系绑定了可核验引文');
    return bits.join('；');
  }, [relations, showUnclear, showPending, onlyEvidence]);

  const { placed, lanes, width, height } = useMemo(() => {
    const byFamily = new Map<string, Method[]>();
    for (const m of methods) {
      const fam = profileById.get(m.id)?.family.id ?? 'pending';
      if (!byFamily.has(fam)) byFamily.set(fam, []);
      byFamily.get(fam)!.push(m);
    }
    const laneIds = LANE_ORDER.filter((id) => byFamily.has(id));
    let x = PAD;
    let maxRows = 1;
    const placedNodes: Placed[] = [];
    const laneMeta: { id: string; name: string; x: number; count: number }[] = [];

    laneIds.forEach((id) => {
      const list = byFamily.get(id) ?? [];
      maxRows = Math.max(maxRows, list.length);
      const name = profileById.get(list[0].id)?.family.name ?? id;
      laneMeta.push({ id, name, x, count: list.length });
      list
        .slice()
        .sort((a, b) => (paperById.get(a.paperId)?.year ?? 9999) - (paperById.get(b.paperId)?.year ?? 9999))
        .forEach((m, i) => {
          placedNodes.push({
            profile: profileById.get(m.id)!,
            method: m,
            paper: paperById.get(m.paperId),
            x: x + NODE_W / 2,
            y: HEADER + 26 + i * (NODE_H + 22) + NODE_H / 2,
            lane: laneMeta.length - 1,
          });
        });
      x += NODE_W + LANE_GAP;
    });

    return {
      placed: placedNodes,
      lanes: laneMeta,
      width: Math.max(560, x - LANE_GAP + PAD + 150),
      height: HEADER + 26 + maxRows * (NODE_H + 22) + 20,
    };
  }, [methods, profileById, paperById]);

  const nodeById = useMemo(() => new Map(placed.map((p) => [p.method.id, p])), [placed]);

  const activeNodeIds = useMemo(() => {
    if (selectedNode) {
      const ids = new Set<string>([selectedNode]);
      for (const r of visibleRelations) {
        if (r.fromMethodId === selectedNode) ids.add(r.toMethodId);
        if (r.toMethodId === selectedNode) ids.add(r.fromMethodId);
      }
      return ids;
    }
    if (selectedEdge) {
      const r = visibleRelations.find((x) => x.id === selectedEdge);
      return new Set<string>(r ? [r.fromMethodId, r.toMethodId] : []);
    }
    return null;
  }, [selectedNode, selectedEdge, visibleRelations]);

  /** 引导里的问题：从现有关系里挑一条（不写死方法对），与「联系与区别」用同一套规则 */
  const exploreRel = useMemo(() => pickExploreRelation(visibleRelations), [visibleRelations]);
  const explore = exploreRel
    ? {
        rel: exploreRel,
        text: exploreQuestion(exploreRel.type, nameOf(exploreRel.fromMethodId), nameOf(exploreRel.toMethodId)),
      }
    : null;

  /** 三步引导：进入视口淡入，向上滚动反向淡出（不 unobserve，可重播） */
  useEffect(() => {
    const el = wrapRef.current?.querySelector<HTMLElement>('.mapguide');
    if (!el) return;
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      el.classList.add('in');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.target.classList.toggle('in', e.isIntersecting)),
      { rootMargin: '-4% 0px -12% 0px', threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const selectedRelation = selectedEdge ? visibleRelations.find((r) => r.id === selectedEdge) ?? null : null;
  const nodeDetail = selectedNode ? nodeById.get(selectedNode) : null;
  const relatedRelations = selectedNode
    ? visibleRelations.filter((r) => r.fromMethodId === selectedNode || r.toMethodId === selectedNode)
    : [];

  /** 详情面板是否打开（缩放控件据此避让） */
  const panelOpen = Boolean(selectedRelation || nodeDetail);

  if (!methods.length) {
    return <div className="card">这组论文还没有方法分析结果，无法绘制地图。</div>;
  }

  /** 引导问题：点一下就把对应节点与连线一起选中，并打开详情面板 */
  const askExplore = () => {
    if (!explore) return;
    setSelectedEdge(explore.rel.id);
    setSelectedNode(null);
  };

  return (
    <div className="mapwrap" ref={wrapRef}>
      {/* ---------- 三步引导（完整地图之前） ---------- */}
      <div className="mapguide reveal">
        <div className="gsteps">
          <div className="gstep">
            <span className="no">01</span>
            <div>
              <b>选择方法</b>
              <span>点一个方法节点，或点两个方法之间的连线</span>
            </div>
          </div>
          <div className="gstep">
            <span className="no">02</span>
            <div>
              <b>看一句话回答</b>
              <span>先说结论，再说这条结论是怎么来的</span>
            </div>
          </div>
          <div className="gstep">
            <span className="no">03</span>
            <div>
              <b>查看证据与完整对照</b>
              <span>展开原文依据，或进入两个方法的完整对照</span>
            </div>
          </div>
        </div>

        <p className="gnone">
          问题在画布顶部；也可以直接点任意节点或连线开始。
        </p>
      </div>

      {/* ---------- 关系不足时的如实说明（不伪造网络） ---------- */}
      {visibleRelations.length === 0 && (
        <div className="lite" style={{ marginBottom: 12, padding: '10px 14px' }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Status kind="pending">当前没有直接关系可画</Status>
            <span className="small" style={{ flex: '1 1 300px' }}>
              {hiddenNote ? `${hiddenNote}。` : '这组论文目前没有可画出的方法关系。'}
              系统不会为了让画布更满而补齐连线；分栏仍按真实方法家族呈现，可以点节点逐个看它做了什么。
            </span>
          </div>
        </div>
      )}

      {/* ---------- 画布（详情面板是并列的一列，不覆盖地图主体） ---------- */}
      <div className="mapwork">
        <div className="mapstagewrap">
          <div className="mapstage">
            {/* 画布顶部：当前研究问题（真实关系生成，不是写死的） */}
            {explore ? (
              <div className="mapstage-q">
                <span className="k">当前研究问题</span>
                <span className="q">{explore.text}</span>
                <Status kind={STATE_KIND[explore.rel.evidenceState]}>{STATE_TEXT[explore.rel.evidenceState]}</Status>
                <button className="btn ghost sm" onClick={askExplore}>
                  去回答 →
                </button>
              </div>
            ) : (
              <div className="mapstage-q">
                <span className="k">当前研究问题</span>
                <span className="q">当前集合还没有可核验的方法关系，不生成提问（也不用年份或关键词硬连边）。</span>
              </div>
            )}
            <svg viewBox={`0 0 ${width} ${height}`} width={width * zoom} height={height * zoom} role="img" aria-label="方法地图">
            <defs>
              {(Object.keys(EDGE_STYLE) as RelationEvidenceState[]).map((s) => (
                <marker key={s} id={`mm-arrow-${s}`} markerWidth="9" markerHeight="7" refX="7" refY="3.5" orient="auto">
                  <path d="M0,0 L0,7 L8,3.5 z" fill={EDGE_STYLE[s].color} />
                </marker>
              ))}
            </defs>

            {/* 泳道：名称与篇数都来自本次真实归组结果 */}
            {lanes.map((l) => (
              <g key={l.id}>
                <rect x={l.x - 8} y={10} width={NODE_W + 16} height={height - 26} rx={14} fill="var(--bg)" stroke="var(--line)" />
                <text x={l.x + 4} y={32} fontSize={12.5} fontWeight={650} fill="var(--fg-2)">
                  {l.name} · {l.count}
                </text>
              </g>
            ))}

            {/* 连线：默认只有结构，标签在悬停/聚焦/选中时出现 */}
            {visibleRelations.map((r, idx) => {
              const a = nodeById.get(r.fromMethodId);
              const b = nodeById.get(r.toMethodId);
              if (!a || !b) return null;
              const st = EDGE_STYLE[r.evidenceState];
              const sameLane = a.lane === b.lane;
              const dir = b.x >= a.x ? 1 : -1;
              const x1 = sameLane ? a.x + NODE_W / 2 : a.x + (dir * NODE_W) / 2;
              const y1 = a.y;
              const x2 = sameLane ? b.x + NODE_W / 2 : b.x - (dir * NODE_W) / 2;
              const y2 = b.y;
              const gapX = sameLane
                ? Math.max(x1, x2) + 46 + (idx % 3) * 18
                : (x1 + x2) / 2 + ((idx % 3) - 1) * 14;
              const d = `M ${x1} ${y1} C ${gapX} ${y1} ${gapX} ${y2} ${x2} ${y2}`;
              const isSel = selectedEdge === r.id;
              const isHover = hoverEdge === r.id;
              const showLabel = isSel || isHover;
              const incident = activeNodeIds ? activeNodeIds.has(r.fromMethodId) && activeNodeIds.has(r.toMethodId) : false;
              const opacity = selectedEdge || selectedNode ? (isSel || incident ? 1 : 0.12) : 1;
              const verb =
                r.type === 'extends' ? '基于' : r.type === 'improves' ? '改进' : r.type === 'combines' ? '组合' : '相近';
              const label =
                r.type === 'similar' || r.type === 'unclear'
                  ? `${nameOf(r.fromMethodId)} ↔ ${nameOf(r.toMethodId)}`
                  : `${nameOf(r.toMethodId)} ${verb} ${nameOf(r.fromMethodId)}`;
              const labelX = sameLane ? gapX + 10 + (idx % 3) * 4 : gapX;
              const labelY = (y1 + y2) / 2;
              return (
                <g
                  key={r.id}
                  className={`medge mm-${r.evidenceState}${incident ? ' hot' : ''}`}
                  tabIndex={0}
                  onClick={() => {
                    setSelectedEdge(isSel ? null : r.id);
                    setSelectedNode(null);
                  }}
                  onMouseEnter={() => setHoverEdge(r.id)}
                  onMouseLeave={() => setHoverEdge(null)}
                  onFocus={() => setHoverEdge(r.id)}
                  onBlur={() => setHoverEdge(null)}
                >
                  <title>{`${label}（${st.label}）`}</title>
                  <path
                    className="line"
                    d={d}
                    fill="none"
                    /* pathLength=1 只在实线（原文明示）上启用：让 CSS 能按整条路径的长度做「绘制」动画 */
                    pathLength={r.evidenceState === 'explicit' ? 1 : undefined}
                    stroke={st.color}
                    strokeWidth={isSel ? st.width + 1.2 : st.width}
                    strokeDasharray={st.dash}
                    markerEnd={`url(#mm-arrow-${r.evidenceState})`}
                    opacity={opacity}
                  />
                  <path d={d} fill="none" stroke="transparent" strokeWidth={18} />
                  {showLabel && (
                    <g>
                      <rect
                        x={labelX - label.length * 3.4 - 7}
                        y={labelY - 15}
                        width={label.length * 6.8 + 14}
                        height={18}
                        rx={5}
                        fill="var(--bg-2)"
                        stroke="var(--line)"
                      />
                      <text x={labelX} y={labelY - 2} textAnchor="middle" fontSize={10.5} fill={st.color}>
                        {label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* 节点：短名称 + 年份 + 一条短贡献（字号保证可读；进入时按顺序轻微上浮） */}
            {placed.map((p, idx) => {
              const sel = selectedNode === p.method.id;
              const near = activeNodeIds ? activeNodeIds.has(p.method.id) && !sel : false;
              const short = shortContribution(p.profile.approach) || '未提取到核心思路';
              const lines = short.match(/.{1,17}/g)?.slice(0, 2) ?? [];
              return (
                <g
                  key={p.method.id}
                  className={`mnode${sel ? ' sel' : near ? ' near' : ''}`}
                  tabIndex={0}
                  style={{ ['--nd' as never]: `${Math.min(idx * 55, 440)}ms` }}
                  opacity={activeNodeIds && !activeNodeIds.has(p.method.id) ? 0.3 : 1}
                  onClick={() => {
                    setSelectedNode(sel ? null : p.method.id);
                    setSelectedEdge(null);
                  }}
                >
                  <title>{`${p.profile.shortName}：${short}`}</title>
                  <rect
                    x={p.x - NODE_W / 2}
                    y={p.y - NODE_H / 2}
                    width={NODE_W}
                    height={NODE_H}
                    rx={13}
                    fill="var(--bg-2)"
                    stroke="var(--line-2)"
                    strokeWidth={1.4}
                  />
                  <text x={p.x - NODE_W / 2 + 15} y={p.y - NODE_H / 2 + 28} fontSize={17} fontWeight={660} fill="var(--fg)">
                    {p.profile.shortName}
                  </text>
                  {p.paper?.year && (
                    <text
                      x={p.x + NODE_W / 2 - 15}
                      y={p.y - NODE_H / 2 + 28}
                      fontSize={11.5}
                      textAnchor="end"
                      fill="var(--fg-3)"
                    >
                      {p.paper.year}
                    </text>
                  )}
                  {lines.map((line, li) => (
                    <text key={li} x={p.x - NODE_W / 2 + 15} y={p.y - NODE_H / 2 + 52 + li * 17} fontSize={12.5} fill="var(--fg-2)">
                      {line}
                    </text>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>

        {selectedRelation ? (
          <aside className="mapdetail" aria-label="关系详情">
            <div className="dh">
              <h3>方法联系</h3>
              <button className="x" onClick={() => setSelectedEdge(null)} aria-label="关闭">
                ✕
              </button>
            </div>

            {/* 1–4. 方法 A / 方法 B / 关系类型 / 证据状态 */}
            <div className="strength" style={{ marginTop: 0 }}>
              <div>
                <span className="k">方法 A：</span>
                {nameOf(selectedRelation.fromMethodId)}
              </div>
              <div>
                <span className="k">方法 B：</span>
                {nameOf(selectedRelation.toMethodId)}
              </div>
              <div>
                <span className="k">关系类型：</span>
                {RELATION_LABELS[selectedRelation.type]}
                {selectedRelation.userEdited ? '（人工修正）' : ''}
              </div>
              <div>
                <span className="k">方向：</span>
                {relationSentence(selectedRelation, selectedRelation.toMethodId, nameOf).text}
              </div>
            </div>

            <div className="sect">证据状态</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Status kind={STATE_KIND[selectedRelation.evidenceState]}>{STATE_TEXT[selectedRelation.evidenceState]}</Status>
              {selectedRelation.evidence ? <Status kind="ok">已通过全文定位校验</Status> : <Status kind="pending">无直接引文</Status>}
              {selectedRelation.userEdited && <Status kind="manual">人工修正</Status>}
            </div>
            {selectedRelation.evidenceState !== 'explicit' && (
              <p className="note">
                这句来自系统推断说明，不是论文原话。
                {selectedRelation.evidence
                  ? '下面的原文依据只用于核对方向与措辞，不能证明作者说过这句话。'
                  : '这条关系没有绑定可核验引文，请把它当作线索而不是结论。'}
              </p>
            )}

            {/* 5. 一句话解释 */}
            <div className="sect">一句话解释</div>
            <p className="answer">
              {firstSentence(selectedRelation.rationale ?? '', 110) ||
                relationSentence(selectedRelation, selectedRelation.toMethodId, nameOf).text}
            </p>

            {/* 6. 原文依据（默认折叠；没有引文时把说明摆在面上） */}
            <div className="sect">原文依据</div>
            {selectedRelation.evidence ? (
              <details className="fold" style={{ marginTop: 0 }}>
                <summary>展开原文引文与判断依据</summary>
                <div className="fold-body">
                  <p className="small dim" style={{ marginTop: 0 }}>
                    引文来自论文原文，并已回到全文做定位校验（系统不使用模型自报的置信度）。
                  </p>
                  <button className="btn sm" onClick={() => onOpenEvidence(selectedRelation.evidence!)}>
                    查看原文引文（p.{selectedRelation.evidence.page ?? '?'}）
                  </button>
                  <p className="small" style={{ marginTop: 10 }}>
                    <span className="k dim">证据来源：</span>
                    {(paperById.get(selectedRelation.evidence.paperId)?.title ?? selectedRelation.evidence.paperId).slice(0, 60)}
                    {' · '}p.{selectedRelation.evidence.page ?? '?'}
                    {' · '}
                    {selectedRelation.evidence.verified ? '全文定位成功' : '未通过定位校验，展示实际匹配位置'}
                  </p>
                  {selectedRelation.rationale && (
                    <p className="small" style={{ marginTop: 8 }}>
                      <span className="k dim">具体变化 / 为什么这样判断：</span>
                      {relationExplanation(selectedRelation)}
                    </p>
                  )}
                  <p className="small dim" style={{ marginTop: 8, marginBottom: 0 }}>
                    证据强度：{STATE_TEXT[selectedRelation.evidenceState]}（本项目不使用置信度百分比，只按「原文明示 / 系统推断 / 待核查」分三档）
                  </p>
                </div>
              </details>
            ) : (
              <p className="note">
                {selectedRelation.evidenceState === 'explicit'
                  ? '该关系标记为原文明示但缺少可打开的引文，请人工核对。'
                  : '没有绑定可核验引文，只作为推断或候选呈现。'}
              </p>
            )}

            {/* 下一步 */}
            <div className="sect">下一步</div>
            <div className="acts">
              <button
                className="btn primary sm"
                onClick={() => onOpenPair(selectedRelation.fromMethodId, selectedRelation.toMethodId)}
              >
                看这两个方法的完整对照 →
              </button>
              {visibleRelations.length > 1 && (
                <button
                  className="btn ghost sm"
                  onClick={() => {
                    const i = visibleRelations.findIndex((r) => r.id === selectedRelation.id);
                    const next = visibleRelations[(i + 1) % visibleRelations.length];
                    setSelectedEdge(next.id);
                  }}
                >
                  看下一条联系
                </button>
              )}
            </div>
          </aside>
        ) : nodeDetail ? (
          <aside className="mapdetail" aria-label="方法详情">
            <div className="dh">
              <h3>
                {nodeDetail.profile.shortName}
                <span className="yr" style={{ marginLeft: 8 }}>
                  {nodeDetail.paper?.year ?? ''}
                </span>
              </h3>
              <button className="x" onClick={() => setSelectedNode(null)} aria-label="关闭">
                ✕
              </button>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Status kind={nodeDetail.profile.family.confidence === 'pending' ? 'pending' : 'info'}>
                {nodeDetail.profile.family.name}
              </Status>
              {nodeDetail.profile.strategies.slice(0, 3).map((s) => (
                <span key={s.id} className="mtag neutral">
                  {s.name}
                </span>
              ))}
            </div>

            <div className="sect">一句话贡献</div>
            <p className="answer">{shortContribution(nodeDetail.profile.approach) || '未提取到（仍需确认）'}</p>

            <div className="sect">核心做法</div>
            <p>
              {nodeDetail.profile.approach
                ? nodeDetail.profile.approach.slice(0, 240) + (nodeDetail.profile.approach.length > 240 ? '…' : '')
                : '未提取到（仍需确认）'}
            </p>

            <div className="sect">与相关方法的联系</div>
            {relatedRelations.length ? (
              <ul>
                {relatedRelations.map((r) => (
                  <li key={r.id}>
                    <button
                      className="btn ghost sm"
                      style={{ padding: 0, textAlign: 'left' }}
                      onClick={() => {
                        setSelectedEdge(r.id);
                        setSelectedNode(null);
                      }}
                    >
                      {relationSentence(r, nodeDetail.method.id, nameOf).text}
                    </button>
                    <span className="dim">
                      （{STATE_TEXT[r.evidenceState]}
                      {r.evidence ? ' · 有引文' : ' · 无引文'}）
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dim">没有找到与其它方法的可核验关系，因此不给具体联系（不编造对照）。</p>
            )}

            <div className="sect">证据状态</div>
            {(() => {
              const basis = [
                { label: '研究任务', ev: nodeDetail.profile.problemBasis },
                { label: '核心思路', ev: nodeDetail.profile.contributionBasis },
                { label: '主要局限', ev: nodeDetail.profile.limitationsBasis },
              ].filter((x) => x.ev);
              const verified = basis.filter((x) => x.ev!.verified);
              return (
                <>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <Status kind={verified.length ? 'ok' : 'pending'}>
                      {verified.length ? `${verified.length} 个字段的引文已通过全文定位校验` : '没有字段通过定位校验'}
                    </Status>
                    <Status kind={nodeDetail.profile.family.confidence === 'evidence' ? 'ok' : 'pending'}>
                      家族判定：{nodeDetail.profile.family.confidence === 'evidence' ? '方法名称直接命中' : nodeDetail.profile.family.confidence === 'inferred' ? '系统按核心思路推断' : '证据不足，待确认'}
                    </Status>
                  </div>
                  {!verified.length && (
                    <p className="note">没有绑定可核验引文，只作为推断或候选呈现。</p>
                  )}
                </>
              );
            })()}

            <details className="fold" style={{ marginTop: 12 }}>
              <summary>原文依据</summary>
              <div className="fold-body">
                {nodeDetail.profile.problemBasis || nodeDetail.profile.contributionBasis || nodeDetail.profile.limitationsBasis ? (
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {nodeDetail.profile.problemBasis && (
                      <button className="btn ghost sm" onClick={() => onOpenEvidence(nodeDetail.profile.problemBasis!)}>
                        研究任务的原文（p.{nodeDetail.profile.problemBasis.page ?? '?'}）
                      </button>
                    )}
                    {nodeDetail.profile.contributionBasis && (
                      <button className="btn ghost sm" onClick={() => onOpenEvidence(nodeDetail.profile.contributionBasis!)}>
                        核心思路的原文（p.{nodeDetail.profile.contributionBasis.page ?? '?'}）
                      </button>
                    )}
                    {nodeDetail.profile.limitationsBasis && (
                      <button className="btn ghost sm" onClick={() => onOpenEvidence(nodeDetail.profile.limitationsBasis!)}>
                        局限的原文（p.{nodeDetail.profile.limitationsBasis.page ?? '?'}）
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="small dim" style={{ margin: 0 }}>
                    该篇没有定位到可核验原文片段，字段按「未提取到 / 待人工核对」呈现。
                  </p>
                )}

                <div className="sect">技术策略</div>
                <p className="small">
                  {nodeDetail.profile.strategies.map((s) => s.name).join('、') || '未识别到策略标签'}
                </p>
                <div className="sect">主要局限（论文自述）</div>
                <p className="small">
                  {nodeDetail.profile.limitations || '未在提供的片段中找到作者明确承认的局限（仍需确认）'}
                </p>
                <div className="sect">家族判定依据</div>
                <p className="small dim" style={{ margin: 0 }}>
                  {nodeDetail.profile.family.basis.length
                    ? nodeDetail.profile.family.basis.map((b) => `${b.source}「${b.keyword}」`).join('、')
                    : '无（因此标为待确认）'}
                  {nodeDetail.profile.family.note ? `；${nodeDetail.profile.family.note}` : ''}
                </p>
              </div>
            </details>

            <div className="sect">下一步</div>
            <div className="acts">
              {relatedRelations[0] && (
                <button
                  className="btn primary sm"
                  onClick={() =>
                    onOpenPair(
                      relatedRelations[0].fromMethodId === nodeDetail.method.id
                        ? relatedRelations[0].toMethodId
                        : relatedRelations[0].fromMethodId,
                      nodeDetail.method.id,
                    )
                  }
                >
                  与{' '}
                  {nameOf(
                    relatedRelations[0].fromMethodId === nodeDetail.method.id
                      ? relatedRelations[0].toMethodId
                      : relatedRelations[0].fromMethodId,
                  )}{' '}
                  的完整对照 →
                </button>
              )}
              {relatedRelations[0] && (
                <button className="btn ghost sm" onClick={() => setSelectedEdge(relatedRelations[0].id)}>
                  看第一条联系
                </button>
              )}
              <button
                className="btn ghost sm"
                onClick={() => onCompareExperiments(methods[0]?.id ?? '', nodeDetail.method.id)}
                disabled={methods.length < 2}
              >
                比较实验表现（次级）
              </button>
            </div>
          </aside>
        ) : null}
        </div>
        {/* 图例 */}
        <div className="maplegend">
          {(Object.keys(EDGE_STYLE) as RelationEvidenceState[]).map((s) => (
            <span key={s} className="k">
              <svg width="26" height="7" aria-hidden="true">
                <line
                  x1="1"
                  y1="3.5"
                  x2="25"
                  y2="3.5"
                  stroke={EDGE_STYLE[s].color}
                  strokeWidth={EDGE_STYLE[s].width}
                  strokeDasharray={EDGE_STYLE[s].dash}
                />
              </svg>
              {EDGE_STYLE[s].label}
            </span>
          ))}
          <span className="k dim">箭头方向 = 关系起始 → 指向</span>
        </div>

        {/* 缩放控件 */}
        <div className={`mapzoom${panelOpen ? ' withdetail' : ''}`}>
          <button className="z" onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.15).toFixed(2)))} aria-label="缩小">
            −
          </button>
          <span className="pct">{Math.round(zoom * 100)}%</span>
          <button className="z" onClick={() => setZoom((z) => Math.min(1.8, +(z + 0.15).toFixed(2)))} aria-label="放大">
            ＋
          </button>
          <button
            className="z"
            onClick={() => {
              setZoom(1);
              setSelectedNode(null);
              setSelectedEdge(null);
            }}
            title="恢复视图"
          >
            ⟳
          </button>
        </div>

        {/* 详情浮层：桌面右侧 / 窄屏底部；默认不打开，只有选中才出现 */}
      </div>

      {/* 未选中时的轻提示（不重复引导里的问题） */}
      {!selectedNode && !selectedEdge && (
        <div className="mapquest">
          <span className="q">提示</span>
          <span>点方法节点看它做了什么；点连线看两个方法的联系与证据状态。</span>
        </div>
      )}
    </div>
  );
}
