import React, { useMemo, useState } from 'react';
import type { Evidence, Method, Paper, Relation, RelationEvidenceState } from '../core/types';
import { buildMethodProfile, relationExplanation, relationSentence, shortContribution, type MethodProfile } from '../core/grouping';
import { Status } from './common';

interface Props {
  papers: Paper[];
  methods: Method[];
  relations: Relation[];
  onOpenEvidence: (ev: Evidence) => void;
  /** 选中两个方法后，进入次级入口做实验表现比较 */
  onCompareExperiments: (a: string, b: string) => void;
  /** 显示选项（由工作区的「选项」弹层控制，避免工具栏堆开关） */
  showPending: boolean;
  showUnclear: boolean;
  /** 打开两个方法的完整对照（当前 MapView 会传；旧版本没有） */
  onOpenPair?: (a: string, b: string) => void;
  /** 只看有证据的关系（同上） */
  onlyEvidence?: boolean;
}

/** 线型 + 颜色双重区分（不只靠颜色） */
const EDGE_STYLE: Record<RelationEvidenceState, { color: string; dash?: string; width: number; label: string }> = {
  explicit: { color: '#2f6b4a', width: 2, label: '原文明示' },
  inferred: { color: '#be6a1e', dash: '8 5', width: 1.9, label: '系统推断' },
  candidate: { color: '#8a8378', dash: '2 5', width: 1.7, label: '待核查' },
};

const LANE_ORDER: MethodProfile['family']['id'][] = ['cnn', 'transformer', 'hybrid', 'pending'];
const NODE_W = 208;
const NODE_H = 78;
const LANE_GAP = 118;
const PAD = 26;
const HEADER = 40;

interface Placed {
  profile: MethodProfile;
  method: Method;
  paper?: Paper;
  x: number;
  y: number;
  lane: number;
}

/**
 * 探索画布：泳道 = 方法家族（轻量分区），节点 = 短名称 + 一条短贡献，
 * 连线只画真实关系；标签默认不铺开，悬停/聚焦/选中时才出现。
 */
