import React, { useEffect, useMemo, useState } from 'react';
import type { Method, Paper, Relation } from '../core/types';
import { buildMethodProfile, firstSentence } from '../core/grouping';

interface Props {
  onExperienceCase: () => void;
  onUploadOwn: () => void;
  /** 首页三个区块各自的入口（与左侧导航同名同义） */
  onGo: (tab: 'library' | 'upload' | 'map' | 'experiments' | 'decision') => void;
}

interface Node {
  name: string;
  year?: number;
  family: string;
  pending: boolean;
}
interface Edge {
  from: string;
  to: string;
  state: string;
  hasEvidence: boolean;
}
interface Facts {
  families: { name: string; count: number; pending: boolean }[];
  /** 按发表年份排序的真实方法节点（研究顺序） */
  nodes: Node[];
  /** 默认可见的真实关系（「关系不明确」与待核查不计入） */
  edges: Edge[];
  /** 每篇论文的短名 / 方法族 / 一句作用 */
  papers: { name: string; family: string; role: string }[];
  /** 示例路线前三步 */
  route: { name: string; focus: string }[];
  relationTotal: number;
}

const STATE_LABEL: Record<string, string> = { explicit: '原文已说明', inferred: '系统推断', candidate: '待核查' };

/** 只读预置视觉案例；取不到就返回 null，页面退回不声称具体数字的占位 */
function buildFacts(idx: {
  papers: Paper[];
  methods: Method[];
  relations: Relation[];
  decisionSample?: { steps?: { paperId: string; focus?: string }[] };
}): Facts {
  const papers = idx.papers ?? [];
  const methods = idx.methods ?? [];
  const profiles = methods.map((m) => buildMethodProfile(m, papers.find((p) => p.id === m.paperId), papers));
  const nameOf = (id: string) => profiles.find((p) => p.methodId === id)?.shortName ?? id;

  const byFamily = new Map<string, { name: string; count: number; pending: boolean }>();
  for (const p of profiles) {
    const key = p.family.id;
    if (!byFamily.has(key)) byFamily.set(key, { name: p.family.name, count: 0, pending: p.family.confidence === 'pending' });
    byFamily.get(key)!.count += 1;
  }
  const families = [...byFamily.values()].sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || b.count - a.count);

  const nodes: Node[] = profiles
    .map((p) => ({
      name: p.shortName,
      year: papers.find((x) => x.id === p.paperId)?.year,
      family: p.family.name,
      pending: p.family.confidence === 'pending',
    }))
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.name.localeCompare(b.name));

  const edges: Edge[] = (idx.relations ?? [])
    .filter((r) => r.type !== 'unclear' && r.evidenceState !== 'candidate')
    .map((r) => ({
      from: nameOf(r.fromMethodId),
      to: nameOf(r.toMethodId),
      state: STATE_LABEL[r.evidenceState] ?? r.evidenceState,
      hasEvidence: Boolean(r.evidence),
    }));

  const paperRows = papers
    .map((p) => {
      const prof = profiles.find((x) => x.paperId === p.id);
      if (!prof) return null;
      return {
        name: prof.shortName,
        family: prof.family.name,
        role: prof.approach ? firstSentence(prof.approach, 44).trim() : '',
      };
    })
    .filter(Boolean) as Facts['papers'];

  const steps = idx.decisionSample?.steps ?? [];
  const route = steps
    .slice(0, 3)
    .map((st) => {
      const m = methods.find((x) => x.paperId === st.paperId);
      const prof = m ? profiles.find((p) => p.methodId === m.id) : undefined;
      const focus = firstSentence(st.focus ?? '', 26).replace(/^重点看[:：]?/, '').trim();
      return { name: prof?.shortName ?? '', focus };
    })
    .filter((x) => x.name);

  return { families, nodes, edges, papers: paperRows, route, relationTotal: (idx.relations ?? []).length };
}

const d = (ms: number) => ({ ['--d' as never]: `${ms}ms` }) as React.CSSProperties;

/* ------------------------------------------------------------------ *
 * 首屏右侧：当前案例的真实研究地图切片
 * 真实的两个方法族 + 真实方法节点（按发表年份 = 研究顺序）+ 默认可见的真实关系；
 * 不生成任何假线；关系用 620ms 绘制一次（首页唯一的关系动效）。
 * 宽屏横向分栏、窄屏纵向分栏，保证节点文字始终是可读字号。
 * ------------------------------------------------------------------ */

interface Placed {
  node: Node;
  x: number;
  y: number;
  w: number;
  h: number;
}

