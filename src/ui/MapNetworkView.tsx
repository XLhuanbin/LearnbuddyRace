import React, { useMemo, useRef, useState } from 'react';
import type { Evidence, Method, Paper, Relation, RelationType } from '../core/types';
import { buildMethodProfile, shortContribution } from '../core/grouping';
import { DraftIcon } from '../draft-icons';
import { INNOVATION_TIERS, innovationColor } from './innovationScale';

interface Props {
  papers: Paper[];
  methods: Method[];
  relations: Relation[];
  /** 语料名（真实，来自 scope） */
  scopeLabel: string;
  onOpenEvidence: (ev: Evidence) => void;
  /** 打开该篇的分析结果页 */
  onOpenResult: (paperId: string) => void;
  /** 加入对比队列 */
  onAddToCompare: (paperId: string) => void;
  /** 切到「关系与比较」（草稿只给两个视图，这两个入口改放子头右侧） */
  onOpenRelations: () => void;
  /** 切到「阅读起点」 */
  onOpenStart: () => void;
  /** 切到「时间线」 */
  onOpenTimeline: () => void;
}

/** 关系类型 → 草稿的四类演进路径（线型 + 颜色双重区分，不只靠颜色） */
const PATH_STYLE: Record<string, { color: string; dash?: string; width: number; label: string }> = {
  extends: { color: '#10B981', width: 2, label: '基础架构演进' },
  improves: { color: '#FBBF24', dash: '7 5', width: 1.8, label: '参数优化' },
  combines: { color: '#3B82F6', width: 2, label: '融合创新' },
  similar: { color: '#A78BFA', dash: '2 4', width: 1.6, label: '应用扩展' },
  unclear: { color: '#9CA3AF', dash: '2 4', width: 1.4, label: '关系待核查' },
};

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * 研究地图（草稿 17763ea3 v3「方法演进逻辑重构」）—— **整屏不滚动**的网络视图。
 *
 * **外观按草稿逐元素复刻**：72px 子头（标题 + 计数 + 视图切换 + 搜索/筛选/导出）、
 * 主体左画布（SVG 网络 + 左下角图例 + 缩放按钮）、右侧 400px 常驻详情面板
 * （核心节点标签 + 创新度星级 → 双格数据 → 方法论核心 → 相关连接 → 底部两个按钮）。
 *
 * **只替换了与事实不符的内容**：
 *   - 「LLM 方法论演进地图」→ 真实语料名（我们是视觉方向，不是 LLM）
 *   - 「12 篇核心文献 • 34 条方法路径」→ 真实的篇数与关系数
 *   - 「引用频次 98,421」→ **换成真实可核验的「已核验字段 X/7」**（我们没有引用量数据，不编造）
 *   - 「方法复杂度 高 (Tier 1)」→ 真实的复杂度评估值（Tier 是草稿编造的分级，去掉）
 *   - 节点/连线的示例数据 → 我们语料里真实的方法与关系
 *
 * **为兼容的偏离**：草稿的 `h-screen` 包含它自己的顶栏；本项目顶栏是全站共享的，
 * 故这里用 `h-[calc(100vh-var(--topbar-h))]` 让开共享顶栏（草稿语义 = 占满可视区）。
 */
