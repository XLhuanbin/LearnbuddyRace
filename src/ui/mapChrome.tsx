import React from 'react';
import { Status } from './common';

/**
 * 全站共用的两块外框（2026-09-24 整站精修起，所有非宣传页共用同一套）：
 *   1. AppBrandBar —— 顶部品牌栏（深墨蓝方形 R + 衬线 ResearchPilot + 一句定位 + 右侧次级入口）
 *   2. AppSideNav  —— 左侧导航（研究工作区 / 当前集合 / 专业视图 / 开发）
 *
 * 约定：
 * - 这里只做**导航与外壳**，不读取、不改写任何分析结果；
 * - 所有数量都来自 App 传进来的真实 scope 计数；
 * - 品牌名用中文衬线字体，字体就绪前不显示（只淡入、不改尺寸），避免加载时字体跳变；
 * - 宣传首页不渲染侧边栏（评审观感），但仍使用同一套顶部品牌栏。
 */

const ICONS: Record<string, string> = {
  library: 'M6.5 3.5h7.5v13h-7.5z M4 5.2v10.3 M10.2 7.2h3.2 M10.2 10h3.2',
  extract: 'M4 5.5h12 M4 10h6 M4 14.5h4 M13 9.5l3 3-3 3',
  map: 'M3.5 6l4.3-2 4.4 2 4.3-2v10.2l-4.3 2-4.4-2-4.3 2z M7.8 4v10.2 M12.2 6v10.2',
  compare: 'M4 16V9 M8.5 16V5 M13 16v-4.5 M17 16v-8',
  route: 'M5.5 16.5V8.2 M5.5 8.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z M5.5 12.5h5.6a3 3 0 0 0 3-3V6.5 M14.1 6.5l-1.4 1.6 M14.1 6.5l1.4 1.6',
  folder: 'M3.5 6.2A1.7 1.7 0 0 1 5.2 4.5h3l1.6 2h5A1.7 1.7 0 0 1 16.5 8.2v5.6a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z',
  upload: 'M10 15.5V5 M5.8 9.2 10 5l4.2 4.2',
  graph: 'M6 6.5h.01 M14 13.5h.01 M10.5 10.5l3 2.6 M6.6 7.3l3.2 2.8 M6 6.5a1.6 1.6 0 1 0 0-.01 M14 13.5a1.6 1.6 0 1 0 0-.01',
  question: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M10 7.4v3.6 M10 13.4h.01',
  cross: 'M4.5 10h11 M10 4.5v11 M6.6 6.6l6.8 6.8 M13.4 6.6l-6.8 6.8',
  status: 'M4.5 15.5l3.5-3.5 2.5 2.5 5-5.5 M4.5 4.5v11h11',
  version: 'M5.5 3.5h9v13h-9z M7.8 7h4.4 M7.8 10h4.4 M7.8 13h2.6',
  future: 'M10 3.5l1.7 4.4 4.3 1.6-4.3 1.6L10 15.5l-1.7-4.4L4 9.5l4.3-1.6z M15.5 14.5h.01 M16.5 5.5h.01',
  settings: 'M10 7.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z M10 3.4v1.8 M10 14.8v1.8 M3.4 10h1.8 M14.8 10h1.8 M5.5 5.5l1.3 1.3 M13.2 13.2l1.3 1.3 M14.5 5.5l-1.3 1.3 M6.8 13.2l-1.3 1.3',
};