function layoutMap(
  nodes: Node[],
  lanes: { name: string; count: number }[],
  dir: 'row' | 'col',
): { placed: Placed[]; bands: { name: string; x: number; y: number; w: number; h: number }[]; W: number; H: number } {
  const pad = 12;
  const gap = dir === 'row' ? 24 : 18;
  const nodeW = dir === 'row' ? 126 : 232;
  const nodeH = 48;
  const gapX = 12;
  const labelH = 20;
  const bands: { name: string; x: number; y: number; w: number; h: number }[] = [];
  const placed: Placed[] = [];

  if (dir === 'row') {
    const W = pad * 2 + nodeW * 3 + gapX * 2;
    const laneH = labelH + nodeH + 32;
    const H = pad * 2 + lanes.length * laneH + (lanes.length - 1) * gap;
    lanes.forEach((lane, li) => {
      const y = pad + li * (laneH + gap);
      bands.push({ name: lane.name, x: pad, y, w: W - pad * 2, h: laneH });
      nodes
        .filter((n) => n.family === lane.name)
        .forEach((n, ni) => {
          placed.push({
            node: n,
            x: pad + 12 + ni * (nodeW + gapX) + nodeW / 2,
            y: y + labelH + 6 + nodeH / 2,
            w: nodeW,
            h: nodeH,
          });
        });
    });
    return { placed, bands, W, H };
  }

  const W = pad * 2 + nodeW;
  const step = nodeH + 20;
  let y = pad;
  lanes.forEach((lane) => {
    const inLane = nodes.filter((n) => n.family === lane.name);
    const h = labelH + inLane.length * step + 8;
    bands.push({ name: lane.name, x: pad, y, w: W - pad * 2, h });
    inLane.forEach((n, ni) => {
      placed.push({ node: n, x: W / 2, y: y + labelH + 4 + ni * step + nodeH / 2, w: nodeW, h: nodeH });
    });
    y += h + gap;
  });
  return { placed, bands, W, H: y - gap + pad };
}

