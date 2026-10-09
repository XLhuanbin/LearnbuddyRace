import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Evidence, Method, Paper, ReadingPlan, Relation, RelationEvidenceState, UserProfile } from '../core/types';
import { relationsInScope, type CorpusKey, type CorpusScope, type ScopeMode } from '../core/corpus';
import { Crumb, Status } from './common';
import { buildMethodOverview, buildMethodProfile } from '../core/grouping';
import { MethodMap } from './MethodMap';
import { MapRelationsView } from './MapRelationsView';
import { MapStartView } from './MapStartView';

type SubView = 'map' | 'relations' | 'start';
export type { ScopeMode };

interface Props {
  papers: Paper[];
  methods: Method[];
  relations: Relation[];
  scope: CorpusScope;
  corpusLoading: CorpusKey | null;
  plan?: ReadingPlan;
  questions?: { id: string; text: string; basis?: string; evidence?: Evidence[] }[];
  modelReady: boolean;
  busy: boolean;
  /** 当前集合（案例 / 我上传的论文）由工作区外框控制，地图只负责渲染 */
  mode: ScopeMode;
  onModeChange: (m: ScopeMode) => void;
  onGenerate: (profile: UserProfile) => void;
  /** 停止等待正在生成的阅读路线（只停止本地等待） */
  onCancelGenerate?: () => void;
  onOpenEvidence: (ev: Evidence) => void;
  onAddPapers: () => void;
  onSwitchCase: () => void;
  onReloadCase: () => void;
  /** 返回论文集合（简短面包屑用） */
  onGoLibrary?: () => void;
  /**
   * 从顶栏「目录」再次点进研究地图时递增。
   * 三个子视图是同一页面的内部状态：不重置的话会出现「点了研究地图却还停在某个子视图」，
   * 用户只能退出去再进来，等于一条死路。
   */
  resetSignal?: number;
}

/**
 * 研究地图工作区。
 *
 * 版面（编辑部式）：页头（面包屑 → 论文已导入 → 方法已提取 → 研究地图 → 阅读路线、
 * 标题、篇数与缓存/实时状态、三个视图入口、添加论文与选项）+ 一整块画布 + 浮层详情。
 *
 * 地图只显示**当前集合**：案例模式 = 当前语料的预置论文；我的论文模式 = 用户上传/粘贴的论文。
 * 用户论文不会被静默混进案例地图（修复「视觉案例出现 BERT」）。
 */
