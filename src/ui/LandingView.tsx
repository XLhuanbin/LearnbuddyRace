import React, { useEffect, useRef, useState } from 'react';

interface Props {
  onExperienceCase: () => void;
  onUploadOwn: () => void;
  onGo: (tab: 'library' | 'upload' | 'map' | 'experiments' | 'decision') => void;
}

/* =====================================================================
 * 首页三组抽象概念动画（纯 SVG + CSS，无外部资源）
 * - 配色只用四档：深墨蓝 / 品牌蓝 / 中浅蓝 / 极浅蓝（图形作用域变量，不改页面主题）
 * - 线宽三档 0.8 / 1.5 / 2.5；节点三档 6 / 10 / 18（首屏另有 22 的分叉点）
 * - 只动 opacity / transform / stroke-dashoffset；不循环；支持 prefers-reduced-motion
 * - 图形里没有真实论文名、篇数、关系数、证据状态：这是概念示意
 * - 三张图三种结构：分叉生长 / 汇聚再分组 / 单向前进
 * ===================================================================== */

const V_MOBILE = 0.9; // 窄屏纵向重排的整体缩放（保证最小节点 ≥8px）

type Pt = [number, number];
/** 桌面 (x,y)；窄屏转置成 (y,x) 并按 V_MOBILE 缩放 —— 是重排，不是等比缩小 */
const sx = (p: Pt, v?: boolean) => (v ? p[1] * V_MOBILE : p[0]);
const sy = (p: Pt, v?: boolean) => (v ? p[0] * V_MOBILE : p[1]);
const boxOf = (w: number, h: number, v?: boolean) => (v ? `0 0 ${h * V_MOBILE} ${w * V_MOBILE}` : `0 0 ${w} ${h}`);

/** 把端点沿相邻控制点方向收进节点半径，保证线接到节点边缘而不是穿过去 */
const toward = (from: Pt, to: Pt, r: number): Pt => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const d = Math.hypot(dx, dy) || 1;
  return [from[0] + (dx / d) * r, from[1] + (dy / d) * r];
};

const dOf = (pts: [Pt, Pt, Pt, Pt], r0 = 0, r1 = 0, v?: boolean) => {
  const p0 = r0 ? toward(pts[0], pts[1], r0) : pts[0];
  const p3 = r1 ? toward(pts[3], pts[2], r1) : pts[3];
  return `M ${sx(p0, v)} ${sy(p0, v)} C ${sx(pts[1], v)} ${sy(pts[1], v)} ${sx(pts[2], v)} ${sy(pts[2], v)} ${sx(p3, v)} ${sy(p3, v)}`;
};

const du = (ms: number) => ({ ['--d' as never]: `${ms}ms` }) as React.CSSProperties;

/** 一条连续的曲线路径（多段三次贝塞尔，用于「技术脉络」这类连续路线） */
function Path({
  d,
  w = 'thin',
  tone = 'mid',
  delay = 0,
  dur = 620,
  v,
}: {
  d: (v?: boolean) => string;
  w?: 'hair' | 'thin' | 'main';
  tone?: 'ink' | 'brand' | 'mid' | 'pale';
  delay?: number;
  dur?: number;
  v?: boolean;
}) {
  return (
    <path
      className={'fpath w-' + w + ' t-' + tone}
      d={d(v)}
      pathLength={1}
      style={{ ...du(delay), ['--dur' as never]: dur + 'ms' } as React.CSSProperties}
    />
  );
}

/** 节点三档：s=6 / m=10 / l=18 / xl=22（窄屏最小档提到 8，保证可辨） */
function Dot({ p, s = 'm', cls = '', delay = 0, v }: { p: Pt; s?: 's' | 'm' | 'l' | 'xl'; cls?: string; delay?: number; v?: boolean }) {
  const r = { s: v ? 8 : 6, m: 10, l: 18, xl: 22 }[s] / 2;
  return <circle className={`fnode n-${s} ${cls}`} cx={sx(p, v)} cy={sy(p, v)} r={r} style={du(delay)} />;
}

