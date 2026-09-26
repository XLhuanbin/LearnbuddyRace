import React, { useMemo, useState } from 'react';
import type { Evidence, Method, Paper, Relation, RelationEvidenceState, RelationType } from '../core/types';
import { effectiveField, effectiveFieldValue } from '../core/effective';
import { buildMethodProfile } from '../core/grouping';
import { RELATION_LABELS, RELATION_STATE_DESC, RELATION_STATE_LABELS } from '../core/types';
import { Status, Banner, Tag } from './common';

const STATE_STYLE: Record<RelationEvidenceState, { color: string; dash?: string; label: string }> = {
  explicit: { color: '#2f6b4a', dash: undefined, label: RELATION_STATE_LABELS.explicit },
  inferred: { color: '#be6a1e', dash: '6 4', label: RELATION_STATE_LABELS.inferred },
  candidate: { color: '#8a8378', dash: '2 4', label: RELATION_STATE_LABELS.candidate },
};

interface Node {
  id: string;
  method: Method;
  paper?: Paper;
  /** 旧字段：保留为完整标题（放在第二行与 title，不再当主标） */
  label: string;
  /** 稳定短名（ResNet / ViT …）与年份：主标就用这个，避免长标题被截断成不可识别 */
  shortName: string;
  year?: number;
  x: number;
  y: number;
}

function layout(methods: Method[], papers: Paper[], width: number): { nodes: Node[]; height: number } {
  const paperById = new Map(papers.map((p) => [p.id, p]));
  const groups = new Map<number, Method[]>();
  const noYear: Method[] = [];

  for (const m of methods) {
    const y = paperById.get(m.paperId)?.year;
    if (!y) {
      noYear.push(m);
      continue;
    }
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y)!.push(m);
  }

  const years = [...groups.keys()].sort((a, b) => a - b);
  const cols = years.length + (noYear.length ? 1 : 0);
  const colGap = cols > 1 ? (width - 200) / (cols - 1) : 0;
  const nodes: Node[] = [];
  let height = 120;

  const place = (list: Method[], ci: number) => {
    const x = cols > 1 ? 100 + ci * colGap : width / 2;
    list.forEach((m, ri) => {
      const y = 80 + ri * 104;
      height = Math.max(height, y + 90);
      const paper = paperById.get(m.paperId);
      nodes.push({
        id: m.id,
        method: m,
        paper,
        label: paper?.title ?? m.paperId,
        // 主标用稳定短名 + 年份；完整标题放第二行与 title，不做字符截断
        shortName: buildMethodProfile(m, paper, papers).shortName,
        year: paper?.year,
        x,
        y,
      });
    });
  };

  years.forEach((y, i) => place(groups.get(y)!, i));
  if (noYear.length) place(noYear, years.length);

  return { nodes, height };
}