export function MapView({
  papers,
  methods,
  relations,
  scope: corpusScope,
  corpusLoading,
  plan,
  questions,
  modelReady,
  busy,
  mode,
  onModeChange,
  onGenerate,
  onCancelGenerate,
  onOpenEvidence,
  onAddPapers,
  onSwitchCase,
  onReloadCase,
  onGoLibrary,
  resetSignal = 0,
}: Props) {
  const [sub, setSub] = useState<SubView>('map');
  /**
   * 对照对的三态：
   *   null → 没指定（「关系与比较」自己挑一对值得看的）
   *   []   → 用户点了「去选择对照」，要求他自己选
   *   [a,b] → 明确的对照两端
   */
  const [pair, setPair] = useState<string[] | null>(null);
  /**
   * 关系可见性三态（默认「全部」）：
   *   all     = 画布上显示全部关系（含待核查与「关系不明确」）—— 默认值，避免默认就把大部分关系藏起来
   *   usable  = 有可用证据状态的关系（原文明示 + 系统推断）
   *   pending = 还不能当结论用的（待核查 + 关系不明确）
   */
  const [relView, setRelView] = useState<'all' | 'usable' | 'pending'>('all');
  /** 只看**已核验**引文的关系（`evidence.verified === true`；与三态正交的额外收窄，默认关） */
  const [onlyEvidence, setOnlyEvidence] = useState(false);
  /** 筛选与集合操作是两个独立弹层（不再混在一个「选项」里） */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [setsOpen, setSetsOpen] = useState(false);
  const loading = corpusLoading === corpusScope.key;

  /** 顶栏再次进入研究地图 → 回到默认的「方法地图」（只复位子视图，不动筛选与缩放） */
  useEffect(() => {
    setSub('map');
  }, [resetSignal]);

  /**
   * 当前集合的数据：案例 = 当前语料预置；我的论文 = 用户自传。
   *
   * **关系必须两端都在本集合的方法里**——否则会出现「节点不在画布上、关系数量与节点集合对不上」
   * （例如案例地图里混进一条连到用户上传论文的关系）。
   * 这里不依赖上游是否过滤，自己再按端点集合过滤一次。
   */
  const view = useMemo(() => {
    const papers = mode === 'own' ? corpusScope.ownPapers : corpusScope.presetPapers;
    const methods = mode === 'own' ? corpusScope.ownMethods : corpusScope.presetMethods;
    const ids = new Set(methods.map((m) => m.id));
    return {
      papers,
      methods,
      relations: relationsInScope(relations, ids),
      label: mode === 'own' ? '我上传的论文' : corpusScope.meta.label,
      count: papers.length,
      isCase: mode !== 'own',
    };
  }, [mode, corpusScope, relations]);

  const ownCount = corpusScope.ownPapers.length;

  /** 案例还没加载、但用户已有自己上传的论文时，直接显示「我上传的论文」 */
  useEffect(() => {
    if (mode === 'case' && corpusScope.presetPapers.length === 0 && ownCount > 0) onModeChange('own');
  }, [mode, corpusScope.presetPapers.length, ownCount, onModeChange]);

  const presetCached = view.papers.some((p) => p.cached);

  /**
   * 三态归类（只决定「画布显示什么」，不改任何证据状态与判定）：
   *   usable  —— 有可用证据状态：原文明示 / 系统推断
   *   pending —— 还不能当结论用：待核查（candidate）+ 关系不明确（unclear）
   */
  const bucketOf = (r: Relation): 'usable' | 'pending' =>
    r.type === 'unclear' || r.evidenceState === 'candidate' ? 'pending' : 'usable';

  /**
   * 「只看有证据关系」的判据：`evidence` 存在**且已通过定位校验**（`verified === true`）。
   * 不能用 `Boolean(r.evidence)` —— 那只是「有个 evidence 对象」，引文没定位成功、或校验没通过的也算数，
   * 与「已核验」的说法不符。证据只有三种合法来源：buildEvidence 的校验结果 / 缓存里已核验的旧值 / 没有。
   */
  const hasVerifiedEvidence = (r: Relation) => r.evidence?.verified === true;

  /**
   * 画布「画什么」的**唯一**规则：先按三态收窄，再按「只看有证据」收窄。
   * relStats（页头计数）与 MethodMap（画布连线）都用它，两者不可能各说各话。
   */
  const relVisible = useCallback(
    (r: Relation) =>
      (relView === 'all' || bucketOf(r) === relView) && (!onlyEvidence || hasVerifiedEvidence(r)),
    [relView, onlyEvidence],
  );

  /** 关系计数：总数 / 三态各自条数 / 当前可见数（与画布用完全相同的筛选条件） */
  const relStats = useMemo(() => {
    let visible = 0;
    let usable = 0;
    let pendingCandidate = 0;
    let pendingUnclear = 0;
    let hiddenNoEvidence = 0;
    let withVerified = 0;
    for (const r of view.relations) {
      const bucket = bucketOf(r);
      if (bucket === 'usable') usable += 1;
      else if (r.type === 'unclear') pendingUnclear += 1;
      else pendingCandidate += 1;
      /**
       * 「在不在当前三态范围内」要单独算：`relView === 'all'` 时它恒为真。
       * 之前这里写成 `bucket === relView`，于是「全部 + 只看有证据」下 hiddenNoEvidence 永远是 0，
       * 隐藏数对不上任何原因（只会退化成「已按上方筛选收起」）。这是本轮要修的统计 bug。
       */
      const inBucket = relView === 'all' || bucket === relView;
      if (inBucket && hasVerifiedEvidence(r)) withVerified += 1;
      if (relVisible(r)) visible += 1;
      else if (inBucket && onlyEvidence && !hasVerifiedEvidence(r)) hiddenNoEvidence += 1;
    }
    const pending = pendingCandidate + pendingUnclear;
    return {
      total: view.relations.length,
      visible,
      usable,
      pending,
      pendingCandidate,
      pendingUnclear,
      hiddenNoEvidence,
      withVerified,
    };
  }, [view.relations, relVisible]);

  /** 被隐藏的原因：按三态与「只看有证据」的实际组成写清楚，不含糊其辞 */
  const hiddenReasons = useMemo(() => {
    const out: string[] = [];
    if (relView === 'usable') {
      if (relStats.pendingCandidate) out.push(`待核查 ${relStats.pendingCandidate} 条`);
      if (relStats.pendingUnclear) out.push(`关系不明确 ${relStats.pendingUnclear} 条`);
    }
    if (relView === 'pending' && relStats.usable) out.push(`可用 ${relStats.usable} 条`);
    if (relStats.hiddenNoEvidence)
      out.push(`无引文或未通过校验（只看有证据）${relStats.hiddenNoEvidence} 条`);
    return out.length ? out : ['已按上方筛选收起'];
  }, [relView, relStats]);

  const overview = useMemo(
    () => buildMethodOverview(view.methods.map((m) => ({ method: m, paper: view.papers.find((p) => p.id === m.paperId) })), view.relations),
    [view],
  );

  /**
   * 图例旁的一句实话：这份集合的关系实际覆盖了图例里的哪几档证据状态。
   * 之前画布把「三档线型里只有最弱的一档有数据」这件事藏起来了 —— 只陈述现状，不改判定。
   */
  const legendNote = useMemo(() => {
    const ST: [RelationEvidenceState, string][] = [
      ['explicit', '原文明示'],
      ['inferred', '系统推断'],
      ['candidate', '待核查'],
    ];
    const total = view.relations.length;
    if (!total) return '';
    const has = new Set(view.relations.filter((r) => r.type !== 'unclear').map((r) => r.evidenceState));
    const missing = ST.filter(([k]) => !has.has(k)).map(([, label]) => label);
    if (missing.length === ST.length) return `本案例 ${total} 条关系都还只是「关系不明确」，画布上暂不连线。`;
    if (!missing.length) return `本案例 ${total} 条关系覆盖图例里的三档证据状态。`;
    return `本案例 ${total} 条关系里暂未出现${missing.join('、')}。`;
  }, [view.relations]);

  /** 起点建议：优先取阅读路线的第 1 篇（真实数据），没有路线时退到集合里的第一个方法 */
  const startHint = useMemo(() => {
    const profileOf = (m: Method) =>
      buildMethodProfile(m, view.papers.find((p) => p.id === m.paperId), view.papers);
    const firstStep = plan?.steps?.[0];
    const byPlan = firstStep ? view.methods.find((m) => m.paperId === firstStep.paperId) : undefined;
    const pick = byPlan ?? view.methods[0];
    if (!pick) return null;
    const profile = profileOf(pick);
    return { id: pick.id, name: profile.shortName, fromPlan: Boolean(byPlan) };
  }, [plan, view]);

  const tabs: { id: SubView; name: string }[] = [
    { id: 'map', name: '方法地图' },
    { id: 'relations', name: '关系与比较' },
    { id: 'start', name: '阅读起点' },
  ];

  return (
    <div>
      {/* 页头：简短面包屑 → 主题与状态 → 三个视图入口与一个主操作 */}
      <div className="maphead">
        <Crumb
          trail={[
            ...(onGoLibrary ? [{ label: '论文集合', on: onGoLibrary }] : []),
            { label: `研究地图 · ${view.label}` },
          ]}
        />

        <div className="maphead-row">
          <div className="maphead-title">
            <h2>研究地图 · {view.label}</h2>
            <p className="maphead-theme">
              研究主题：{view.isCase ? corpusScope.meta.domain : '我自己上传的论文'}
              {view.isCase ? `（${corpusScope.meta.purpose}）` : '（只显示这份集合内的论文，不与案例混合）'}
            </p>
            <div className="maphead-meta">
              <Status kind={view.count ? 'info' : 'pending'}>{view.count} 篇论文</Status>
              <Status kind={view.methods.length ? 'ok' : 'pending'}>方法 {view.methods.length} 个</Status>
              {view.isCase && (
                <Status kind={presetCached ? 'cached' : 'live'}>{presetCached ? '缓存案例' : '实时分析'}</Status>
              )}
              {/* 关系状态行：总数 / 当前显示 / 隐藏数及原因 —— 首屏直接可见，不塞进折叠 */}
              <Status kind={relStats.visible ? 'info' : 'pending'}>
                关系 {relStats.total} 条 · 当前显示 {relStats.visible} 条
              </Status>
              {/*
                关系可见性三态（常驻可见，默认「全部」）。
                之前只有「待核查 / 关系不明确」两个默认关闭的开关，结果是首屏只画 2/10 条关系 ——
                现在默认全部显示，三态只是让用户按证据强弱收窄，而不是替他藏起来。
              */}
              <div className="relview" role="group" aria-label="关系可见性">
                {(
                  [
                    ['all', '全部', relStats.total, '显示全部关系，含待核查与「关系不明确」'],
                    ['usable', '可用', relStats.usable, '只看有可用证据状态的关系：原文明示 + 系统推断'],
                    [
                      'pending',
                      '待核查',
                      relStats.pending,
                      `还不能当结论用的关系：待核查 ${relStats.pendingCandidate} 条 + 关系不明确 ${relStats.pendingUnclear} 条`,
                    ],
                  ] as const
                ).map(([id, label, n, tip]) => (
                  <button
                    key={id}
                    className={`chip${relView === id ? ' on' : ''}`}
                    aria-pressed={relView === id}
                    title={tip}
                    onClick={() => setRelView(id)}
                  >
                    {label}
                    <span className="n">{n}</span>
                  </button>
                ))}
              </div>
              {relStats.visible < relStats.total && (
                <span className="small dim">
                  隐藏 {relStats.total - relStats.visible} 条：
                  {hiddenReasons.join('、')}
                </span>
              )}
              {onlyEvidence && <Status kind="pending">已开启「只看有证据关系」</Status>}
              <details className="fold" style={{ flex: '1 1 100%', marginTop: 6 }}>
                <summary>数据来源与统计（模型来源 · 缓存说明 · 字段统计）</summary>
                <div className="fold-body">
                  <p className="small" style={{ margin: '0 0 6px' }}>
                    {modelReady
                      ? '模型接口已配置：本页可做实时关系分析；每个结论仍按各自的证据状态标注。'
                      : '未配置模型：当前显示缓存案例（离线真实模型生成），界面处处标明来源，不伪装成实时分析。'}
                  </p>
                  <p className="small dim" style={{ margin: '0 0 8px' }}>
                    数据仅保存在本机浏览器；人工修正会保留且标明。
                  </p>
                  {overview.summaryLines.map((l, i) => (
                    <p key={i} className="small" style={{ margin: '0 0 4px' }}>
                      {l}
                    </p>
                  ))}
                  <p className="small dim" style={{ margin: 0 }}>
                    {overview.note}
                  </p>
                </div>
              </details>
            </div>
          </div>

          <div className="maphead-links">
            {/* 与「阅读起点」视图同名，避免出现两个相似但不同的说法 */}
            <button className="linkbtn" onClick={() => setSub('start')}>
              阅读起点 →
            </button>
            {mode === 'own' && (
              <button className="btn ghost sm" onClick={() => onModeChange('case')}>
                ← 回到{corpusScope.meta.label}
              </button>
            )}
            {mode === 'case' && view.count === 0 && (
              <button className="btn primary sm" onClick={onReloadCase} disabled={loading}>
                {loading ? '正在加载…' : '加载案例'}
              </button>
            )}
            {/* 筛选：只决定画布显示什么，不改任何数据 */}
            <div className="mapopts">
              <button className="btn ghost sm" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen}>
                筛选 ▾
              </button>
              {filtersOpen && (
                <div className="pop card tight" style={{ marginBottom: 0 }}>
                  <div className="pophead">筛选（只影响画布显示，不改数据）</div>
                  <p className="small dim" style={{ margin: '0 0 8px' }}>
                    关系可见性在页头常驻的
                    <b>「全部 / 可用 / 待核查」</b>
                    三态里切换；这里只做一次额外收窄。
                  </p>
                  <label className="small row" style={{ gap: 8 }}>
                    <input type="checkbox" checked={onlyEvidence} onChange={(e) => setOnlyEvidence(e.target.checked)} />
                    只看有证据关系
                    <span className="dim">
                      （当前范围 {relStats.withVerified} 条有已核验引文，现显示 {relStats.visible} 条）
                    </span>
                  </label>
                </div>
              )}
            </div>

            {/* 集合操作：加论文 / 重载案例 / 换案例（与筛选分开） */}
            <div className="mapopts">
              <button className="btn ghost sm" onClick={() => setSetsOpen((v) => !v)} aria-expanded={setsOpen}>
                集合操作 ▾
              </button>
              {setsOpen && (
                <div className="pop card tight" style={{ marginBottom: 0 }}>
                  <div className="pophead">集合操作（改变当前集合，不改结论判定规则）</div>
                  <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <button className="btn sm" onClick={onAddPapers}>
                      添加论文
                    </button>
                    <button className="btn ghost sm" onClick={onReloadCase} disabled={loading}>
                      重新加载案例
                    </button>
                    <button className="btn ghost sm" onClick={onSwitchCase}>
                      更换案例
                    </button>
                  </div>
                  {ownCount > 0 && (
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="small dim">另有 {ownCount} 篇我上传的论文（不在本案例地图里）</span>
                      <button className="btn ghost sm" onClick={() => onModeChange('own')}>
                        查看我上传的论文
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 三个视图是同一份关系数据的三个视角：显式切换条，且任何时候都能回到「方法地图」。
          之前这条切换条被删掉后，关系与比较 / 阅读起点 只剩两条隐式深链，进去也回不来。 */}
      <div className="mapviews" role="tablist" aria-label="研究地图视图">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={sub === t.id}
            className={`chip${sub === t.id ? ' on' : ''}`}
            onClick={() => setSub(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>

      {view.count === 0 ? (
        <div className="mapwork" style={{ display: 'grid', placeItems: 'center' }}>
          <div style={{ textAlign: 'center', padding: 24 }}>
            <p style={{ margin: '0 0 14px', color: 'var(--fg-2)' }}>
              {mode === 'own' ? '还没有自己上传的论文。' : '还没有论文。'}
            </p>
            <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
              {mode === 'case' && (
                <button className="btn primary" onClick={onReloadCase} disabled={loading}>
                  {loading ? '正在加载…' : '加载演示案例'}
                </button>
              )}
              <button className="btn" onClick={onAddPapers}>
                上传我的论文
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {sub === 'map' && (
            <MethodMap
              papers={view.papers}
              methods={view.methods}
              relations={view.relations}
              onOpenEvidence={onOpenEvidence}
              onOpenPair={(a, b) => {
                setPair([a, b]);
                setSub('relations');
              }}
              onCompareExperiments={(a, b) => {
                // 去重：绝不允许同一个 methodId 和自己比较
                const next = [...new Set([a, b].filter(Boolean))].slice(0, 2);
                setPair(next);
                setSub('relations');
              }}
              relationVisible={relVisible}
              legendNote={legendNote}
              startHint={startHint}
            />
          )}
          {sub === 'relations' && (
            /* 明细视图列出**全部**关系（不随画布的可见性筛选变动）——筛选只作用于画布，避免表格被静默删行 */
            <MapRelationsView
              papers={view.papers}
              methods={view.methods}
              relations={view.relations}
              onOpenEvidence={onOpenEvidence}
              onBackToMap={() => setSub('map')}
              initialPair={pair ?? undefined}
              requireChoice={pair !== null && pair.length === 0}
            />
          )}
          {sub === 'start' && (
            <MapStartView
              papers={view.papers}
              methods={view.methods}
              plan={plan}
              modelReady={modelReady}
              busy={busy}
              onCancel={onCancelGenerate}
              onGenerate={onGenerate}
              onOpenEvidence={onOpenEvidence}
              questions={questions}
              onBackToMap={() => setSub('map')}
            />
          )}
        </>
      )}
    </div>
  );
}