/** 路径三档：hair=0.8 / thin=1.5 / main=2.5 */
function Wire({
  pts,
  w = 'thin',
  tone = 'mid',
  delay = 0,
  dur = 620,
  dash,
  r0,
  r1,
  arrow,
  faint,
  v,
}: {
  pts: [Pt, Pt, Pt, Pt];
  w?: 'hair' | 'thin' | 'main';
  tone?: 'ink' | 'brand' | 'mid' | 'pale';
  delay?: number;
  dur?: number;
  dash?: string;
  faint?: boolean;
  r0?: number;
  r1?: number;
  arrow?: string;
  v?: boolean;
}) {
  return (
    <path
      className={`fpath w-${w} t-${tone}${faint ? ' faint' : ''}`}
      d={dOf(pts, r0, r1, v)}
      pathLength={1}
      markerEnd={arrow}
      style={{ ...du(delay), ['--dur' as never]: `${dur}ms`, ...(dash ? { ['--dash' as never]: dash } : {}) } as React.CSSProperties}
    />
  );
}

const arrowHead = (id: string, tone: 'ink' | 'brand') => (
  <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
    <path d="M0,0 L10,5 L0,10 z" className={`fhead t-${tone}`} />
  </marker>
);

/* ---------------------------------------------------------------- *
 * 一、首屏：从一个起点生长出研究地图（分叉结构）
 * 节点 8 个：左下起点(18) → 中央偏左分叉点(22) → 右上/右中/右下(10×3) + 左侧浅色线索(6×2)
 * 主线最深最粗，辅助线较浅，极细线只用于「可能的线索」
 * ---------------------------------------------------------------- */
function FigFork({ v }: { v?: boolean }) {
  const start: Pt = [66, 300];
  const fork: Pt = [250, 196];
  const up: Pt = [566, 78];
  const mid: Pt = [556, 190];
  const low: Pt = [540, 300];
  const auxA: Pt = [150, 84];
  const auxB: Pt = [196, 330];
  return (
    <svg viewBox={boxOf(640, 360, v)} className={v ? 'fig-tall' : 'fig-wide'} aria-hidden="true">
      <defs>{arrowHead('fa-ink', 'ink')}</defs>
      {/* 极细辅助线索（0.8px，极浅蓝） */}
      <Wire pts={[auxA, [188, 130], [220, 166], fork]} w="hair" tone="pale" delay={60} dur={460} r1={11} v={v} />
      <Wire pts={[auxB, [218, 296], [236, 244], fork]} w="hair" tone="pale" delay={90} dur={460} r1={11} v={v} />
      {/* 主路径：起点 → 分叉点（2.5px，深墨蓝） */}
      <Wire pts={[start, [128, 272], [196, 240], fork]} w="main" tone="ink" delay={300} dur={700} r0={9} r1={11} v={v} />
      {/* 主路径：分叉点 → 右上（最深最粗，带箭头） */}
      <Wire pts={[fork, [320, 130], [452, 84], up]} w="main" tone="ink" delay={900} dur={600} r0={11} r1={5} arrow="url(#fa-ink)" v={v} />
      {/* 辅助路径：分叉点 → 右中 / 右下（1.5px，中浅蓝） */}
      <Wire pts={[fork, [350, 186], [460, 184], mid]} w="thin" tone="mid" delay={1300} dur={500} r0={11} r1={5} v={v} />
      <Wire pts={[fork, [330, 236], [440, 280], low]} w="thin" tone="mid" delay={1500} dur={500} r0={11} r1={5} v={v} />
      {/* 节点：先出现的只有起点、分叉点与右上终点 */}
      <Dot p={start} s="l" cls="t-ink" delay={0} v={v} />
      <Dot p={fork} s="xl" cls="t-ink" delay={140} v={v} />
      <Dot p={up} s="m" cls="t-ink" delay={280} v={v} />
      <Dot p={mid} s="m" cls="t-mid" delay={1240} v={v} />
      <Dot p={low} s="m" cls="t-mid" delay={1440} v={v} />
      <Dot p={auxA} s="s" cls="t-pale" delay={40} v={v} />
      <Dot p={auxB} s="s" cls="t-pale" delay={70} v={v} />
      <circle className="fspark t-brand" cx={sx(start, v)} cy={sy(start, v)} r={3.5} style={{ ...du(1600), ['--sx' as never]: `${sx(up, v) - sx(start, v)}px`, ['--sy' as never]: `${sy(up, v) - sy(start, v)}px` } as React.CSSProperties} />
    </svg>
  );
}