export function GraphView({
  papers,
  methods,
  relations,
  onGenerate,
  onCancel,
  onOpenEvidence,
  busy,
  onDeleteRelation,
  onUpdateRelation,
  onAddRelation,
}: {
  papers: Paper[];
  methods: Method[];
  relations: Relation[];
  onGenerate: () => void;
  /** 停止等待（只停止本地等待，不保证服务端已停止计算） */
  onCancel?: () => void;
  onOpenEvidence: (e: Evidence, label: string, paper?: Paper) => void;
  busy: boolean;
  onDeleteRelation: (id: string) => void;
  onUpdateRelation: (id: string, patch: Partial<Relation>) => void;
  onAddRelation: (r: Relation) => void;
}) {
  const WIDTH = 1060;
  const { nodes, height } = useMemo(() => layout(methods, papers, WIDTH), [methods, papers]);
  const [active, setActive] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ type: RelationType; evidenceState: RelationEvidenceState; rationale: string }>({
    type: 'unclear',
    evidenceState: 'candidate',
    rationale: '',
  });
  const [adding, setAdding] = useState(false);
  const [newRel, setNewRel] = useState<{ from: string; to: string; type: RelationType; evidenceState: RelationEvidenceState; rationale: string }>({
    from: '',
    to: '',
    type: 'similar',
    evidenceState: 'candidate',
    rationale: '',
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  /** 键盘焦点还原：关闭详情后回到原来那条关系/节点上 */
  const lastFocus = React.useRef<SVGGElement | null>(null);
  const edgeRefs = React.useRef<Record<string, SVGGElement | null>>({});
  const nodeRefs = React.useRef<Record<string, SVGGElement | null>>({});
  const nameOfId = (id: string) => nodeById.get(id)?.shortName ?? id;
  const count = (s: RelationEvidenceState) => relations.filter((r) => r.evidenceState === s).length;
  const activeRel = relations.find((r) => r.id === active);

  const yearsByColumn = [...new Set(nodes.map((n) => n.paper?.year))].sort((a, b) => (a ?? 0) - (b ?? 0));

  const startEdit = (r: Relation) => {
    setDraft({ type: r.type, evidenceState: r.evidenceState, rationale: r.rationale ?? '' });
    setEditing(true);
  };

  return (
    <div>
      <h2 className="page">方法关系</h2>
      <p className="lead">
        先看「方法演进摘要」快速建立印象，再看关系图核对依据。摘要文字来自各篇论文已抽取的核心思路，
        每条都标注了它的证据状态；关系图按证据强度分三档：<strong>原文明示</strong>（原文有明确陈述且引文已定位）、
        <strong>系统推断</strong>（原文没明说，依据内容推断并给出理由）、<strong>待核查</strong>（依据不足）。本页不使用未校准的置信度百分比，也不把关键词相似当作技术继承。
      </p>

      <div className="card">
        <div className="row between" style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>方法演进摘要</strong>
          <span className="small dim">文字取自各论文「核心思路」字段；状态为字段证据状态</span>
        </div>
        <div className="methodsum">
          {methods.map((m) => {
            const paper = papers.find((p) => p.id === m.paperId);
            const core = effectiveField(m, 'coreIdea');
            return (
              <div className="msumitem" key={m.id}>
                <div className="who">{paper?.title?.split(/[:：]/)[0]?.slice(0, 18) ?? m.paperId}</div>
                <div className="what">
                  {(core?.value ?? '').slice(0, 200) || '未提取到核心思路'}
                  {core?.evidence && (
                    <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => onOpenEvidence(core.evidence!, '核心思路')}>
                      查看原文
                    </button>
                  )}
                </div>
                <div className="stat">
                  <Status kind={core?.status === 'verified' ? 'ok' : core?.status === 'missing' ? 'bad' : 'pending'}>
                    {core?.status === 'verified' ? '已核验' : core?.status === 'missing' ? '缺失' : '待核查'}
                  </Status>
                </div>
              </div>
            );
          })}
          {methods.length === 0 && <div className="small dim">加载语料后这里会显示每篇论文的一句话方法说明。</div>}
        </div>
      </div>

      <h3 style={{ margin: '22px 0 8px' }}>关系图与依据</h3>

      <div className="card tight">
        <div className="row">
          <button className="btn primary" disabled={busy || methods.length < 2} onClick={onGenerate}>
            {busy ? '分析中…' : relations.length ? '重新分析关系' : '分析方法关系'}
          </button>
          {busy && onCancel && (
            <button className="btn ghost" onClick={onCancel}>
              停止等待
            </button>
          )}
          <button className="btn" disabled={methods.length < 2} onClick={() => setAdding((v) => !v)}>
            人工添加关系
          </button>
          <span className="small dim">需要至少 2 篇已完成抽取的论文（当前 {methods.length} 篇）</span>
        </div>

        {adding && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div className="grid2">
              <div>
                <label className="f">起点（被基于/被改进）</label>
                <select className="f" value={newRel.from} onChange={(e) => setNewRel({ ...newRel, from: e.target.value })}>
                  <option value="">请选择</option>
                  {methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {(papers.find((p) => p.id === m.paperId)?.title ?? m.paperId).slice(0, 40)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="f">终点（新方法）</label>
                <select className="f" value={newRel.to} onChange={(e) => setNewRel({ ...newRel, to: e.target.value })}>
                  <option value="">请选择</option>
                  {methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {(papers.find((p) => p.id === m.paperId)?.title ?? m.paperId).slice(0, 40)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="f">关系类型</label>
                <select className="f" value={newRel.type} onChange={(e) => setNewRel({ ...newRel, type: e.target.value as RelationType })}>
                  {Object.entries(RELATION_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="f">可信度（由你填写依据）</label>
                <select
                  className="f"
                  value={newRel.evidenceState}
                  onChange={(e) => setNewRel({ ...newRel, evidenceState: e.target.value as RelationEvidenceState })}
                >
                  {Object.entries(RELATION_STATE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="f" style={{ marginTop: 10 }}>
              依据 / 理由（人工添加的关系必须写清依据）
            </label>
            <textarea className="f" rows={2} value={newRel.rationale} onChange={(e) => setNewRel({ ...newRel, rationale: e.target.value })} />
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn primary sm"
                disabled={!newRel.from || !newRel.to || newRel.from === newRel.to || newRel.rationale.trim().length < 6}
                onClick={() => {
                  onAddRelation({
                    id: `r_manual_${Date.now()}`,
                    fromMethodId: newRel.from,
                    toMethodId: newRel.to,
                    type: newRel.type,
                    evidenceState: newRel.evidenceState,
                    rationale: newRel.rationale.trim(),
                    userEdited: true,
                  });
                  setAdding(false);
                  setNewRel({ from: '', to: '', type: 'similar', evidenceState: 'candidate', rationale: '' });
                }}
              >
                添加并标记为人工修正
              </button>
              <span className="small dim">人工添加的关系会醒目标注，且不会被自动分析覆盖</span>
            </div>
          </div>
        )}
      </div>

      {methods.length < 2 && <Banner kind="info">先完成至少两篇论文的方法抽取，再生成关系图。</Banner>}

      {relations.length === 0 && methods.length >= 2 && (
        <Banner kind="info">尚未生成关系。系统不会仅凭年份或关键词连边，因此需要一次模型分析才能得到候选关系。</Banner>
      )}

      {methods.length >= 2 && (
        <div className="graph-wrap">
          <svg viewBox={`0 0 ${WIDTH} ${height}`} style={{ width: '100%', height: 'auto', minWidth: 760 }}>
            <defs>
              {(['explicit', 'inferred', 'candidate'] as RelationEvidenceState[]).map((s) => (
                <marker key={s} id={`arrow-${s}`} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill={STATE_STYLE[s].color} />
                </marker>
              ))}
            </defs>

            {yearsByColumn.map((y, i) => {
              const col = nodes.filter((n) => n.paper?.year === y);
              if (!col.length) return null;
              return (
                <text key={i} x={col[0].x} y={34} textAnchor="middle" fill="#7b8798" fontSize="13" fontFamily="monospace">
                  {y ?? '年份未识别'}
                </text>
              );
            })}

            {relations.map((r) => {
              const a = nodeById.get(r.fromMethodId);
              const b = nodeById.get(r.toMethodId);
              if (!a || !b) return null;
              const style = STATE_STYLE[r.evidenceState];
              const sameCol = Math.abs(b.x - a.x) < 1;
              const x1 = a.x + (sameCol ? 62 : a.x < b.x ? 70 : -70);
              const y1 = a.y;
              const x2 = b.x + (sameCol ? 62 : a.x < b.x ? -70 : 70);
              const y2 = b.y;
              const cx = (x1 + x2) / 2 + (sameCol ? 130 : 0);
              const cy = (y1 + y2) / 2;
              const midX = (x1 + x2) / 2;
              const midY = (y1 + y2) / 2;
              const isActive = active === r.id;
              return (
                <g
                  key={r.id}
                  ref={(el) => {
                    edgeRefs.current[r.id] = el;
                  }}
                  className="grel"
                  role="button"
                  tabIndex={0}
                  aria-label={`${nameOfId(r.fromMethodId)} → ${nameOfId(r.toMethodId)}：${RELATION_LABELS[r.type]}（${RELATION_STATE_LABELS[r.evidenceState]}）`}
                  aria-pressed={isActive}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    lastFocus.current = edgeRefs.current[r.id];
                    setActive(isActive ? null : r.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                      e.preventDefault();
                      lastFocus.current = edgeRefs.current[r.id];
                      setActive(isActive ? null : r.id);
                    }
                  }}
                >
                  <path
                    d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                    fill="none"
                    stroke={style.color}
                    strokeWidth={isActive ? 2.6 : 1.7}
                    strokeDasharray={style.dash}
                    markerEnd={`url(#arrow-${r.evidenceState})`}
                    opacity={isActive || !active ? 1 : 0.32}
                  />
                  <text x={midX} y={midY - 6} textAnchor="middle" fill={style.color} fontSize="11" opacity={isActive || !active ? 0.95 : 0.3}>
                    {RELATION_LABELS[r.type]}
                    {r.userEdited ? ' ·人工' : ''}
                  </text>
                </g>
              );
            })}

            {nodes.map((n) => {
              const missing = !effectiveFieldValue(n.method, 'methodName');
              const isEndpoint = activeRel && (activeRel.fromMethodId === n.id || activeRel.toMethodId === n.id);
              return (
                <g
                  key={n.id}
                  ref={(el) => {
                    nodeRefs.current[n.id] = el;
                  }}
                  className="gnode"
                  role="button"
                  tabIndex={0}
                  aria-label={`${n.shortName}${n.year ? ` · ${n.year}` : ''}：${n.label}`}
                >
                  <rect
                    x={n.x - 70}
                    y={n.y - 30}
                    width={140}
                    height={60}
                    rx={9}
                    fill="#ffffff"
                    stroke={isEndpoint ? '#5aa9ff' : missing ? '#d3d9e4' : '#4f46e5'}
                    strokeWidth={isEndpoint ? 2 : 1.4}
                  />
                  <foreignObject x={n.x - 64} y={n.y - 24} width={128} height={48}>
                    <div
                      style={{
                        fontSize: 11.5,
                        lineHeight: 1.35,
                        color: 'var(--fg)',
                        textAlign: 'center',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        gap: 2,
                      } as React.CSSProperties}
                      title={n.label}
                    >
                      {/* 第一行：稳定短名 · 年份（可识别） */}
                      <div style={{ fontWeight: 650, fontSize: 12 }}>
                        {n.shortName}
                        {n.year ? ` · ${n.year}` : ''}
                      </div>
                      {/* 第二行：完整标题（两行截断 + 悬停看全，不再用固定字符数硬切） */}
                      <div
                        style={{
                          fontSize: 10.5,
                          color: 'var(--fg-3)',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        } as React.CSSProperties}
                      >
                        {n.label}
                      </div>
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      <div className="legend">
        {(['explicit', 'inferred', 'candidate'] as RelationEvidenceState[]).map((s) => (
          <span key={s}>
            <svg width="34" height="10">
              <line x1="0" y1="5" x2="30" y2="5" stroke={STATE_STYLE[s].color} strokeWidth="2" strokeDasharray={STATE_STYLE[s].dash} />
            </svg>{' '}
            {STATE_STYLE[s].label}（{count(s)}）
          </span>
        ))}
        <span className="dim">点击一条关系查看来源、支持片段与理由，并可人工修正</span>
      </div>

      {activeRel && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <Tag kind={activeRel.evidenceState === 'explicit' ? 'ok' : activeRel.evidenceState === 'inferred' ? 'warn' : ''}>
              {RELATION_STATE_LABELS[activeRel.evidenceState]}
            </Tag>
            <Tag>{RELATION_LABELS[activeRel.type]}</Tag>
            {activeRel.userEdited && <Tag kind="info">已人工修正</Tag>}
            <span className="small dim">
              {nodeById.get(activeRel.fromMethodId)?.label} → {nodeById.get(activeRel.toMethodId)?.label}
            </span>
            <span className="spacer" />
            <button className="btn ghost sm" onClick={() => startEdit(activeRel)}>
              修正
            </button>
            <button className="btn ghost sm" onClick={() => onDeleteRelation(activeRel.id)}>
              删除
            </button>
            <button
              className="btn ghost sm"
              onClick={() => {
                // 关闭详情后把键盘焦点还给原来那条连线
                const back = lastFocus.current;
                setActive(null);
                setEditing(false);
                if (back) window.setTimeout(() => back.focus(), 0);
              }}
            >
              关闭
            </button>
          </div>

          <p className="small dim" style={{ marginTop: 0 }}>
            {RELATION_STATE_DESC[activeRel.evidenceState]}
          </p>

          {editing ? (
            <div>
              <div className="grid2">
                <div>
                  <label className="f">关系类型</label>
                  <select
                    className="f"
                    value={draft.type}
                    onChange={(e) => setDraft({ ...draft, type: e.target.value as RelationType })}
                  >
                    {Object.entries(RELATION_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="f">可信度</label>
                  <select
                    className="f"
                    value={draft.evidenceState}
                    onChange={(e) => setDraft({ ...draft, evidenceState: e.target.value as RelationEvidenceState })}
                  >
                    {Object.entries(RELATION_STATE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="f" style={{ marginTop: 10 }}>
                依据 / 理由
              </label>
              <textarea className="f" rows={3} value={draft.rationale} onChange={(e) => setDraft({ ...draft, rationale: e.target.value })} />
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  className="btn primary sm"
                  onClick={() => {
                    onUpdateRelation(activeRel.id, {
                      type: draft.type,
                      evidenceState: draft.evidenceState,
                      rationale: draft.rationale,
                      userEdited: true,
                    });
                    setEditing(false);
                  }}
                >
                  保存修正
                </button>
                <button
                  className="btn sm"
                  disabled={!activeRel.aiOriginal}
                  onClick={() => {
                    if (!activeRel.aiOriginal) return;
                    onUpdateRelation(activeRel.id, {
                      type: activeRel.aiOriginal.type,
                      evidenceState: activeRel.aiOriginal.evidenceState,
                      rationale: activeRel.aiOriginal.rationale,
                      userEdited: false,
                    });
                    setEditing(false);
                  }}
                >
                  恢复 AI 原判定
                </button>
                <span className="small dim">AI 原判定会保留在记录中</span>
              </div>
            </div>
          ) : (
            <>
              {activeRel.aiOriginal && activeRel.userEdited && (
                <div className="small" style={{ marginBottom: 8 }}>
                  <Tag kind="info">AI 原判定</Tag> {RELATION_LABELS[activeRel.aiOriginal.type]} ·{' '}
                  {RELATION_STATE_LABELS[activeRel.aiOriginal.evidenceState]}
                  {activeRel.aiOriginal.rationale ? ` —— ${activeRel.aiOriginal.rationale.slice(0, 160)}` : ''}
                </div>
              )}

              {activeRel.evidence ? (
                <div>
                  <div className="small dim" style={{ marginBottom: 5 }}>
                    支持片段（来源：{papers.find((p) => p.id === activeRel.evidence!.paperId)?.title ?? activeRel.evidence.paperId}
                    {activeRel.evidence.page ? `，p.${activeRel.evidence.page}` : '，页码无法确定'}）
                  </div>
                  <div className="ev-quote" style={activeRel.evidence.verified ? undefined : { borderLeftColor: 'var(--bad)' }}>
                    {activeRel.evidence.quote}
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    {activeRel.evidence.verified ? (
                      <Tag kind="ok">该片段已在原文中定位</Tag>
                    ) : (
                      <Tag kind="bad">该引文未通过定位校验</Tag>
                    )}
                    <button
                      className="btn sm"
                      onClick={() =>
                        onOpenEvidence(
                          activeRel.evidence!,
                          '方法关系支持片段',
                          papers.find((p) => p.id === activeRel.evidence!.paperId),
                        )
                      }
                    >
                      查看完整上下文
                    </button>
                  </div>
                </div>
              ) : (
                <Banner kind="warn">该关系没有原文片段支持，属于推断或待核查关系，请以 rationale 中的理由为准。</Banner>
              )}

              <div style={{ marginTop: 12 }}>
                <div className="small dim" style={{ marginBottom: 4 }}>
                  AI 判断理由
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.8 }}>{activeRel.rationale || '（无）'}</div>
              </div>

              {activeRel.evidenceAssessment && (
                <div style={{ marginTop: 12 }}>
                  <div className="small dim" style={{ marginBottom: 4 }}>
                    程序对「该证据是否足以认证此关系」的判定
                  </div>
                  <div className="small" style={{ lineHeight: 1.8 }}>
                    {activeRel.evidenceAssessment}
                  </div>
                  <p className="small dim" style={{ margin: '4px 0 0' }}>
                    判定标准：原文明示必须同时满足「引文指名被继承方法（含简称/全称别名）」与「有继承/改进措辞或引用标记」。
                    只出现引用标记、或只提到更泛的技术名称（如 Transformer），不足以认证具体端点。
                  </p>
                </div>
              )}

              {activeRel.evidenceList && activeRel.evidenceList.length > 1 && (
                <div style={{ marginTop: 12 }}>
                  <div className="small dim" style={{ marginBottom: 4 }}>
                    本次已定位到的其他片段（{activeRel.evidenceList.length - 1} 条，供人工判断）
                  </div>
                  {activeRel.evidenceList
                    .filter((e) => e.quote !== activeRel.evidence?.quote)
                    .map((e, i) => (
                      <div key={i} style={{ marginBottom: 8 }}>
                        <div className="ev-quote" style={{ fontSize: 12.5 }}>
                          {e.quote}
                        </div>
                        <div className="row" style={{ marginTop: 4 }}>
                          <Tag>
                            {papers.find((p) => p.id === e.paperId)?.title?.slice(0, 30) ?? e.paperId}
                            {e.page ? ` · p.${e.page}` : ''}
                          </Tag>
                          <button
                            className="btn ghost sm"
                            onClick={() => onOpenEvidence(e, '方法关系：其他片段', papers.find((p) => p.id === e.paperId))}
                          >
                            查看上下文
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {activeRel.stateAdjusted && activeRel.stateAdjusted.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="small dim" style={{ marginBottom: 4 }}>
                    程序校验对可信度的调整
                  </div>
                  {activeRel.stateAdjusted.map((a, i) => (
                    <div key={i} className="small" style={{ color: 'var(--warn)' }}>
                      {RELATION_STATE_LABELS[a.from]} → {RELATION_STATE_LABELS[a.to]}：{a.reason}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