function NavIcon({ name }: { name: string }) {
  const d = ICONS[name] ?? ICONS.map;
  return (
    <svg
      className="nvi"
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * 顶部品牌栏（所有页共用）：左侧品牌 + 目录，右侧案例名与返回入口；入口全部收进目录浮层。
 *
 * 动线口径（2026-10-11 按用户要求改）：**照两份首页草稿（002308b4 / 0964dc25）**，
 * 顶栏只有「品牌 + 目录」—— 草稿里没有右上角那条锚点导航（方法梳理/研究地图/功能特性/关于
 * 是我们自己加的）。整站的动线统一走「目录一个入口」，首页不再另设第二条。
 */
export function AppBrandBar({
  corpusLabel,
  fontsReady,
  minimal,
  active,
  onHome,
  onGo,
  onBack,
}: {
  corpusLabel: string;
  fontsReady: boolean;
  /** 宣传首页：只留品牌与定位，不堆按钮与状态 */
  minimal?: boolean;
  /** 当前页面（用于目录里的高亮） */
  active?: string;
  onHome: () => void;
  onGo: (tab: string) => void;
  onBack: () => void;
}) {
  const [dirOpen, setDirOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!dirOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setDirOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDirOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [dirOpen]);

  /**
   * 目录 = 整站的动线，按**真实工作顺序**分组（2026-10-11 重排）：
   * 开始（把论文弄进来）→ 梳理（看方法全貌与关系）→ 比较（判断能不能比）→ 决策（读哪篇、还缺什么）
   * → 关于本作品。原来按「研究工作区 / 专业视图」分，看不出先做哪一步。
   */
  const GROUPS: { label: string; items: [string, string, string][] }[] = [
    {
      label: '开始',
      items: [
        ['library', '论文集合', 'folder'],
        ['upload', '方法提取', 'upload'],
      ],
    },
    {
      label: '梳理',
      items: [
        ['map', '研究地图', 'map'],
        ['graph', '方法关系图', 'graph'],
      ],
    },
    {
      label: '比较',
      items: [
        ['experiments', '实验可比性', 'compare'],
        ['compare', '跨论文比较', 'cross'],
      ],
    },
    {
      label: '决策',
      items: [
        ['decision', '阅读路线', 'route'],
        ['divergence', '待调查问题', 'question'],
      ],
    },
  ];
  const DEV: [string, string, string][] = [
    ['status', '开发状态', 'status'],
    ['version', '版本信息', 'version'],
    ['future', '未来展望', 'future'],
    ['settings', '设置', 'settings'],
  ];

  const item = ([tab, label, icon]: [string, string, string]) => (
    <button
      key={tab}
      className={`diritem${active === tab ? ' on' : ''}`}
      role="menuitem"
      onClick={() => {
        onGo(tab);
        setDirOpen(false);
      }}
    >
      <NavIcon name={icon} />
      {label}
    </button>
  );

  return (
    <header className={`mapbrand${minimal ? ' landingbar' : ''}`}>
      <button className="logo" onClick={onHome} title="回到首页">
        <span className="mark" aria-hidden="true">
          R
        </span>
        <span className={`brand-serif font-gate${fontsReady ? ' ready' : ''}`}>ResearchPilot</span>
      </button>

      {/* 首页也照草稿保留「目录」——整站只有这一个导航入口 */}
      <div className="dirwrap" ref={wrapRef}>
        <button className="btn ghost sm dirbtn" aria-expanded={dirOpen} aria-haspopup="menu" onClick={() => setDirOpen((v) => !v)}>
          目录
        </button>
        {dirOpen && (
          <div className="dirpop" role="menu" aria-label="页面目录">
            {[...GROUPS, { label: '关于本作品', items: DEV }].map((g) => (
              <React.Fragment key={g.label}>
                <div className="dirlab">{g.label}</div>
                {g.items.map(item)}
                <div className="dirsep" />
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <span className="spacer" />

      {!minimal && (
        <>
          <span className="casename">{corpusLabel}</span>
          <button className="linkbtn" onClick={onBack}>
            返回论文集合
          </button>
        </>
      )}
    </header>
  );
}

export function AppSideNav({
  active,
  corpusLabel,
  presetCount,
  ownCount,
  collection,
  modelReady,
  onGo,
  onPickCollection,
}: {
  active: string;
  corpusLabel: string;
  presetCount: number;
  ownCount: number;
  collection: 'case' | 'own';
  modelReady: boolean;
  onGo: (tab: string) => void;
  onPickCollection: (c: 'case' | 'own') => void;
}) {
  /* 与顶栏「目录」同一套动线分组（开始 → 梳理 → 比较 → 决策 → 关于本作品），两处说法一致 */
  const start: { key: string; name: string; icon: string; target: string; badge?: string; done?: boolean }[] = [
    { key: 'library', name: '论文集合', icon: 'library', target: 'library', badge: String(presetCount), done: presetCount > 0 },
    { key: 'extract', name: '方法提取', icon: 'extract', target: 'upload', done: presetCount > 0 },
  ];
  const sort: { key: string; name: string; icon: string; target: string }[] = [
    { key: 'map', name: '研究地图', icon: 'map', target: 'map' },
    { key: 'graph', name: '方法关系图', icon: 'graph', target: 'graph' },
  ];
  const cmp: { key: string; name: string; icon: string; target: string }[] = [
    { key: 'experiments', name: '实验可比性', icon: 'compare', target: 'experiments' },
    { key: 'compare', name: '跨论文比较', icon: 'cross', target: 'compare' },
  ];
  const decide: { key: string; name: string; icon: string; target: string }[] = [
    { key: 'decision', name: '阅读路线', icon: 'route', target: 'decision' },
    { key: 'divergence', name: '待调查问题', icon: 'question', target: 'divergence' },
  ];
  const dev: { key: string; name: string; icon: string; target: string }[] = [
    { key: 'status', name: '开发状态', icon: 'status', target: 'status' },
    { key: 'version', name: '版本信息', icon: 'version', target: 'version' },
    { key: 'future', name: '未来展望', icon: 'future', target: 'future' },
    { key: 'settings', name: '设置', icon: 'settings', target: 'settings' },
  ];

  const item = (x: { name: string; icon: string; target: string; badge?: string; done?: boolean }) => (
    <button
      key={x.target + x.name}
      className={`nav${active === x.target ? ' active' : ''}`}
      onClick={() => onGo(x.target)}
      aria-current={active === x.target ? 'page' : undefined}
    >
      <NavIcon name={x.icon} />
      <span className="nav-name">{x.name}</span>
      {x.done && !x.badge ? <span className="dotstate ok" aria-hidden="true" /> : null}
      {x.badge ? <span className="badge">{x.badge}</span> : null}
    </button>
  );

  return (
    <aside className="side research" aria-label="研究工作区">
      <div className="group-label">开始</div>
      {start.map(item)}

      <div className="group-label">梳理</div>
      {sort.map(item)}

      <div className="group-label">当前集合</div>
      <button
        className={`nav${collection === 'case' && active === 'map' ? ' active' : ''}`}
        onClick={() => onPickCollection('case')}
        title="查看这个案例集合"
      >
        <NavIcon name="folder" />
        <span className="nav-name">{corpusLabel}</span>
        <span className="badge">{presetCount}</span>
      </button>
      <button
        className={`nav${collection === 'own' && active === 'map' ? ' active' : ''}`}
        onClick={() => onPickCollection('own')}
        title="查看我自己上传的论文"
      >
        <NavIcon name="upload" />
        <span className="nav-name">我上传的论文</span>
        <span className="badge">{ownCount}</span>
      </button>

      <details className="sidegroup">
        <summary>比较</summary>
        {cmp.map(item)}
      </details>

      <details className="sidegroup">
        <summary>决策</summary>
        {decide.map(item)}
      </details>

      <details className="sidegroup">
        <summary>关于本作品</summary>
        {dev.map(item)}
      </details>

      <div className="side-foot">
        案例 {presetCount} 篇（本语料预置）· 我上传 {ownCount} 篇
        <br />
        {modelReady ? '模型接口已配置' : '未配置模型（只能看示例结果）'}
        <br />
        数据仅存于本机浏览器，关系与结论均可回到原文核验
      </div>
    </aside>
  );
}