/* ---------------------------------------------------------------- *
 * 二、论文集合：零散线索页片 → 分类脊柱 → 两条技术脉络
 * 页片不是 UI 卡片：只有一条淡页边竖线 + 2–3 条不等长横线 + 一个小标记点；
 * 脊柱是 2px 深墨蓝竖线 + 两个浅蓝分组节点 + 三条汇聚细弧 + 一个汇聚点（视觉焦点）；
 * 两条脉络用「竖线记号 + 小圆点 + 若干细横线」表达，上方更密更连续，下方更疏更平缓。
 * ---------------------------------------------------------------- */

/** 6 个页片：最终位置是「已经整理好」的一列；--fx/--fy/--rot 是动画起点（散开 + 轻微旋转） */
const SLIPS: { x: number; y: number; w: number; h: number; fx: number; fy: number; rot: number; o: string }[] = [
  { x: 44, y: 56, w: 34, h: 46, fx: -26, fy: 12, rot: -5, o: 'o1' },
  { x: 98, y: 72, w: 30, h: 38, fx: 30, fy: 10, rot: 4, o: 'o2' },
  { x: 50, y: 136, w: 40, h: 52, fx: -32, fy: -8, rot: 6, o: 'o3' },
  { x: 104, y: 164, w: 28, h: 34, fx: 34, fy: -12, rot: -6, o: 'o1' },
  { x: 46, y: 222, w: 36, h: 44, fx: -24, fy: -16, rot: 5, o: 'o2' },
  { x: 98, y: 264, w: 32, h: 50, fx: 28, fy: -14, rot: -4, o: 'o3' },
];
const LINES = [0.86, 0.6, 0.72];

