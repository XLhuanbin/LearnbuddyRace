import React, { useEffect, useMemo, useState } from 'react';
import type { Evidence, Method, Paper, ReadingPlan, Relation, UserProfile } from '../core/types';
import type { CorpusKey, CorpusScope } from '../core/corpus';
import { Status } from './common';
import { buildMethodOverview } from '../core/grouping';
import { MethodMap } from './MethodMap';
import { MapRelationsView } from './MapRelationsView';
import { MapStartView } from './MapStartView';

type SubView = 'map' | 'relations' | 'start';
type ScopeMode = 'case' | 'own';

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
  onGenerate: (profile: UserProfile) => void;
  onOpenEvidence: (ev: Evidence) => void;
  onAddPapers: () => void;
  onSwitchCase: () => void;
  onReloadCase: () => void;
}

/**
 * 研究地图工作区：一条紧凑工具栏 + 一整块画布 + 浮层详情。
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
  onGenerate,
  onOpenEvidence,
  onAddPapers,
  onSwitchCase,
  onReloadCase,
}: Props) {
  const [sub, setSub] = useState<SubView>('map');
  const [pair, setPair] = useState<string[]>([]);
  const [mode, setMode] = useState<ScopeMode>('case');
  const [showPending, setShowPending] = useState(false);
  const [showUnclear, setShowUnclear] = useState(false);
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
      };
    }
    return {
      papers: corpusScope.presetPapers,
      methods: corpusScope.presetMethods,
      relations,
      label: corpusScope.meta.label,
      count: corpusScope.presetPapers.length,
    };
  }, [mode, corpusScope, relations]);

  const ownCount = corpusScope.ownPapers.length;

  /** 案例还没加载、但用户已有自己上传的论文时，直接显示「我上传的论文」 */
  useEffect(() => {
    if (mode === 'case' && corpusScope.presetPapers.length === 0 && ownCount > 0) setMode('own');
  }, [mode, corpusScope.presetPapers.length, ownCount]);

  const presetCached = view.papers.some((p) => p.cached);

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
      {/* 紧凑工具栏：集合名 + 视图切换 + 一个主操作 */}
      <div className="maptoolbar">
        <div className="t">
          <b>研究地图 · {view.label}</b>
          <span className="cnt">
            {view.count} 篇{presetCached && mode === 'case' ? ' · 缓存案例' : view.count ? ' · 实时' : ''}
          </span>
        </div>
        <div className="views">
          {tabs.map((t) => (
            <button key={t.id} className={`chip${sub === t.id ? ' on' : ''}`} onClick={() => setSub(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {mode === 'own' && (
          <button className="btn ghost sm" onClick={() => setMode('case')}>
            ← 回到{corpusScope.meta.label}
          </button>
        )}
        {mode === 'case' && view.count === 0 && (
          <button className="btn primary sm" onClick={onReloadCase} disabled={loading}>
            {loading ? '正在加载…' : '加载案例'}
          </button>
        )}
        <button className="btn sm" onClick={onAddPapers}>
          添加论文
        </button>
        <div className="mapopts">
          <button className="btn ghost sm" onClick={() => setOptsOpen((v) => !v)} aria-expanded={optsOpen}>
            选项 ▾
          </button>
          {optsOpen && (
            <div className="pop card tight" style={{ marginBottom: 0 }}>
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
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn ghost sm" onClick={onReloadCase} disabled={loading}>
                  重新加载案例
                </button>
                <button className="btn ghost sm" onClick={onSwitchCase}>
                  更换案例
                </button>
              </div>
              {ownCount > 0 && (
                <>
                  <hr />
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="small dim">另有 {ownCount} 篇我上传的论文（不在本案例地图里）</span>
                    <button className="btn ghost sm" onClick={() => setMode('own')}>
                      查看我上传的论文
                    </button>
                  </div>
                </>
              )}
              <hr />
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