function MapSvg({ facts, dir }: { facts: Facts | null; dir: 'row' | 'col' }) {
  const lanes = facts?.families?.length
    ? facts.families
    : [
        { name: 'Transformer 架构', count: 0, pending: false },
        { name: '卷积网络（CNN）', count: 0, pending: false },
      ];
  const { placed, bands, W, H } = layoutMap(facts?.nodes ?? [], lanes, dir);
  const pos = new Map(placed.map((p) => [p.node.name, p]));
  const edges = facts?.edges ?? [];

  /** 关系线：同一分栏走下方弧线，跨分栏走 S 形；方向始终由前置方法指向后续方法 */
  const route = (a: Placed, b: Placed, idx: number): string => {
    if (dir === 'row') {
      const sameLane = Math.abs(a.y - b.y) < 4;
      if (sameLane) {
        const x1 = a.x + a.w / 2 - 8;
        const y1 = a.y + a.h / 2 - 6;
        const x2 = b.x - b.w / 2 + 10;
        const y2 = b.y + b.h / 2 - 6;
        const dip = 14 + (idx % 2) * 13;
        return `M ${x1} ${y1} C ${x1 + 8} ${y1 + dip} ${x2 - 8} ${y2 + dip} ${x2} ${y2}`;
      }
      const x1 = a.x + a.w / 2 - 8;
      const y1 = a.y + (b.y > a.y ? a.h / 2 - 6 : -a.h / 2 + 6);
      const x2 = b.x - b.w / 2 + 10;
      const y2 = b.y + (b.y > a.y ? -b.h / 2 + 6 : b.h / 2 - 6);
      const mx = (x1 + x2) / 2 + 16;
      return `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
    }
    const x1 = a.x + a.w / 2 - 8;
    const y1 = a.y + (b.y > a.y ? a.h / 2 - 8 : -a.h / 2 + 8);
    const x2 = b.x + b.w / 2 - 8;
    const y2 = b.y + (b.y > a.y ? -b.h / 2 + 8 : b.h / 2 - 8);
    const bulge = 20;
    return `M ${x1} ${y1} C ${x1 + bulge} ${y1} ${x2 + bulge} ${y2} ${x2} ${y2}`;
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={dir === 'row' ? 'heroSvgWide' : 'heroSvgTall'}
      role="img"
      aria-label="真实方法分族与关系"
    >
      {bands.map((band, i) => (
        <g key={`${band.name}-${i}`}>
          <rect x={band.x} y={band.y} width={band.w} height={band.h} rx="8" className="heroLane" />
          <text x={band.x + 12} y={band.y + 15} className="heroLaneName">
            {band.name}
            {lanes[i]?.count ? ` · ${lanes[i].count}` : ''}
          </text>
        </g>
      ))}
      {edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const solid = e.state === '原文已说明';
        return (
          <path
            key={`${e.from}-${e.to}-${i}`}
            className={`heroEdge${solid ? '' : ' dash'}`}
            d={route(a, b, i)}
            pathLength={solid ? 1 : undefined}
            markerEnd={solid ? 'url(#heroArrowE)' : 'url(#heroArrowC)'}
          />
        );
      })}
      <defs>
        <marker id="heroArrowE" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" className="heroArrowE" />
        </marker>
        <marker id="heroArrowC" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" className="heroArrowC" />
        </marker>
      </defs>
      {placed.map((p) => (
        <g key={p.node.name} className="heroNode">
          <rect x={p.x - p.w / 2} y={p.y - p.h / 2} width={p.w} height={p.h} rx="6" className="heroNodeBg" />
          <text x={p.x - p.w / 2 + 11} y={p.y - p.h / 2 + 21} className="heroNodeName">
            {p.node.name}
          </text>
          <text x={p.x + p.w / 2 - 11} y={p.y - p.h / 2 + 21} textAnchor="end" className="heroNodeYear">
            {p.node.year ?? '—'}
          </text>
        </g>
      ))}
    </svg>
  );
}

function HeroMapPreview({ facts }: { facts: Facts | null }) {
  const nodes = facts?.nodes ?? [];
  const edges = facts?.edges ?? [];
  return (
    <div className="heromap" aria-label="当前案例的研究地图切片（真实数据）">
      <div className="heromap-head">
        <span className="t">视觉方法演进案例</span>
        <span className="s">
          {nodes.length} 个方法 · {edges.length} 条可见关系
        </span>
      </div>
      <MapSvg facts={facts} dir="row" />
      <MapSvg facts={facts} dir="col" />
      <p className="heromap-note">
        {edges.length === 0
          ? '当前案例可见关系较少：只画真实存在的关系，不补线。'
          : `图中连线都是真实关系（虚线 = 系统推断）；${facts?.relationTotal ?? edges.length} 条关系中只有默认可见的会被画出来。`}
      </p>
    </div>
  );
}

/**
 * 宣传首页。
 * 首屏：左 56% 品牌与入口（五件事），右 44% 当前案例的真实研究地图切片。
 * 下方三个区块使用三种不同版式（左右分栏 / 左右互换 / 通栏横向路径）；编号只出现在阅读路径上。
 */
export function LandingView({ onExperienceCase, onUploadOwn, onGo }: Props) {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setFontsReady(true);
    };
    const timer = window.setTimeout(finish, 700);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) fonts.ready.then(finish).catch(finish);
    else finish();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}samples-vision/index.json`, { cache: 'no-cache' });
        if (!res.ok) return;
        const idx = await res.json();
        if (alive) setFacts(buildFacts(idx));
      } catch {
        /* 拿不到真实内容时用不声称具体数字的占位 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.landing .reveal'));
    if (!els.length) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.target.classList.toggle('in', e.isIntersecting)),
      { rootMargin: '-6% 0px -14% 0px', threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const papers = useMemo(() => facts?.papers ?? [], [facts]);
  const route = useMemo(() => facts?.route ?? [], [facts]);
  const rel = useMemo(() => facts?.edges?.[0] ?? null, [facts]);

  return (
    <div className="landing">
      {/* ---------------- 首屏：左品牌 / 右真实地图切片 ---------------- */}
      <section className="hero">
        <div className="hero-left">
          <h1 className={`brand-title font-gate${fontsReady ? ' ready' : ''}`}>ResearchPilot</h1>
          <p className="positioning">论文方法梳理智能体</p>
          <h2 className={`cn-sub font-gate${fontsReady ? ' ready' : ''}`}>把一组论文，变成你看得懂的研究地图。</h2>
          <p className="sub">读懂方法演进，知道先读哪一篇。</p>
          <div className="cta-row">
            <button className="btn primary lg" onClick={onExperienceCase}>
              体验视觉论文案例
            </button>
            <button className="linkbtn" onClick={onUploadOwn}>
              上传我的论文
            </button>
          </div>
        </div>
        <div className="hero-right">
          <HeroMapPreview facts={facts} />
        </div>
      </section>

      {/* ---------------- 区块一：左说明 / 右真实论文目录 ---------------- */}
      <section className="blk blk-split" aria-labelledby="blk-papers">
        <div className="blk-text">
          <h3 id="blk-papers" className="reveal" style={d(0)}>
            论文集合
          </h3>
          <p className="blk-lead reveal" style={d(110)}>
            先把论文按技术路线放在一起，再看每篇具体解决了什么、分析到哪一步。
          </p>
          <button className="btn reveal" style={d(220)} onClick={() => onGo('library')}>
            打开论文集合
          </button>
        </div>
        <div className="blk-view reveal" style={d(110)}>
          <ul className="plist">
            {(papers.length
              ? papers
              : [
                  { name: '方法一', family: '卷积网络（CNN）', role: '' },
                  { name: '方法二', family: 'Transformer 架构', role: '' },
                ]
            ).map((p) => (
              <li key={p.name}>
                <span className="nm">{p.name}</span>
                <span className="fam">{p.family}</span>
                <span className="role">{p.role || '一句话作用来自论文自述的核心思路'}</span>
              </li>
            ))}
          </ul>
          <p className="cap">一组论文</p>
        </div>
      </section>

      {/* ---------------- 区块二：左真实关系图 / 右说明（与区块一互换）---------------- */}
      <section className="blk blk-split rev" aria-labelledby="blk-map">
        <div className="blk-text">
          <h3 id="blk-map" className="reveal" style={d(0)}>
            研究地图
          </h3>
          <p className="blk-lead reveal" style={d(110)}>
            实线表示论文明确写出，虚线表示系统推断；每条关系都标注证据状态，没有引文的如实说明。
          </p>
          <button className="btn reveal" style={d(220)} onClick={() => onGo('map')}>
            打开研究地图
          </button>
        </div>
        <div className="blk-view reveal" style={d(110)}>
          <div className="relcard">
            <div className="relrow">
              <span className="n">{rel?.from ?? '前置方法'}</span>
              <span className={`relarrow${rel && rel.state === '原文已说明' ? '' : ' dash'}`} aria-hidden="true" />
              <span className="n">{rel?.to ?? '后续方法'}</span>
            </div>
            <div className="relmeta">
              <span className="k">
                <i className="dot ok" /> 论文明确写出
              </span>
              <span className="k">
                <i className="dot warn" /> 系统推断
              </span>
              {rel && (
                <span className="k">
                  这条：{rel.state}
                  {!rel.hasEvidence ? '（无直接引文）' : ''}
                </span>
              )}
            </div>
            <p className="sparse">
              {(facts?.edges?.length ?? 0) <= 2
                ? `当前案例关系较少：${facts?.relationTotal ?? 0} 条真实关系里只有 ${facts?.edges?.length ?? 0} 条可画，其余是「关系不明确」或待核查。系统不会补线把画布填满。`
                : `当前案例有 ${facts?.edges?.length ?? 0} 条可画关系，全部来自原文记录或系统推断。`}
            </p>
          </div>
          <p className="cap">方法分组与关联</p>
        </div>
      </section>

      {/* ---------------- 区块三：通栏横向阅读路径（第三种版式）---------------- */}
      <section className="blk blk-wide" aria-labelledby="blk-route">
        <div className="blk-wide-head">
          <h3 id="blk-route" className="reveal" style={d(0)}>
            阅读路线
          </h3>
          <p className="blk-lead reveal" style={d(110)}>
            按你的基础和目标排出顺序：先读哪一篇、为什么先读它、读完进哪一步。
            <span className="dim"> 示例路线，尚未个性化。</span>
          </p>
          <button className="btn reveal" style={d(220)} onClick={() => onGo('decision')}>
            打开阅读路线
          </button>
        </div>
        <ol className="hline reveal" style={d(200)}>
          {(route.length
            ? route
            : [
                { name: '第一步', focus: '' },
                { name: '第二步', focus: '' },
                { name: '第三步', focus: '' },
              ]
          ).map((st, i) => (
            <li key={`${st.name}-${i}`}>
              <span className="no">{String(i + 1).padStart(2, '0')}</span>
              <span className="nm">{st.name}</span>
              <span className="fc">{st.focus ? `重点看：${st.focus}` : '重点看：论文自述的核心做法'}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className="disclaimer reveal" style={d(0)}>
        以上分组、关系与顺序来自<strong>预置视觉案例</strong>（离线生成、已通过原文定位校验），并按证据状态标注；不是本次操作触发的实时分析。
      </p>
    </div>
  );
}