function FigConverge({ v }: { v?: boolean }) {
  const spineX = 268;
  const upStages: [number, number][] = [
    [400, 150],
    [492, 116],
    [584, 84],
  ];
  const loStages: [number, number][] = [
    [404, 212],
    [520, 242],
    [612, 268],
  ];
  /** 两条技术脉络：各自一条连续曲线（多段三次贝塞尔） */
  const upLine = (vv?: boolean) => {
    const pts: [number, number][] = [[spineX, 180], [330, 170], [362, 160], [400, 150], [440, 140], [462, 128], [492, 116], [530, 102], [554, 92], [584, 84]];
    return pts.map((q, i) => (i === 0 ? 'M' : 'C') + ' ' + sx(q, vv) + ' ' + sy(q, vv)).join(' ');
  };
  const loLine = (vv?: boolean) => {
    const pts: [number, number][] = [[spineX, 180], [330, 198], [366, 206], [404, 212], [452, 222], [486, 232], [520, 242], [566, 256], [590, 262], [612, 268]];
    return pts.map((q, i) => (i === 0 ? 'M' : 'C') + ' ' + sx(q, vv) + ' ' + sy(q, vv)).join(' ');
  };
  const spineD = (vv?: boolean) =>
    'M ' + sx([spineX, 52], vv) + ' ' + sy([spineX, 52], vv) +
    ' C ' + sx([spineX + 8, 130], vv) + ' ' + sy([spineX + 8, 130], vv) +
    ' ' + sx([spineX - 8, 226], vv) + ' ' + sy([spineX - 8, 226], vv) +
    ' ' + sx([spineX, 304], vv) + ' ' + sy([spineX, 304], vv);
  /** 汇聚细弧：从页片一侧指向脊柱 */
  const arcs: [Pt, Pt, Pt, Pt][] = [
    [[144, 78], [196, 92], [230, 106], [spineX, 118]],
    [[150, 160], [204, 166], [238, 174], [spineX, 180]],
    [[146, 244], [200, 238], [236, 232], [spineX, 226]],
    [[150, 288], [198, 274], [232, 252], [spineX, 226]],
  ];

  return (
    <svg viewBox={boxOf(640, 360, v)} className={v ? 'fig-tall' : 'fig-wide'} aria-hidden="true">
      {/* 中央分类脊柱：2px 深墨蓝竖线（略弯）+ 两个浅蓝分组节点 + 汇聚点 */}
      <Path d={spineD} w="main" tone="ink" delay={900} dur={340} v={v} />
      <Dot p={[spineX, 118]} s="m" cls="t-mid" delay={980} v={v} />
      <Dot p={[spineX, 226]} s="m" cls="t-mid" delay={1040} v={v} />
      <circle className="fconv t-ink" cx={sx([spineX, 180], v)} cy={sy([spineX, 180], v)} r={4} style={du(1180)} />

      {/* 四条汇聚细弧（依次绘制） */}
      {arcs.map((a, i) => (
        <Wire key={'arc' + i} pts={a} w="hair" tone="pale" delay={900 + i * 90} dur={300} v={v} />
      ))}

      {/* 上方技术脉络：更密、更连续、略微上扬 */}
      <Path d={upLine} w="thin" tone="brand" delay={1150} dur={600} v={v} />
      {/* 下方技术脉络：更浅、更平缓、间距更大、细节线更少 */}
      <Path d={loLine} w="hair" tone="mid" delay={1400} dur={550} v={v} />

      {/* 页片：淡页边竖线 + 2–3 条不等长横线 + 一个小标记点 */}
      {SLIPS.map((s0, i) => (
        <g
          key={'slip' + i}
          className={'fslip ' + s0.o}
          style={
            {
              ...du(i * 60),
              ['--fx' as never]: (v ? s0.fy : s0.fx) + 'px',
              ['--fy' as never]: (v ? s0.fx : s0.fy) + 'px',
              ['--rot' as never]: (v ? s0.rot * -1 : s0.rot) + 'deg',
            } as React.CSSProperties
          }
        >
          <line className="fslip-edge" x1={sx([s0.x, s0.y], v)} y1={sy([s0.x, s0.y], v)} x2={sx([s0.x, s0.y + s0.h], v)} y2={sy([s0.x, s0.y + s0.h], v)} />
          {LINES.slice(0, 2 + (i % 2)).map((f, li) => (
            <line
              key={li}
              className="fslip-line"
              x1={sx([s0.x + 5, s0.y + 8 + li * 11], v)}
              y1={sy([s0.x + 5, s0.y + 8 + li * 11], v)}
              x2={sx([s0.x + 5 + (s0.w - 10) * f, s0.y + 8 + li * 11], v)}
              y2={sy([s0.x + 5 + (s0.w - 10) * f, s0.y + 8 + li * 11], v)}
            />
          ))}
          <line
            className="fslip-dot"
            x1={sx([s0.x + 5, s0.y + s0.h - 10], v)}
            y1={sy([s0.x + 5, s0.y + s0.h - 10], v)}
            x2={sx([s0.x + 5 + s0.w * 0.26, s0.y + s0.h - 10], v)}
            y2={sy([s0.x + 5 + s0.w * 0.26, s0.y + s0.h - 10], v)}
          />
        </g>
      ))}

      {/* 阶段标记 + 细节横线：上方每阶段 1/2/3 条，下方每阶段各 1 条 */}
      {upStages.map((q, i) => (
        <g key={'us' + i} className={'fstage' + (i === 2 ? ' last' : '')} style={du(1150 + i * 150)}>
          <line className="ftick t-brand" x1={sx([q[0], q[1] - 12], v)} y1={sy([q[0], q[1] - 12], v)} x2={sx([q[0], q[1] + 12], v)} y2={sy([q[0], q[1] + 12], v)} />
          <circle className="fdot t-brand" cx={sx(q, v)} cy={sy(q, v)} r={3} />
          {Array.from({ length: i + 1 }).map((_, k) => (
            <line
              key={k}
              className="fdetail t-brand"
              x1={sx([q[0] + 10, q[1] - 6 + k * 8], v)}
              y1={sy([q[0] + 10, q[1] - 6 + k * 8], v)}
              x2={sx([q[0] + 10 + 20 + i * 8 - k * 4, q[1] - 6 + k * 8], v)}
              y2={sy([q[0] + 10 + 20 + i * 8 - k * 4, q[1] - 6 + k * 8], v)}
              style={du(1250 + i * 150 + k * 50)}
            />
          ))}
        </g>
      ))}
      {loStages.map((q, i) => (
        <g key={'ls' + i} className="fstage" style={du(1400 + i * 160)}>
          <line className="ftick t-mid" x1={sx([q[0], q[1] - 10], v)} y1={sy([q[0], q[1] - 10], v)} x2={sx([q[0], q[1] + 10], v)} y2={sy([q[0], q[1] + 10], v)} />
          <circle className="fdot t-mid" cx={sx(q, v)} cy={sy(q, v)} r={2.5} />
          <line
            className="fdetail t-mid"
            x1={sx([q[0] + 9, q[1] + 2], v)}
            y1={sy([q[0] + 9, q[1] + 2], v)}
            x2={sx([q[0] + 31, q[1] + 2], v)}
            y2={sy([q[0] + 31, q[1] + 2], v)}
            style={du(1500 + i * 160)}
          />
        </g>
      ))}

      {/* 三个阶段词：只允许 线索 / 分类 / 脉络 */}
      <text className="fword" x={sx([62, 28], v)} y={sy([62, 28], v)}>
        线索
      </text>
      <text className="fword" x={sx([252, 28], v)} y={sy([252, 28], v)}>
        分类
      </text>
      <text className="fword" x={sx([470, 28], v)} y={sy([470, 28], v)}>
        脉络
      </text>
    </svg>
  );
}