export function MapNetworkView({
  papers,
  methods,
  relations,
  scopeLabel,
  onOpenEvidence,
  onOpenResult,
  onAddToCompare,
  onOpenRelations,
  onOpenStart,
  onOpenTimeline,
}: Props) {
  const [selId, setSelId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scale, setScale] = useState(1);
  /** 图例可收起：默认展开（保持草稿的样子），嫌它挡画布时点标题即可收起 */
  const [legendOpen, setLegendOpen] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  /** 方法 → 短名 / 家族 / 创新度 / 复杂度（全部来自真实数据） */
  const profiles = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildMethodProfile> & { innovation?: number; complexity?: string }>();
    for (const m of methods) {
      const p = papers.find((x) => x.id === m.paperId);
      const prof = buildMethodProfile(m, p, papers);
      map.set(m.id, {
        ...prof,
        innovation: num(m.assessment?.innovation?.value),
        complexity: typeof m.assessment?.complexity?.value === 'string' ? m.assessment.complexity.value : undefined,
      });
    }
    return map;
  }, [methods, papers]);

  /** 布局：按关系深度分层（没有关系的排在最左），层内纵向均分 —— 确定性，不随机 */
  const { nodes, edges } = useMemo(() => {
    const ids = methods.map((m) => m.id);

    /**
     * ⚠️ 分层**只用「有方向」的关系**（extends / improves / combines）。
     *
     * 实测踩到的坑：similar / unclear 的 from→to 只是形式上的两端，界面也写着
     * 「相近/不明确的关系不声明方向」。若把它们也当成「谁在谁之后」，一旦关系覆盖变全
     * （每对方法都有边），5 个方法会被推成「5 层、每层 1 个」⇒ 全部落在同一条 y 上，
     * 画出来就是一条直线 —— 正是用户说的「简单线性」。
     * 只用有方向的边分层，横向关系就只画线、不参与定序，图才分得出层次与分支。
     */
    const DIRECTED: RelationType[] = ['extends', 'improves', 'combines'];
    const directed = relations.filter((r) => DIRECTED.includes(r.type));

    const depth = new Map<string, number>();
    for (const id of ids) depth.set(id, 0);
    // 最多迭代 ids.length 轮，避免关系成环时死循环
    for (let pass = 0; pass < ids.length; pass++) {
      let changed = false;
      for (const r of directed) {
        if (!depth.has(r.fromMethodId) || !depth.has(r.toMethodId)) continue;
        const d = (depth.get(r.fromMethodId) ?? 0) + 1;
        if (d > (depth.get(r.toMethodId) ?? 0)) {
          depth.set(r.toMethodId, d);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const byDepth = new Map<number, string[]>();
    for (const id of ids) {
      const d = depth.get(id) ?? 0;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(id);
    }
    const COL_GAP = 190;
    const ROW_GAP = 130;
    /**
     * ⚠️ 布局必须能应对「线性演进链」——这是实测踩到的坑：
     * 我们的视觉语料是 ResNet(2015) → ViT(2020) → DeiT(2020) → Swin(2021) → ConvNeXt(2022)
     * **一条链**，按关系深度分层会得到「5 层、每层 1 个节点」，y 坐标全相同 ⇒ 画出来是一条直线，
     * 完全看不出演进关系（草稿示例是分叉结构，所以没暴露这个问题）。
     * 因此分两种情况：
     *   - 有分叉（任一层 >1 个节点，或任一节点出度 >1）→ 用深度分层，能体现分支；
     *   - 纯链 → **按年份升序排、y 上下交错（之字形）**，读起来是一条有节奏的演进时间线。
     */
    // 「是否分叉」只看有没有哪一层装了不止一个节点；出度大不构成分叉（那是辐辏，不是分层）
    const maxLayer = Math.max(0, ...[...byDepth.values()].map((l) => l.length));
    const hasBranch = maxLayer > 1;

    const placed = new Map<string, { x: number; y: number; r: number }>();
    const degOf = (id: string) => relations.filter((r) => r.fromMethodId === id || r.toMethodId === id).length;
    const radiusOf = (id: string) => 13 + Math.min(degOf(id), 5) * 2;
    const yearOf = (id: string) => {
      const m = methods.find((x) => x.id === id);
      return papers.find((p) => p.id === m?.paperId)?.year ?? 9999;
    };

    if (hasBranch) {
      for (const [d, list] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
        const h = (list.length - 1) * ROW_GAP;
        // 同一层内按年份升序，读起来是从上到下的时间顺序（不按输入顺序，避免看起来随机）
        [...list]
          .sort((a, b) => yearOf(a) - yearOf(b))
          .forEach((id, i) => {
            placed.set(id, { x: 120 + d * COL_GAP, y: 380 - h / 2 + i * ROW_GAP, r: radiusOf(id) });
          });
      }
    } else {
      // 纯链：按年份升序，y 上下交错
      const AMP = 85;
      [...ids]
        .sort((a, b) => yearOf(a) - yearOf(b))
        .forEach((id, i) => {
          placed.set(id, { x: 120 + i * COL_GAP, y: 380 + (i % 2 === 0 ? -AMP : AMP), r: radiusOf(id) });
        });
    }
    const nodeList = ids
      .filter((id) => placed.has(id))
      .map((id) => {
        const prof = profiles.get(id);
        return {
          id,
          x: placed.get(id)!.x,
          y: placed.get(id)!.y,
          r: placed.get(id)!.r,
          name: prof?.shortName ?? '未命名',
          paperId: prof?.paperId,
          innovation: prof?.innovation,
          color: innovationColor(prof?.innovation),
        };
      });
    const edgeList = relations
      .filter((r) => placed.has(r.fromMethodId) && placed.has(r.toMethodId))
      .map((r) => ({ id: r.id, type: r.type, from: placed.get(r.fromMethodId)!, to: placed.get(r.toMethodId)! }));
    return { nodes: nodeList, edges: edgeList };
  }, [methods, relations, profiles]);

  const q = query.trim().toLowerCase();
  const dimmed = useMemo(() => {
    if (!q) return new Set<string>();
    const hit = new Set(nodes.filter((n) => n.name.toLowerCase().includes(q)).map((n) => n.id));
    return new Set(nodes.filter((n) => !hit.has(n.id)).map((n) => n.id));
  }, [q, nodes]);

  const sel = selId ? nodes.find((n) => n.id === selId) : undefined;
  const selMethod = selId ? methods.find((m) => m.id === selId) : undefined;
  const selPaper = sel ? papers.find((p) => p.id === sel.paperId) : undefined;
  const selProfile = selId ? profiles.get(selId) : undefined;

  /** 已核验字段数（真实统计，用来替掉草稿的「引用频次」） */
  const verifiedFields = useMemo(() => {
    if (!selMethod) return { verified: 0, total: 7 };
    const keys = Object.keys(selMethod.fields) as (keyof typeof selMethod.fields)[];
    return {
      verified: keys.filter((k) => selMethod.fields[k]?.evidence?.verified).length,
      total: keys.length,
    };
  }, [selMethod]);

  const related = useMemo(
    () => (selId ? relations.filter((r) => r.fromMethodId === selId || r.toMethodId === selId) : []),
    [relations, selId],
  );

  /** 导出图片：把画布 SVG 序列化成 PNG（真实功能，不是占位） */
  const exportImage = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const vb = svg.viewBox.baseVal;
    clone.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    clone.setAttribute('width', String(vb.width));
    clone.setAttribute('height', String(vb.height));
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', String(vb.x));
    bg.setAttribute('y', String(vb.y));
    bg.setAttribute('width', String(vb.width));
    bg.setAttribute('height', String(vb.height));
    bg.setAttribute('fill', '#F5F7F8');
    clone.insertBefore(bg, clone.firstChild);
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = vb.width;
      canvas.height = vb.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `${scopeLabel}-研究地图.png`;
      a.click();
    };
    img.src = src;
  };

  return (
    <div className="mapnet sdpage">
      {/* ---------- 子头（72px） ---------- */}
      <div className="h-[72px] shrink-0 bg-white border-b border-[var(--line)] px-6 flex justify-between items-center gap-4">
        <div className="flex items-center gap-6 min-w-0">
          <div className="min-w-0">
            <h2 className="text-lg font-serif font-bold truncate">{scopeLabel} · 方法论演进地图</h2>
            <p className="text-[10px] text-[var(--fg-3)] uppercase tracking-widest">
              已包含 {papers.length} 篇文献 • {relations.length} 条方法路径
            </p>
          </div>
          <div className="h-8 w-px bg-[var(--line)] shrink-0" />
          <div className="flex items-center gap-2 shrink-0">
            <button className="btn-outline flex items-center gap-1.5 active">
              <DraftIcon name="network" />
              网络视图
            </button>
            <button className="btn-outline flex items-center gap-1.5" onClick={onOpenTimeline}>
              <DraftIcon name="git-branch" />
              时间线
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative">
            <DraftIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-3)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索论文或方法..."
              className="pl-10 pr-4 py-2 bg-[var(--bg)] border border-[var(--line)] rounded-lg text-sm w-64 focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          {/* 草稿的「筛选」是模态筛选器；我们这里没有等价功能，改为**真实可用的**两个次级视图入口 */}
          <button className="btn-outline flex items-center gap-1.5" onClick={onOpenRelations}>
            <DraftIcon name="filter" />
            关系与比较
          </button>
          <button className="btn-primary flex items-center gap-1.5" onClick={exportImage}>
            <DraftIcon name="download" />
            导出图片
          </button>
        </div>
      </div>

      {/* ---------- 主体 ---------- */}
      <div className="flex-1 flex overflow-hidden">
        {/* 画布 */}
        <div className="flex-1 relative overflow-hidden map-canvas-container" id="map-canvas">
          {/* block 是必须的：局部 preflight 会把 svg 设成 inline-block，会让底部出现基线空隙 */}
          <svg ref={svgRef} className="w-full h-full block" viewBox="0 0 1100 760">
            <defs>
              {Object.entries(PATH_STYLE).map(([k, s]) => (
                <marker
                  key={k}
                  id={`arrow-${k}`}
                  viewBox="0 0 10 10"
                  refX="18"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={s.color} />
                </marker>
              ))}
            </defs>
            <g transform={`translate(550 380) scale(${scale}) translate(-550 -380)`}>
              {/* 连线 */}
              {edges.map((e) => {
                const s = PATH_STYLE[e.type] ?? PATH_STYLE.unclear;
                /**
                 * 只有「有方向」的关系类型才画箭头。
                 * similar / unclear 的 from→to 只是形式上的两端（模型必须填两个端点），
                 * 图例也写了「相近/不明确的关系不声明方向」——给它们画箭头等于凭空声明了一个方向。
                 */
                const directional = e.type === 'extends' || e.type === 'improves' || e.type === 'combines';
                return (
                  <line
                    key={e.id}
                    x1={e.from.x}
                    y1={e.from.y}
                    x2={e.to.x}
                    y2={e.to.y}
                    stroke={s.color}
                    strokeWidth={s.width}
                    strokeDasharray={s.dash}
                    markerEnd={directional ? `url(#arrow-${e.type})` : undefined}
                    opacity={dimmed.size ? 0.15 : 0.9}
                  />
                );
              })}
              {/* 节点 */}
              {nodes.map((n) => (
                <g
                  key={n.id}
                  className="cursor-pointer"
                  opacity={dimmed.has(n.id) ? 0.2 : 1}
                  onClick={() => setSelId(n.id)}
                >
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r}
                    fill={n.color}
                    stroke={selId === n.id ? 'var(--accent)' : '#ffffff'}
                    strokeWidth={selId === n.id ? 3 : 2}
                  />
                  <text x={n.x} y={n.y + n.r + 18} textAnchor="middle" className="fill-[var(--fg)]" style={{ fontSize: 12, fontWeight: 600 }}>
                    {n.name}
                  </text>
                </g>
              ))}
            </g>
          </svg>

          {/* 图例（左下） */}
          <div className="absolute bottom-8 left-8">
            <div className="bg-white/80 backdrop-blur-md p-4 rounded-xl border border-[var(--line)] shadow-lg">
              <button className="flex items-center justify-between w-full gap-3" onClick={() => setLegendOpen((v) => !v)}>
                <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--fg-3)]">图例说明</h4>
                <DraftIcon name={legendOpen ? 'chevron-down' : 'chevron-right'} />
              </button>
              {legendOpen && (
              <div className="space-y-2 mt-3">
                {INNOVATION_TIERS.map((t) => (
                  <div key={t.label} className="flex items-center gap-3 text-xs text-[var(--fg-2)]">
                    <span className="w-3 h-3 rounded-full" style={{ background: t.color }} />
                    <span>{t.label}</span>
                  </div>
                ))}
                <div className="mt-3 pt-3 border-t border-[var(--line)] space-y-2 text-[10px] text-[var(--fg-3)]">
                  <span>方法演进路径（由真实关系数据得出）：</span>
                  {Object.entries(PATH_STYLE).map(([k, s]) => (
                    <div key={k} className="flex items-center gap-3 text-xs text-[var(--fg-2)]">
                      <span
                        className="w-6"
                        style={{
                          height: 0,
                          borderBottom: `${s.dash ? '2px dashed' : '2px solid'} ${s.color}`,
                        }}
                      />
                      <span>{s.label}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--fg-3)] pt-2 border-t border-[var(--line)]">
                  ⚠️ 创新度是模型评估（不是论文给出的分数），灰色节点表示本篇还没有评估结果。
                </p>
              </div>
              )}
            </div>
          </div>

          {/* 缩放 */}
          <div className="absolute bottom-8 right-8 flex gap-2">
            <button
              className="w-10 h-10 bg-white border border-[var(--line)] rounded-lg flex items-center justify-center shadow-sm hover:bg-[var(--bg-3)]"
              onClick={() => setScale((s) => Math.min(2, +(s + 0.2).toFixed(2)))}
            >
              <DraftIcon name="zoom-in" />
            </button>
            <button
              className="w-10 h-10 bg-white border border-[var(--line)] rounded-lg flex items-center justify-center shadow-sm hover:bg-[var(--bg-3)]"
              onClick={() => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(2)))}
            >
              <DraftIcon name="zoom-out" />
            </button>
            <button
              className="w-10 h-10 bg-white border border-[var(--line)] rounded-lg flex items-center justify-center shadow-sm hover:bg-[var(--bg-3)]"
              onClick={() => setScale(1)}
            >
              <DraftIcon name="maximize" />
            </button>
          </div>
        </div>

        {/* 右侧详情面板（400px 常驻） */}
        <aside className="w-[400px] shrink-0 bg-white border-l border-[var(--line)] flex flex-col">
          <div className="p-8 info-panel overflow-y-auto flex-1">
            {!sel ? (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                <DraftIcon name="mouse-pointer-2" className="text-5xl mb-4" />
                <p className="text-sm">
                  点击地图中的节点查看
                  <br />
                  论文详细方法论关系
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="tag-pill bg-[var(--accent-soft)] text-[var(--accent)]">核心节点</span>
                    <div className="flex items-center gap-1 text-[var(--accent)] font-bold">
                      <DraftIcon name="star" />
                      <span>{typeof sel.innovation === 'number' ? sel.innovation : '—'}</span>
                    </div>
                  </div>
                  <h3 className="text-2xl font-serif font-bold leading-tight mb-2">{selPaper?.title ?? sel.name}</h3>
                  <p className="text-sm text-[var(--fg-3)] font-medium">
                    {[sel.name, selPaper?.year ?? '年份未知', selPaper?.source?.url ? 'arXiv' : ''].filter(Boolean).join(' • ')}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[var(--bg)] p-4 rounded-xl">
                    <p className="text-[10px] text-[var(--fg-3)] uppercase font-bold mb-1">已核验字段</p>
                    <p className="text-xl font-serif font-bold">
                      {verifiedFields.verified}
                      <span className="text-sm text-[var(--fg-3)]"> / {verifiedFields.total}</span>
                    </p>
                  </div>
                  <div className="bg-[var(--bg)] p-4 rounded-xl">
                    <p className="text-[10px] text-[var(--fg-3)] uppercase font-bold mb-1">方法复杂度</p>
                    <p className="text-xl font-serif font-bold">{selProfile?.complexity ?? '—'}</p>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-black uppercase tracking-widest text-[var(--fg-3)] mb-4">方法论核心</h4>
                  <div className="bg-[var(--bg-2)] border border-[var(--line)] p-4 rounded-xl text-sm leading-relaxed">
                    <p>{selMethod ? shortContribution(selMethod.fields.coreIdea?.value ?? '') || '未提取到核心思路' : ''}</p>
                  </div>
                  {selMethod?.fields.coreIdea?.evidence && (
                    <button
                      className="text-link text-xs mt-2"
                      onClick={() => onOpenEvidence(selMethod.fields.coreIdea!.evidence!)}
                    >
                      查看原文依据（p.{selMethod.fields.coreIdea.evidence.page ?? '?'}）
                    </button>
                  )}
                </div>

                <div>
                  <h4 className="text-xs font-black uppercase tracking-widest text-[var(--fg-3)] mb-4">相关连接</h4>
                  <div className="space-y-3">
                    {related.length ? (
                      related.map((r) => {
                        const otherId = r.fromMethodId === selId ? r.toMethodId : r.fromMethodId;
                        const other = nodes.find((n) => n.id === otherId);
                        const s = PATH_STYLE[r.type] ?? PATH_STYLE.unclear;
                        return (
                          <div
                            key={r.id}
                            className="flex items-center justify-between p-3 border border-[var(--line)] rounded-lg hover:bg-[var(--bg)] cursor-pointer transition-colors"
                            onClick={() => setSelId(otherId)}
                          >
                            <div>
                              <p className="text-xs font-bold">{other?.name ?? '未知方法'}</p>
                              <p className="text-[10px] text-[var(--fg-3)] uppercase">
                                {s.label} / {r.evidenceState === 'explicit' ? '原文明示' : r.evidenceState === 'inferred' ? '系统推断' : '待核查'}
                              </p>
                            </div>
                            <DraftIcon name="chevron-right" />
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-xs text-[var(--fg-3)]">这篇论文在当前集合里还没有与其它方法建立关系。</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-[var(--line)] bg-[var(--bg-2)] shrink-0">
            <button className="w-full btn-primary mb-3" disabled={!sel} onClick={() => sel && onOpenResult(sel.paperId!)}>
              查看完整分析报告
            </button>
            {/* 草稿这里是「添加到对比队列」；我们已有真实的「关系与比较 / 阅读起点」，如实接过去 */}
            <button className="w-full btn-outline" disabled={!sel} onClick={() => sel && onAddToCompare(sel.paperId!)}>
              加入对比队列
            </button>
            <div className="flex gap-2 mt-3">
              <button className="btn-outline flex-1 text-xs" onClick={onOpenRelations}>
                关系与比较
              </button>
              <button className="btn-outline flex-1 text-xs" onClick={onOpenStart}>
                阅读起点
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
