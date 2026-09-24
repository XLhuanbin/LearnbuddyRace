import React, { useEffect, useMemo, useState } from 'react';
import type { Evidence, Method, Paper, ReadingPlan, Relation, UserProfile } from '../core/types';
import type { CorpusKey, CorpusScope } from '../core/corpus';
import { Crumb, Status } from './common';
import { buildMethodOverview } from '../core/grouping';
import { MethodMap } from './MethodMap';
import { MapRelationsView } from './MapRelationsView';
import { MapStartView } from './MapStartView';

type SubView = 'map' | 'relations' | 'start';
export type ScopeMode = 'case' | 'own';

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
  onOpenEvidence,
  onAddPapers,
  onSwitchCase,
  onReloadCase,
  onGoLibrary,
}: Props) {
  const [sub, setSub] = useState<SubView>('map');
  const [pair, setPair] = useState<string[]>([]);
  const [showPending, setShowPending] = useState(false);
  const [showUnclear, setShowUnclear] = useState(false);
  /** 只看绑定了可核验引文的关系 */
  const [onlyEvidence, setOnlyEvidence] = useState(false);
  const [optsOpen, setOptsOpen] = useState(false);
  const loading = corpusLoading === corpusScope.key;

  /** 当前集合的数据：案例 = 当前语料预置；我的论文 = 用户自传 */
  const view = useMemo(() => {
    if (mode === 'own') {
      const ownMethods = corpusScope.ownMethods;
      const ids = new Set(ownMethods.map((m) => m.id));
      return {
        papers: corpusScope.ownPapers,
        methods: ownMethods,
        relations: relations.filter((r) => ids.has(r.fromMethodId) && ids.has(r.toMethodId)),
        label: '我上传的论文',
        count: corpusScope.ownPapers.length,
        isCase: false,
      };
    }
    return {
      papers: corpusScope.presetPapers,
      methods: corpusScope.presetMethods,
      relations,
      label: corpusScope.meta.label,
      count: corpusScope.presetPapers.length,
      isCase: true,
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
              {view.isCase && (
                <Status kind={presetCached ? 'cached' : 'live'}>{presetCached ? '缓存案例' : '实时分析'}</Status>
              )}
              <Status kind={view.methods.length ? 'ok' : 'pending'}>方法 {view.methods.length} 个</Status>
              <Status kind={relStats.visible ? 'info' : 'pending'}>
                关系 {relStats.total} 条 · 当前显示 {relStats.visible} 条
              </Status>
              {relStats.visible < relStats.total && (
                <span className="small dim">
                  （隐藏：关系不明确 {relStats.hiddenUnclear} · 待核查 {relStats.hiddenPending}
                  {relStats.hiddenNoEvidence ? ` · 无引文 ${relStats.hiddenNoEvidence}` : ''}）
                </span>
              )}
              {onlyEvidence && <Status kind="pending">已开启「只看有证据关系」</Status>}
              <span className="small dim">
                {modelReady
                  ? '模型接口已配置；每个结论仍按各自的证据状态标注。'
                  : '未配置模型：当前显示缓存案例（离线真实模型生成），界面处处标明来源。'}
              </span>
            </div>
          </div>

          <div className="maphead-actions">
            <div className="views" role="tablist" aria-label="研究地图视图">
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
            <button className="btn primary sm" onClick={() => setSub('start')}>
              按阅读路线继续 →
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
            <div className="mapopts">
              <button className="btn ghost sm" onClick={() => setOptsOpen((v) => !v)} aria-expanded={optsOpen}>
                选项 ▾
              </button>
              {optsOpen && (
                <div className="pop card tight" style={{ marginBottom: 0 }}>
                  <div className="row" style={{ gap: 8, marginBottom: 8 }}>
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
                  <hr />
                  <label className="small row" style={{ gap: 8 }}>
                    <input type="checkbox" checked={onlyEvidence} onChange={(e) => setOnlyEvidence(e.target.checked)} />
                    只看有证据关系
                    <span className="dim">
                      （当前 {relStats.withEvidence} 条绑定了可核验引文，显示 {relStats.visible} 条）
                    </span>
                  </label>
                  <hr />
                  <label className="small row" style={{ gap: 8 }}>
                    <input type="checkbox" checked={showPending} onChange={(e) => setShowPending(e.target.checked)} />
                    显示待核查关系
                    <span className="dim">（{relations.filter((r) => r.evidenceState === 'candidate' && r.type !== 'unclear').length} 条）</span>
                  </label>
                  <label className="small row" style={{ gap: 8, marginTop: 6 }}>
                    <input type="checkbox" checked={showUnclear} onChange={(e) => setShowUnclear(e.target.checked)} />
                    显示「关系不明确」的配对
                    <span className="dim">（{relations.filter((r) => r.type === 'unclear').length} 对）</span>
                  </label>
                  <hr />
                  {ownCount > 0 && (
                    <>
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span className="small dim">另有 {ownCount} 篇我上传的论文（不在本案例地图里）</span>
                        <button className="btn ghost sm" onClick={() => onModeChange('own')}>
                          查看我上传的论文
                        </button>
                      </div>
                      <hr />
                    </>
                  )}
                  <details className="fold">
                    <summary>数据来源与统计</summary>
                    <div className="fold-body">
                      <p className="small">
                        {modelReady ? '模型接口已配置，可做实时分析。' : '未配置模型：本案例为缓存结果（离线真实模型生成），界面处处标明。'}
                      </p>
                      <p className="small dim">数据仅保存在本机浏览器；人工修正会保留且标明。</p>
                      {overview.summaryLines.map((l, i) => (
                        <p key={i} className="small">
                          {l}
                        </p>
                      ))}
                      <p className="small dim">{overview.note}</p>
                    </div>
                  </details>
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
                setPair([a, b].filter(Boolean).slice(0, 2));
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
              initialPair={pair}
            />
          )}
          {sub === 'start' && (
            <MapStartView
              papers={view.papers}
              methods={view.methods}
              plan={plan}
              modelReady={modelReady}
              busy={busy}
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