/* ---------------------------------------------------------------- *
 * 三、阅读路线：单向前进（禁止分叉 / 放射 / 网状）
 * 起点 → 01 → 02 → 03 → 04 → 05 → 终点箭头；另一条极浅虚线只作背景（opacity < .25，无节点）
 * ---------------------------------------------------------------- */
const STOPS: Pt[] = [
  [150, 152],
  [246, 198],
  [342, 144],
  [438, 190],
  [532, 150],
];
const START: Pt = [54, 196];
const END: Pt = [612, 168];

function FigRoute({ v }: { v?: boolean }) {
  const chain: Pt[] = [START, ...STOPS, END];
  return (
    <svg viewBox={boxOf(640, 360, v)} className={v ? 'fig-tall' : 'fig-wide'} aria-hidden="true">
      <defs>{arrowHead('fr-ink', 'ink')}</defs>
      {/* 极浅的候选底色（没有节点、不抢焦点） */}
      <Wire pts={[START, [180, 150], [430, 168], END]} w="hair" tone="pale" delay={0} dur={1} dash="0.02 0.035" faint v={v} />
      {/* 主路径：逐段绘制（每段都接到节点边缘） */}
      {chain.slice(0, -1).map((p, i) => (
        <Wire
          key={i}
          pts={[p, [(p[0] + chain[i + 1][0]) / 2, p[1] + (i % 2 ? -14 : 14)], [(p[0] + chain[i + 1][0]) / 2, chain[i + 1][1] + (i % 2 ? 16 : -16)], chain[i + 1]]}
          w="main"
          tone="ink"
          delay={400 + i * 150}
          dur={170}
          r0={i === 0 ? 7 : 5}
          r1={i === chain.length - 2 ? 0 : 5}
          arrow={i === chain.length - 2 ? 'url(#fr-ink)' : undefined}
          v={v}
        />
      ))}
      {/* 起点 / 停靠点 / 终点 */}
      <Dot p={START} s="m" cls="t-ink" delay={0} v={v} />
      {STOPS.map((p, i) => (
        <Dot key={i} p={p} s={i === STOPS.length - 1 ? 'l' : 's'} cls={i === STOPS.length - 1 ? 't-mid' : 't-ink'} delay={430 + i * 150} v={v} />
      ))}
      <line
        className="fcap t-ink"
        x1={sx(toward(END, chain[chain.length - 2], 12), v)}
        y1={sy(toward(END, chain[chain.length - 2], 12), v)}
        x2={sx(END, v)}
        y2={sy(END, v)}
        style={du(1500)}
      />
      {STOPS.map((p, i) => (
        <text key={`n${i}`} className="fnum" x={sx([p[0] - 4, p[1] - 22], v)} y={sy([p[0] - 4, p[1] - 22], v)} style={du(470 + i * 150)}>
          {String(i + 1).padStart(2, '0')}
        </text>
      ))}
      <circle className="fspark t-brand" cx={sx(START, v)} cy={sy(START, v)} r={3.5} style={{ ...du(1300), ['--sx' as never]: `${sx(END, v) - sx(START, v)}px`, ['--sy' as never]: `${sy(END, v) - sy(START, v)}px` } as React.CSSProperties} />
    </svg>
  );
}


