import React, { useEffect, useMemo, useState } from 'react';
import type { Evidence, Method, Paper, ReadingPlan, Relation, UserProfile } from '../core/types';
import { relationsInScope, type CorpusKey, type CorpusScope, type ScopeMode } from '../core/corpus';
import { Crumb, Status } from './common';
import { buildMethodOverview } from '../core/grouping';
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
}: Props) {
  const [sub, setSub] = useState<SubView>('map');
  /**
   * 对照对的三态：
   *   null → 没指定（「联系与区别」自己挑一对值得看的）
   *   []   → 用户点了「去选择对照」，要求他自己选
   *   [a,b] → 明确的对照两端
   */
  const [pair, setPair] = useState<string[] | null>(null);
  const [showPending, setShowPending] = useState(false);
  const [showUnclear, setShowUnclear] = useState(false);
  /** 只看绑定了可核验引文的关系 */
  const [onlyEvidence, setOnlyEvidence] = useState(false);
  /** 筛选与集合操作是两个独立弹层（不再混在一个「选项」里） */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [setsOpen, setSetsOpen] = useState(false);
  const loading = corpusLoading === corpusScope.key;

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

  /** 关系计数：总数 / 当前筛选后可见数（与画布用完全相同的筛选条件） */
  const relStats = useMemo(() => {
    let visible = 0;
    let hiddenUnclear = 0;
    let hiddenPending = 0;
    let hiddenNoEvidence = 0;
    let withEvidence = 0;
    for (const r of view.relations) {
      if (r.evidence) withEvidence += 1;
      const show =
        (showUnclear || r.type !== 'unclear') &&
        (showPending || r.evidenceState !== 'candidate') &&
        (!onlyEvidence || Boolean(r.evidence));
      if (show) visible += 1;
      else if (onlyEvidence && !r.evidence) hiddenNoEvidence += 1;
      else if (!showUnclear && r.type === 'unclear') hiddenUnclear += 1;
      else if (!showPending && r.evidenceState === 'candidate') hiddenPending += 1;
    }
    return { total: view.relations.length, visible, hiddenUnclear, hiddenPending, hiddenNoEvidence, withEvidence };
  }, [view.relations, showPending, showUnclear, onlyEvidence]);

  const overview = useMemo(
    () => buildMethodOverview(view.methods.map((m) => ({ method: m, paper: view.papers.find((p) => p.id === m.paperId) })), view.relations),
    [view],
  );

  const tabs: { id: SubView; name: string }[] = [
    { id: 'map', name: '方法地图' },
    { id: 'relations', name: '联系与区别' },
    { id: 'start', name: '从哪里开始' },
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
              {relStats.visible < relStats.total && (
                <span className="small dim">
                  隐藏 {relStats.total - relStats.visible} 条：
                  {[
                    relStats.hiddenUnclear ? `关系不明确 ${relStats.hiddenUnclear} 条` : '',
                    relStats.hiddenPending ? `待核查 ${relStats.hiddenPending} 条` : '',
                    relStats.hiddenNoEvidence ? `无引文（只看有证据）${relStats.hiddenNoEvidence} 条` : '',
                  ]
                    .filter(Boolean)
                    .join('、')}
                  {' — 用「筛选」可以显示出来'}
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
            <button className="linkbtn" onClick={() => setSub('start')}>
              继续阅读路线 →
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
                  <label className="small row" style={{ gap: 8 }}>
                    <input type="checkbox" checked={onlyEvidence} onChange={(e) => setOnlyEvidence(e.target.checked)} />
                    只看有证据关系
                    <span className="dim">
                      （当前 {relStats.withEvidence} 条绑定了可核验引文，显示 {relStats.visible} 条）
                    </span>
                  </label>
                  <label className="small row" style={{ gap: 8, marginTop: 8 }}>
                    <input type="checkbox" checked={showPending} onChange={(e) => setShowPending(e.target.checked)} />
                    显示待核查关系
                    <span className="dim">
                      （{view.relations.filter((r) => r.evidenceState === 'candidate' && r.type !== 'unclear').length} 条）
                    </span>
                  </label>
                  <label className="small row" style={{ gap: 8, marginTop: 8 }}>
                    <input type="checkbox" checked={showUnclear} onChange={(e) => setShowUnclear(e.target.checked)} />
                    显示「关系不明确」的配对
                    <span className="dim">（{view.relations.filter((r) => r.type === 'unclear').length} 对）</span>
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
              showPending={showPending}
              showUnclear={showUnclear}
              onlyEvidence={onlyEvidence}
            />
          )}
          {sub === 'relations' && (
            <MapRelationsView
              papers={view.papers}
              methods={view.methods}
              relations={view.relations}
              onOpenEvidence={onOpenEvidence}
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
            />
          )}
        </>
      )}
    </div>
  );
}