export function MethodMap({ papers, methods, relations, onOpenEvidence, onCompareExperiments, showPending, showUnclear, onOpenPair, onlyEvidence = false }: Props) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const profiles = useMemo(
    () => methods.map((m) => buildMethodProfile(m, paperById.get(m.paperId), papers)),
    [methods, paperById, papers],
  );
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.methodId, p])), [profiles]);
  const nameOf = (methodId: string) => profileById.get(methodId)?.shortName ?? methodId;

  const unclearRelations = useMemo(() => relations.filter((r) => r.type === 'unclear'), [relations]);
  const visibleRelations = useMemo(
    () =>
      relations
        .filter((r) => (showUnclear ? true : r.type !== 'unclear'))
        .filter((r) => (showPending ? true : r.evidenceState !== 'candidate'))
        .filter((r) => (onlyEvidence ? !!r.evidence : true)),
    [relations, showPending, showUnclear, onlyEvidence],
  );

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
            y: HEADER + 22 + i * (NODE_H + 18) + NODE_H / 2,
            lane: laneMeta.length - 1,
          });
        });
      x += NODE_W + LANE_GAP;
    });

    return {
      placed: placedNodes,
      lanes: laneMeta,
      width: Math.max(540, x - LANE_GAP + PAD + 140),
      height: HEADER + 22 + maxRows * (NODE_H + 18) + 14,
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

  const selectedRelation = selectedEdge ? visibleRelations.find((r) => r.id === selectedEdge) ?? null : null;
  const nodeDetail = selectedNode ? nodeById.get(selectedNode) : null;
  const relatedRelations = selectedNode
    ? visibleRelations.filter((r) => r.fromMethodId === selectedNode || r.toMethodId === selectedNode)
    : [];

  if (!methods.length) {
    return <div className="card">这组论文还没有方法分析结果，无法绘制地图。</div>;
  }

  return (
    <div className="mapwork">
      <div className="mapstage">
        <svg viewBox={`0 0 ${width} ${height}`} width={width * zoom} height={height * zoom} role="img" aria-label="方法地图">
          <defs>
            {(Object.keys(EDGE_STYLE) as RelationEvidenceState[]).map((s) => (
              <marker key={s} id={`mm-arrow-${s}`} markerWidth="9" markerHeight="7" refX="7" refY="3.5" orient="auto">
                <path d="M0,0 L0,7 L8,3.5 z" fill={EDGE_STYLE[s].color} />
              </marker>
            ))}
          </defs>

          {/* 泳道：轻量分区（柔和底色 + 小标题，不再是大盒子） */}
          {lanes.map((l) => (
            <g key={l.id}>
              <rect x={l.x - 6} y={10} width={NODE_W + 12} height={height - 24} rx={12} fill="var(--bg-2)" />
              <text x={l.x + 6} y={31} fontSize={12} fontWeight={600} fill="var(--fg-3)">
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
            const gapX = sameLane ? Math.max(x1, x2) + 42 + (idx % 3) * 18 : (x1 + x2) / 2 + ((idx % 3) - 1) * 12;
            const d = `M ${x1} ${y1} C ${gapX} ${y1} ${gapX} ${y2} ${x2} ${y2}`;
            const isSel = selectedEdge === r.id;
            const isHover = hoverEdge === r.id;
            const showLabel = isSel || isHover;
            const incident = activeNodeIds ? activeNodeIds.has(r.fromMethodId) && activeNodeIds.has(r.toMethodId) : false;
            const opacity = selectedEdge || selectedNode ? (isSel || incident ? 1 : 0.13) : 1;
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
                className="medge"
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
                <title>{`${label}（${EDGE_STYLE[r.evidenceState].label}）`}</title>
                <path
                  className="line"
                  d={d}
                  fill="none"
                  stroke={st.color}
                  strokeWidth={isSel ? st.width + 1.2 : st.width}
                  strokeDasharray={st.dash}
                  markerEnd={`url(#mm-arrow-${r.evidenceState})`}
                  opacity={opacity}
                />
                <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
                {showLabel && (
                  <g>
                    <rect
                      x={labelX - label.length * 3.4 - 7}
                      y={labelY - 15}
                      width={label.length * 6.8 + 14}
                      height={18}
                      rx={5}
                      fill="var(--bg)"
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

          {/* 节点：短名称 + 弱化年份 + 一条短贡献 */}
          {placed.map((p) => {
            const sel = selectedNode === p.method.id;
            const near = activeNodeIds ? activeNodeIds.has(p.method.id) && !sel : false;
            const short = shortContribution(p.profile.approach) || '未提取到核心思路';
            const lines = short.match(/.{1,18}/g)?.slice(0, 2) ?? [];
            return (
              <g
                key={p.method.id}
                className={`mnode${sel ? ' sel' : near ? ' near' : ''}`}
                tabIndex={0}
                opacity={activeNodeIds && !activeNodeIds.has(p.method.id) ? 0.28 : 1}
                onClick={() => {
                  setSelectedNode(sel ? null : p.method.id);
                  setSelectedEdge(null);
                }}
              >
                <title>{`${p.profile.shortName}：${short}`}</title>
                <rect x={p.x - NODE_W / 2} y={p.y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={12} fill="var(--bg)" stroke="var(--line-2)" strokeWidth={1.3} />
                <text x={p.x - NODE_W / 2 + 14} y={p.y - NODE_H / 2 + 24} fontSize={14} fontWeight={650} fill="var(--fg)">
                  {p.profile.shortName}
                </text>
                {p.paper?.year && (
                  <text x={p.x + NODE_W / 2 - 14} y={p.y - NODE_H / 2 + 24} fontSize={10.5} textAnchor="end" fill="var(--fg-3)">
                    {p.paper.year}
                  </text>
                )}
                {lines.map((line, li) => (
                  <text key={li} x={p.x - NODE_W / 2 + 14} y={p.y - NODE_H / 2 + 45 + li * 15} fontSize={11} fill="var(--fg-2)">
                    {line}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {/* 一句轻提示（选中后消失） */}
      {!selectedNode && !selectedEdge && (
        <div className="maphint">点击一个方法看它做了什么；点击连线看两个方法的联系。</div>
      )}

      {/* 图例（简短一行） */}
      <div className="maplegend">
        {(Object.keys(EDGE_STYLE) as RelationEvidenceState[]).map((s) => (
          <span key={s} className="k">
            <svg width="26" height="7" aria-hidden="true">
              <line x1="1" y1="3.5" x2="25" y2="3.5" stroke={EDGE_STYLE[s].color} strokeWidth={EDGE_STYLE[s].width} strokeDasharray={EDGE_STYLE[s].dash} />
            </svg>
            {EDGE_STYLE[s].label}
          </span>
        ))}
      </div>

      {/* 缩放控件 */}
      <div className="mapzoom">
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

      {/* 详情浮层：桌面右侧 / 窄屏底部；点开即在可见区域 */}
      <aside className={`mapdetail${selectedRelation || nodeDetail ? ' open' : ''}`} aria-hidden={!(selectedRelation || nodeDetail)} aria-label="方法联系与方法详情">
      {selectedRelation ? (
        <>
          <div className="dh">
            <h3>方法联系</h3>
            <button className="x" onClick={() => setSelectedEdge(null)} aria-label="关闭">
              ✕
            </button>
          </div>
          <p style={{ fontWeight: 600 }}>
            {relationSentence(selectedRelation, selectedRelation.toMethodId, nameOf).text}
          </p>
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Status kind={selectedRelation.evidenceState === 'explicit' ? 'ok' : selectedRelation.evidenceState === 'inferred' ? 'info' : 'pending'}>
              {selectedRelation.evidenceState === 'explicit' ? '原文已说明' : selectedRelation.evidenceState === 'inferred' ? '系统推断' : '待核查'}
            </Status>
            {selectedRelation.userEdited && <Status kind="manual">人工修正</Status>}
          </div>
          <div className="sect">具体联系 / 变化</div>
          <p>{relationExplanation(selectedRelation)}</p>
          <details className="fold" style={{ marginTop: 10 }}>
            <summary>原文依据</summary>
            <div className="fold-body">
              {selectedRelation.evidence ? (
                <button className="btn sm" onClick={() => onOpenEvidence(selectedRelation.evidence!)}>
                  查看原文引文（p.{selectedRelation.evidence.page ?? '?'}）
                </button>
              ) : (
                <p className="small dim" style={{ margin: 0 }}>
                  {selectedRelation.evidenceState === 'explicit'
                    ? '该关系标记为原文明示但缺少可打开的引文，请人工核对。'
                    : '这条关系没有绑定可核验引文，因此只作为推断 / 候选呈现。'}
                </p>
              )}
            </div>
          </details>
        </>
      ) : nodeDetail ? (
        <>
          <div className="dh">
            <h3>
              {nodeDetail.profile.shortName}
              <span className="small dim" style={{ marginLeft: 8, fontWeight: 400 }}>
                {nodeDetail.paper?.year ?? ''}
              </span>
            </h3>
            <button className="x" onClick={() => setSelectedNode(null)} aria-label="关闭">
              ✕
            </button>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Status kind={nodeDetail.profile.family.confidence === 'pending' ? 'pending' : 'info'}>{nodeDetail.profile.family.name}</Status>
          </div>

          <div className="sect">一句话贡献</div>
          <p>{shortContribution(nodeDetail.profile.approach) || '未提取到（仍需确认）'}</p>

          <details className="fold">
            <summary>查看核心做法 · 局限 · 原文依据</summary>
            <div className="fold-body">
          <div className="sect">核心做法</div>
          <p>
            {nodeDetail.profile.approach
              ? nodeDetail.profile.approach.slice(0, 220) + (nodeDetail.profile.approach.length > 220 ? '…' : '')
              : '未提取到（仍需确认）'}
          </p>

          <div className="sect">与相关方法的联系</div>
          {relatedRelations.length ? (
            <ul>
              {relatedRelations.map((r) => (
                <li key={r.id}>
                  {relationSentence(r, nodeDetail.method.id, nameOf).text}
                  <span className="dim">
                    （{r.evidenceState === 'explicit' ? '原文已说明' : r.evidenceState === 'inferred' ? '系统推断' : '待核查'}）
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dim">没有找到与其它方法的可核验关系，因此不给具体联系（不编造对照）。</p>
          )}

          <details className="fold" style={{ marginTop: 12 }}>
            <summary>深入解释与原文依据</summary>
            <div className="fold-body">
              {nodeDetail.profile.strategies.length > 0 && (
                <>
                  <div className="sect">技术策略</div>
                  <p>{nodeDetail.profile.strategies.map((s) => s.name).join('、')}</p>
                </>
              )}
              <div className="sect">主要局限（论文自述）</div>
              <p>{nodeDetail.profile.limitations || '未在提供的片段中找到作者明确承认的局限（仍需确认）'}</p>
              <div className="sect">原文依据</div>
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
                {!nodeDetail.profile.problemBasis && !nodeDetail.profile.contributionBasis && (
                  <span className="small dim">该篇没有定位到可核验原文片段，字段按「未提取到 / 待人工核对」呈现。</span>
                )}
              </div>
              <p className="small dim" style={{ marginTop: 10, marginBottom: 0 }}>
                家族判定依据：
                {nodeDetail.profile.family.basis.length
                  ? nodeDetail.profile.family.basis.map((b) => `${b.source}「${b.keyword}」`).join('、')
                  : '无（因此标为待确认）'}
                {nodeDetail.profile.family.note ? `；${nodeDetail.profile.family.note}` : ''}
              </p>
            </div>
          </details>

          <div className="acts">
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
            </div>
          </details>
        </>
      ) : null}
      </aside>
    </div>
  );
}