/* ---------------------------------------------------------------- *
 * 局部研究地图（区块二）：一个中心节点向三个方向生长，一条保持开放末端
 * 与首屏的全局生长图共用视觉语言，但节点更少、更紧凑，不会看起来像同一张图
 * ---------------------------------------------------------------- */
function FigForkLocal({ v }: { v?: boolean }) {
  const hub: Pt = [296, 188];
  return (
    <svg viewBox={boxOf(640, 360, v)} className={v ? 'fig-tall' : 'fig-wide'} aria-hidden="true">
      <defs>{arrowHead('fl-ink', 'ink')}</defs>
      <Wire pts={[hub, [196, 128], [132, 96], [76, 78]]} w="main" tone="ink" delay={160} dur={520} r0={11} r1={5} v={v} />
      <Wire pts={[hub, [206, 244], [148, 288], [92, 312]]} w="thin" tone="mid" delay={420} dur={520} r0={11} r1={5} v={v} />
      <Wire pts={[hub, [400, 168], [488, 152], [566, 148]]} w="thin" tone="brand" delay={680} dur={560} r0={11} r1={0} arrow="url(#fl-ink)" v={v} />
      <Wire pts={[hub, [380, 250], [470, 268], [548, 262]]} w="hair" tone="pale" delay={820} dur={520} r0={11} r1={3} v={v} />
      <Dot p={hub} s="xl" cls="t-ink" delay={0} v={v} />
      <Dot p={[76, 78]} s="m" cls="t-ink" delay={560} v={v} />
      <Dot p={[92, 312]} s="m" cls="t-mid" delay={760} v={v} />
      <Dot p={[548, 262]} s="s" cls="t-pale" delay={1080} v={v} />
      <circle className="fring t-brand" cx={sx(hub, v)} cy={sy(hub, v)} r={11} style={du(1200)} />
    </svg>
  );
}

/* ---------------------------------------------------------------- *
 * 播放控制：进入视口播一次；离开视口回到完整静止画面；reduced-motion 直接静态
 * ---------------------------------------------------------------- */
function usePlayOnce(hero = false) {
  const ref = useRef<HTMLDivElement>(null);
  const [play, setPlay] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    if (hero) {
      const t = window.setTimeout(() => setPlay(true), 120);
      return () => window.clearTimeout(t);
    }
    if (typeof IntersectionObserver === 'undefined') {
      setPlay(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => setPlay(e.isIntersecting)), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [hero]);

  return { ref, cls: `fig${play ? ' play' : ''}` };
}

const NOTE = '概念示意，不代表当前案例的真实关系数量。';

function Fig({
  wide,
  tall,
  caption,
  hero = false,
  note = true,
}: {
  wide: React.ReactNode;
  tall: React.ReactNode;
  caption: string;
  hero?: boolean;
  note?: boolean;
}) {
  const { ref, cls } = usePlayOnce(hero);
  return (
    <figure className={cls} ref={ref}>
      {wide}
      {tall}
      <figcaption className="fig-cap">
        {caption}
        {note && <span className="fig-note">{NOTE}</span>}
      </figcaption>
    </figure>
  );
}

/**
 * 宣传首页。左侧排版与文案不动；三组配图分别是「分叉生长 / 汇聚再分组 / 单向前进」。
 * 图形全部为概念示意（aria-hidden），不含真实论文名、篇数、关系数与证据状态。
 */
export function LandingView({ onExperienceCase, onUploadOwn, onGo }: Props) {
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
    const els = Array.from(document.querySelectorAll<HTMLElement>('.landing .reveal'));
    if (!els.length) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.target.classList.toggle('in', e.isIntersecting)), {
      rootMargin: '-6% 0px -14% 0px',
      threshold: 0.15,
    });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="landing">
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
          <Fig hero caption="从一组线索出发，形成可探索的研究地图。" wide={<FigFork />} tall={<FigFork v />} />
        </div>
      </section>

      <section className="blk" aria-labelledby="blk-papers">
        <div className="blk-text">
          <h3 id="blk-papers" className="reveal" style={du(0)}>
            论文集合
          </h3>
          <p className="blk-lead reveal" style={du(110)}>
            先把论文按技术路线放在一起，再看每篇具体解决了什么。
          </p>
          <button className="btn reveal" style={du(220)} onClick={() => onGo('library')}>
            打开论文集合
          </button>
        </div>
        <div className="blk-fig reveal" style={du(110)}>
          <Fig
            caption="散落的论文线索，被整理成可以继续追踪的技术脉络。"
            note={false}
            wide={<FigConverge />}
            tall={<FigConverge v />}
          />
        </div>
      </section>

      <section className="blk rev" aria-labelledby="blk-map">
        <div className="blk-text">
          <h3 id="blk-map" className="reveal" style={du(0)}>
            研究地图
          </h3>
          <p className="blk-lead reveal" style={du(110)}>
            看清方法之间的联系、区别和证据状态。
          </p>
          <button className="btn reveal" style={du(220)} onClick={() => onGo('map')}>
            打开研究地图
          </button>
        </div>
        <div className="blk-fig reveal" style={du(110)}>
          <Fig caption="从一个中心方法向三个方向延伸，其中一条保持开放。" wide={<FigForkLocal />} tall={<FigForkLocal v />} />
        </div>
      </section>

      <section className="blk rev" aria-labelledby="blk-route">
        <div className="blk-text">
          <h3 id="blk-route" className="reveal" style={du(0)}>
            阅读路线
          </h3>
          <p className="blk-lead reveal" style={du(110)}>
            先读哪篇，以及读每篇时重点看什么。
          </p>
          <button className="btn reveal" style={du(220)} onClick={() => onGo('decision')}>
            查看阅读路线
          </button>
        </div>
        <div className="blk-fig reveal" style={du(110)}>
          <Fig caption="从起点开始，沿着一条明确顺序逐步阅读。" wide={<FigRoute />} tall={<FigRoute v />} />
        </div>
      </section>

      <p className="disclaimer reveal" style={du(0)}>
        以上配图为<strong>产品概念示意</strong>，不代表当前案例的真实关系数量与证据状态；真实的分组、关系与阅读顺序在研究地图与阅读路线页按证据展示。
      </p>
    </div>
  );
}
