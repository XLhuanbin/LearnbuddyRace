import React, { useState } from 'react';
import type { Evidence, Method, Paper, ReadingPlan, UserProfile } from '../core/types';
import {
  EXECUTION_STAGE_LABELS,
  EXECUTION_STATUS_LABELS,
  GOAL_FIT_LABELS,
  TRAINING_STAGE_LABELS,
} from '../core/types';
import { Banner, Crumb, PageHead, SectionHead, Status, Tag, downloadText } from './common';
import { buildMethodProfile, shortContribution } from '../core/grouping';

const FIT_TEXT = {
  suitable: '条件匹配',
  conditional: '有条件可用',
  unknown: '无法判断',
} as const;
const FIT_KIND = { suitable: 'ok', conditional: 'warn', unknown: 'pending' } as const;

/**
 * 阅读路线：一条连续的纵向路径（左边只有编号与轨道，右边每一步只有一个内容区）。
 *
 * 每一步首屏只显示：方法名称 / 为什么先读它 / 重点看什么 / 下一步；
 * 原文依据、阶段词与行动入口收在展开里，默认只展开第一步。
 * 未配置模型时必须写明「示例路线，尚未根据用户偏好个性化。」，不伪装成个性化推荐。
 * 候选方法与执行可行性放在路径之后，页面不做排名、不做因果结论。
 */
export function DecisionView({
  papers,
  methods,
  plan,
  busy,
  modelReady,
  onGenerate,
  onUseSample,
  sampleProfile,
  onOpenEvidence,
  onGo,
  onOpenPaper,
}: {
  papers: Paper[];
  methods: Method[];
  plan?: ReadingPlan;
  busy: boolean;
  /** 未配置模型时只能看示例路线：入口与结果都必须这么叫 */
  modelReady: boolean;
  onGenerate: (p: UserProfile) => void;
  onUseSample: () => void;
  sampleProfile?: UserProfile;
  onOpenEvidence: (e: Evidence, label: string, paper?: Paper) => void;
  /** 打开论文集合 / 研究地图 */
  onGo: (t: 'library' | 'map') => void;
  /** 打开某一篇（跳到论文集合并聚焦） */
  onOpenPaper: (paperId: string) => void;
}) {
  const [profile, setProfile] = useState<UserProfile>({
    background: '计算机相关专业，上过机器学习课，能读懂 Transformer 基本结构',
    interest: '想了解相关方法的训练与评测思路',
    time: '两周，每天约 2 小时',
    compute: '只有一台笔记本，无 GPU 集群',
    goal: '选一个能上手复现的小方向做课程项目',
  });
  const [lastProfile, setLastProfile] = useState<UserProfile | undefined>();
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [showAllReasons, setShowAllReasons] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  /** 路线图里当前选中的步骤（一次只展开一个） */
  const [graphStep, setGraphStep] = useState<number | null>(null);

  const paperById = new Map(papers.map((p) => [p.id, p]));
  const methodById = new Map(methods.map((m) => [m.id, m]));
  const profileOf = (paperId: string) => {
    const m = methods.find((x) => x.paperId === paperId);
    return m ? buildMethodProfile(m, paperById.get(paperId), papers) : undefined;
  };
  const set = (k: keyof UserProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setProfile({ ...profile, [k]: e.target.value });
  const pad2 = (n: number) => String(n).padStart(2, '0');

  /** 阶段词只取真实数据（方法家族 + 首个已抽取的技术策略），不发明阶段结论 */
  const stageWordOf = (paperId: string): string => {
    const prof = profileOf(paperId);
    if (!prof) return '方法未提取';
    const tag = prof.strategies[0]?.name;
    return tag ? `${prof.family.name} · ${tag}` : prof.family.name;
  };

  /** 默认不展开任何一步：每一步只显示 4 行正文，点击后才展开完整内容 */
  const isOpen = (paperId: string) => openStep === paperId;

  /** 方法短名（与论文集合 / 研究地图同一套派生规则） */
  const shortOf = (paperId: string) => {
    const m = methods.find((x) => x.paperId === paperId);
    if (!m) return (paperById.get(paperId)?.title ?? paperId).slice(0, 18);
    return buildMethodProfile(m, paperById.get(paperId), papers).shortName;
  };

  return (
    <div>
      <Crumb trail={[{ label: '研究地图', on: () => onGo('map') }, { label: '阅读路线' }]} />

      <PageHead
        title="阅读路线"
        sub={
          <>
            按你的基础、目标、时间和算力条件给出的<strong>一条连续阅读路径</strong>：先读哪一篇、为什么先读它、重点看什么，
            以及读完后进哪一步。每一步的原文依据都可以打开核对；论文没有报告算力或训练时长时会明确说无法确认。
          </>
        }
        badges={
          <>
            <Status kind={plan ? (plan.cached ? 'cached' : 'live') : 'pending'}>
              {plan ? (plan.cached ? '示例路线（缓存）' : '个性化路线') : '尚未生成'}
            </Status>
            <Status kind="info">基于 {methods.length} 篇已完成抽取的论文</Status>
            {plan?.steps?.length ? <Status kind="ok">{plan.steps.length} 步阅读顺序</Status> : null}
          </>
        }
        actions={
          <button
            className="btn primary"
            disabled={busy || methods.length === 0}
            onClick={() => {
              setLastProfile(profile);
              onGenerate(profile);
            }}
          >
            {busy ? '生成中…' : modelReady ? (plan && !plan.cached ? '重新生成个性化路线' : '生成个性化路线') : '查看示例路线'}
          </button>
        }
      />

      {/* 你的条件：默认收起，避免首屏堆叠 */}
      <div className="toolbar">
        <button className="btn ghost" onClick={() => setProfileOpen((v) => !v)} aria-expanded={profileOpen}>
          {profileOpen ? '收起我的条件' : '填写 / 修改我的条件'}
        </button>
        <span className="lab">
          {profile.compute || '未填写算力'} · {profile.time || '未填写时间'} · {profile.interest?.slice(0, 18) || '未填写目标'}
        </span>
        <span className="spacer" />
        {plan?.cached && (
          <button className="btn ghost" disabled={busy || methods.length === 0} onClick={onUseSample}>
            重新载入示例路线
          </button>
        )}
      </div>

      {profileOpen && (
        <div className="quiet-group tint expand-in" style={{ marginTop: 0 }}>
          <div className="grid2">
            <div>
              <label className="f">基础</label>
              <textarea className="f" rows={2} value={profile.background} onChange={set('background')} />
            </div>
            <div>
              <label className="f">研究目标 / 兴趣</label>
              <textarea className="f" rows={2} value={profile.interest} onChange={set('interest')} />
            </div>
            <div>
              <label className="f">可用时间</label>
              <input className="f" value={profile.time} onChange={set('time')} />
            </div>
            <div>
              <label className="f">计算资源</label>
              <input className="f" value={profile.compute} onChange={set('compute')} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="f">具体目标</label>
              <input className="f" value={profile.goal} onChange={set('goal')} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn primary sm"
              disabled={busy || methods.length === 0}
              onClick={() => {
                setLastProfile(profile);
                onGenerate(profile);
              }}
            >
              按这些条件生成路线
            </button>
            <span className="small dim">修改条件后重新生成，结果应随之变化</span>
          </div>
          {lastProfile && plan && !plan.cached && (
            <p className="small dim" style={{ marginTop: 8, marginBottom: 0 }}>
              本次结果对应的条件是「{lastProfile.compute || '未填写'} / {lastProfile.time || '未填写'}」。
            </p>
          )}
        </div>
      )}

      {methods.length === 0 && <Banner kind="info">还没有可用的论文分析结果。</Banner>}

      {plan?.cached ? (
        <Banner kind="warn">
          <strong>示例路线，尚未根据用户偏好个性化。</strong>
          <br />
          这是预置示例（由真实模型离线生成{sampleProfile ? `，对应示例条件：${sampleProfile.compute || '未填写'} / ${sampleProfile.time || '未填写'}` : ''}），
          你填写的条件<strong>没有生效</strong>；{modelReady ? '点「生成个性化路线」才会按你的条件生成' : '配置模型后才能按你的条件生成'}。
        </Banner>
      ) : plan ? (
        <Banner kind="info">这是<strong>个性化路线</strong>：已按你填写的条件生成。条件里没提到的因素不会替你做假设。</Banner>
      ) : null}

      {plan?.conditionSensitivity && (
        <p className="small dim" style={{ margin: '0 0 12px' }}>
          <Tag kind="info">模型自述的条件敏感性（未经验证）</Tag> {plan.conditionSensitivity}
        </p>
      )}

      {/* 研究路径：编号 + 竖向轨道 + 每步一个内容区 */}
      {plan && plan.steps.length > 0 && (
        <section className="routesum">
          <p className="rs-line1">
            推荐阅读顺序：
            {plan.steps.map((s) => shortOf(s.paperId)).join(' → ')}
          </p>
          <p className="rs-line2">
            {plan.cached ? '示例路线' : '个性化路线'} ·{' '}
            {plan.steps
              .slice(0, 2)
              .map((s) => [s.reason, s.focus].filter(Boolean).join('；').slice(0, 60))
              .filter(Boolean)
              .join(' · ') || '每一步的理由与重点见下方路线图。'}
          </p>
          <ol className="routegraph">
            {plan.steps.map((s, i) => (
              <li key={`${s.paperId}-${i}`} className={`rgnode${graphStep === i ? ' on' : ''}`}>
                <button
                  onClick={() => setGraphStep(graphStep === i ? null : i)}
                  aria-expanded={graphStep === i}
                >
                  <span className="no">{String(i + 1).padStart(2, '0')}</span>
                  <span className="nm">{shortOf(s.paperId)}</span>
                  <span className="yr">{paperById.get(s.paperId)?.year ?? ''}</span>
                </button>
                {i < plan.steps.length - 1 && (
                  <span className="rgarrow" aria-hidden="true" style={{ ['--rgd' as never]: `${i * 90}ms` }} />
                )}
              </li>
            ))}
          </ol>
          <p className="rgnote">箭头只表示阅读顺序，不是方法之间的关系。</p>
          <div className={`rgexpand${graphStep !== null ? ' open' : ''}`}>
            {graphStep !== null && plan.steps[graphStep] && (
              <div className="rgbody">
                <div className="sect">为什么先读</div>
                <p>{plan.steps[graphStep].reason || '路线里没有给出这一步的理由（未生成或缺失）。'}</p>
                <div className="sect">重点看什么</div>
                <p>{plan.steps[graphStep].focus || '路线里没有给出这一步的重点。'}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {plan && plan.steps.length > 0 && (
        <>
          <SectionHead title="研究路径" sub="按顺序读；每一步都给出理由、重点与下一步" />
          <div className="railpath">
            <div className="railend start">
              <span className="dot" />
              <span className="lab">起点：从这里开始</span>
            </div>
            {plan.steps.map((s, idx) => {
              const p = paperById.get(s.paperId);
              const m = methods.find((x) => x.paperId === s.paperId);
              const prof = profileOf(s.paperId);
              const ev = m?.fields.coreIdea?.evidence;
              const next = plan.steps[idx + 1];
              const nextProf = next ? profileOf(next.paperId) : undefined;
              const open = isOpen(s.paperId);
              const basisTag =
                s.basis === 'profile'
                  ? { kind: 'info', text: '依据你的条件' }
                  : s.basis === 'gap'
                    ? { kind: 'warn', text: '存在信息缺口' }
                    : { kind: 'ok', text: '依据论文信息' };
              return (
                <div className={`railstep${open ? ' open cur' : ''}`} key={`${s.paperId}_${s.order}`}>
                  <div className="rail" aria-hidden="true">
                    <span className="no">{pad2(s.order)}</span>
                    <span className="track" />
                  </div>
                  <div className="body">
                    <div className="hd">
                      <span className="nm">{prof?.shortName ?? p?.title?.slice(0, 16) ?? s.paperId}</span>
                      {p?.year && <span className="small dim">{p.year}</span>}
                      <Tag kind={basisTag.kind}>{basisTag.text}</Tag>
                    </div>

                    <div className="ln">
                      <span className="k">为什么先读它</span>
                      <span className="v">{s.reason}</span>
                    </div>
                    <div className="ln">
                      <span className="k">重点看什么</span>
                      <span className="v">{s.focus}</span>
                    </div>
                    <div className="ln">
                      <span className="k">下一步</span>
                      <span className="v">
                        {next ? (
                          <>
                            读完进入 {pad2(next.order)} · {nextProf?.shortName ?? next.paperId}
                            <span className="dim"> —— {next.focus}</span>
                          </>
                        ) : (
                          <>这条路径已经走完；可以回到研究地图看它与其他方法的联系。</>
                        )}
                      </span>
                    </div>

                    {/* 默认只显示 4 行正文；点击后才展开完整内容（原文依据、方法定位、操作入口） */}
                    {open && (
                      <div className="railmore expand-in">
                        <div className="ln">
                          <span className="k">方法定位</span>
                          <span className="v">{stageWordOf(s.paperId)}</span>
                        </div>
                        {s.gap && (
                          <div className="ln">
                            <span className="k">信息缺口</span>
                            <span className="v" style={{ color: 'var(--warn)' }}>
                              {s.gap}
                            </span>
                          </div>
                        )}
                        <div className="ln">
                          <span className="k">原文依据</span>
                          <span className="v">
                            {ev ? (
                              <button className="btn ghost sm" onClick={() => onOpenEvidence(ev, `${prof?.shortName ?? ''} 的核心思路原文`, p)}>
                                打开原文（p.{ev.page ?? '?'}）
                              </button>
                            ) : (
                              <span className="dim">这一步没有绑定可核验引文（字段按「待人工核对」呈现）</span>
                            )}
                          </span>
                        </div>
                        <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                          <button className="btn sm" onClick={() => onOpenPaper(s.paperId)}>
                            打开这篇论文
                          </button>
                          <button className="btn ghost sm" onClick={() => onGo('map')}>
                            在研究地图里看它
                          </button>
                          <span className="spacer" />
                        </div>
                      </div>
                    )}

                    <button className="toggle" onClick={() => setOpenStep(open ? '' : s.paperId)} aria-expanded={open}>
                      {open ? '收起这一篇的完整内容' : '展开完整内容（方法定位 · 原文依据 · 操作）'}
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="railend end">
              <span className="dot" />
              <span className="lab">终点：完成这条路线</span>
            </div>
          </div>
        </>
      )}

      {plan && plan.steps.length === 0 && (
        <div className="lite">
          <p className="muted" style={{ margin: 0 }}>
            本次未给出阅读顺序：材料不足时不编造顺序。可以补充论文，或把条件写得更具体后重新生成。
          </p>
        </div>
      )}

      {/* 候选方法：放在路径之后 */}
      {plan && (
        <>
          <SectionHead
            title={`为什么是这些方法（候选 ${plan.candidates?.length ?? 0}）`}
            sub="每条理由都标明依据：你的条件 / 论文信息 / 信息缺口；没有可核验证据的理由会直接写出来"
          />
          {(!plan.candidates || plan.candidates.length === 0) && (
            <Banner kind="warn">本次没有给出候选方法。可能是材料不足，请补充论文或检查条件描述。</Banner>
          )}
          {(plan.candidates ?? []).map((c) => {
            const p = paperById.get(c.paperId);
            const m = methodById.get(c.methodId);
            const prof = m ? buildMethodProfile(m, p, papers) : undefined;
            const allOpen = showAllReasons === c.methodId;
            const reasons = allOpen ? c.reasons : c.reasons.slice(0, 2);
            return (
              <div className="quiet-group" key={c.methodId}>
                <div className="hd" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong style={{ fontSize: 'var(--fs-paper)' }}>{prof?.shortName ?? p?.title ?? c.paperId}</strong>
                  <Tag kind={FIT_KIND[c.fit]}>{FIT_TEXT[c.fit]}</Tag>
                  {c.computeReported && c.computeStage && <Tag>论文算力阶段：{TRAINING_STAGE_LABELS[c.computeStage]}</Tag>}
                  {c.targetStage && <Tag>目标阶段：{TRAINING_STAGE_LABELS[c.targetStage]}</Tag>}
                  {c.resourceFeasibility && c.resourceFeasibility !== 'stage_evidence_available' && <Tag kind="warn">可行性未验证</Tag>}
                  {!c.computeReported && <Tag kind="warn">算力信息未报告</Tag>}
                </div>

                <p className="small" style={{ margin: '8px 0 0', color: 'var(--fg-2)' }}>
                  {prof ? shortContribution(prof.approach) || '未提取到核心思路（仍需确认）' : '缺少方法分析结果'}
                </p>

                <div style={{ marginTop: 8 }}>
                  {reasons.map((r, i) => (
                    <div className="small" key={i} style={{ lineHeight: 1.75, marginTop: i ? 6 : 0 }}>
                      <Tag kind={r.basis === 'profile' ? 'info' : r.basis === 'gap' ? 'warn' : 'ok'}>
                        {r.basis === 'profile' ? '依据你的条件' : r.basis === 'gap' ? '信息缺口' : '依据论文'}
                      </Tag>{' '}
                      {r.text}
                      {r.evidence && (
                        <div style={{ marginTop: 4 }}>
                          {r.evidenceSupportsReason === false && (
                            <div className="small" style={{ color: 'var(--warn)', marginBottom: 4 }}>
                              引用的证据与这条理由不匹配（阶段或主题不一致），不作为该理由的支持：
                              {r.bindingIssue ? ` ${r.bindingIssue}` : ''}
                            </div>
                          )}
                          <div
                            className="ev-quote"
                            style={{
                              fontSize: 12,
                              padding: '6px 10px',
                              ...(r.evidenceSupportsReason === false ? { borderLeftColor: 'var(--warn)' } : {}),
                            }}
                          >
                            {r.evidence.quote}
                          </div>
                          <div className="row" style={{ marginTop: 4 }}>
                            <Tag kind={r.evidenceSupportsReason === false ? 'warn' : 'ok'}>
                              原文 p.{r.evidence.page ?? '?'}
                              {r.evidence.section ? ` · ${r.evidence.section}` : ''}
                              {r.evidenceSupportsReason === false ? '（与理由不匹配）' : ''}
                            </Tag>
                            <button
                              className="btn ghost sm"
                              onClick={() => onOpenEvidence(r.evidence!, `${prof?.shortName ?? ''} · 推荐理由证据`, p)}
                            >
                              查看完整上下文
                            </button>
                          </div>
                        </div>
                      )}
                      {r.basis === 'paper' && r.bindingIssue && (
                        <span className="small dim"> · 绑定说明：{r.bindingIssue}</span>
                      )}
                      {r.basis === 'paper' && r.evidenceMissing && (
                        <span style={{ color: 'var(--warn)' }}>
                          {' '}
                          · 该理由没有可核验的证据支持
                          {r.evidenceRef
                            ? `（模型声明依据 ${r.evidenceRef.kind === 'field' ? '字段' : '条件'}：${r.evidenceRef.key}，但该项没有通过校验的引文）`
                            : '（模型未声明依据来源）'}
                          。请勿据此做资源或可行性判断。
                        </span>
                      )}
                    </div>
                  ))}
                  {c.reasons.length > 2 && (
                    <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setShowAllReasons(allOpen ? null : c.methodId)}>
                      {allOpen ? '收起其余理由' : `展开其余 ${c.reasons.length - 2} 条理由`}
                    </button>
                  )}
                </div>

                {c.goalMatch && (
                  <p className="small dim" style={{ margin: '8px 0 0' }}>
                    目标匹配：{GOAL_FIT_LABELS[c.goalMatch.level]}（与硬件条件无关）——{c.goalMatch.reasons.join('；')}
                  </p>
                )}

                {c.execution && c.execution.length > 0 && (
                  <details className="fold" open style={{ marginTop: 12 }}>
                    <summary>在你的条件下能做哪一步（按操作分开判断）</summary>
                    <div className="fold-body">
                      <div className="table-wrap">
                        <table className="cmp" style={{ minWidth: 460 }}>
                          <thead>
                            <tr>
                              <th style={{ width: 150 }}>操作</th>
                              <th style={{ width: 170 }}>判断</th>
                              <th>依据与限制</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.execution.map((ex) => (
                              <tr key={ex.stage}>
                                <td className="small">{EXECUTION_STAGE_LABELS[ex.stage]}</td>
                                <td className="small">
                                  <Tag
                                    kind={
                                      ex.status === 'evidence_supported'
                                        ? 'ok'
                                        : ex.status === 'known_gap'
                                          ? 'bad'
                                          : ex.status === 'insufficient_evidence'
                                            ? 'warn'
                                            : ''
                                    }
                                  >
                                    {EXECUTION_STATUS_LABELS[ex.status]}
                                  </Tag>
                                </td>
                                <td className="small">
                                  {ex.note}
                                  {ex.evidence && (
                                    <>
                                      <div className="ev-quote" style={{ fontSize: 12, padding: '6px 10px', marginTop: 4 }}>
                                        {ex.evidence.quote}
                                      </div>
                                      <div className="row" style={{ marginTop: 4 }}>
                                        <Tag kind="ok">原文 p.{ex.evidence.page ?? '?'}</Tag>
                                        <button
                                          className="btn ghost sm"
                                          onClick={() =>
                                            onOpenEvidence(ex.evidence!, `执行可行性（${EXECUTION_STAGE_LABELS[ex.stage]}）证据`, p)
                                          }
                                        >
                                          查看完整上下文
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="small dim" style={{ margin: '8px 0 0', lineHeight: 1.7 }}>
                        以上是<strong>基于论文证据的判断</strong>：系统不会实际运行训练或推理，也没有读取你的机器信息。
                        因此「论文证据支持该阶段」表示论文给出了与该操作阶段相符、规模可比的算力条目，
                        <strong>不等于「已经验证能在你的设备上跑通」</strong>；实际执行验证需要你在本机另行确认（显存、并行配置、依赖环境）。
                      </p>
                    </div>
                  </details>
                )}

                {(c.applicability || c.feasibilityNote || c.fitAdjusted || c.missing.length > 0) && (
                  <p className="small" style={{ margin: '8px 0 0', lineHeight: 1.75 }}>
                    {c.applicability && (
                      <>
                        <span className="dim">适用条件：</span>
                        {c.applicability}
                        <br />
                      </>
                    )}
                    {c.feasibilityNote && (
                      <>
                        <span className="dim">资源可行性（程序判定）：</span>
                        {c.feasibilityNote}
                        <br />
                      </>
                    )}
                    {c.fitAdjusted && <span style={{ color: 'var(--warn)' }}>程序修正：{c.fitAdjusted}　</span>}
                    {c.missing.length > 0 && <span style={{ color: 'var(--warn)' }}>缺失信息：{c.missing.join('；')}</span>}
                  </p>
                )}

                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <button className="btn sm" onClick={() => onOpenPaper(c.paperId)}>
                    打开这篇论文
                  </button>
                  <button className="btn ghost sm" onClick={() => onGo('map')}>
                    在研究地图里看它
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {!plan && methods.length > 0 && (
        <div className="lite">
          <p style={{ margin: 0, color: 'var(--fg-2)', fontSize: 'var(--fs-body)' }}>
            {modelReady
              ? '还没有生成路线：点右上角「生成个性化路线」，系统会按你填写的条件给出候选方法、阅读顺序与每步理由。'
              : '还没有路线可看：当前未配置模型，点右上角「查看示例路线」会载入预置示例（界面会标明它没有按你的条件生成）。'}
          </p>
        </div>
      )}
    </div>
  );
}

export function decisionToMarkdown(plan: ReadingPlan, papers: Paper[]): string {
  const byId = new Map(papers.map((p) => [p.id, p]));
  const lines: string[] = [
    '# 方法决策与阅读路线（ResearchPilot 导出）',
    '',
    `生成时间：${new Date(plan.generatedAt).toLocaleString('zh-CN')}`,
    plan.cached ? '数据来源：预置示例决策（离线真实模型生成，非实时）' : '数据来源：本次实时模型分析',
    '',
    '## 用户条件（用户自述）',
    '',
    `- 基础：${plan.profile.background || '未填写'}`,
    `- 目标：${plan.profile.interest || '未填写'}`,
    `- 时间：${plan.profile.time || '未填写'}`,
    `- 计算资源：${plan.profile.compute || '未填写'}`,
    '',
  ];
  if (plan.conditionSensitivity) {
    lines.push('## 条件敏感性', '', plan.conditionSensitivity, '');
  }
  if (plan.candidates?.length) {
    lines.push('## 候选方法', '');
    plan.candidates.forEach((c) => {
      lines.push(`### ${byId.get(c.paperId)?.title ?? c.paperId}`);
      lines.push(`- 匹配度：${c.fit}（算力信息已报告：${c.computeReported ? '是' : '否'}）`);
      c.reasons.forEach((r) => lines.push(`- [${r.basis}] ${r.text}`));
      if (c.applicability) lines.push(`- 适用条件：${c.applicability}`);
      if (c.missing.length) lines.push(`- 缺失信息：${c.missing.join('；')}`);
      lines.push('');
    });
  }
  lines.push('## 建议阅读顺序', '');
  plan.steps.forEach((s) => {
    lines.push(`${s.order}. **${byId.get(s.paperId)?.title ?? s.paperId}**（${s.basis}）`);
    lines.push(`   - 阅读重点：${s.focus}`);
    lines.push(`   - 理由：${s.reason}`);
    if (s.gap) lines.push(`   - 信息缺口：${s.gap}`);
  });
  lines.push('', '---', '本文件不包含任何 API 密钥。');
  return lines.join('\n');
}

export function downloadDecision(plan: ReadingPlan, papers: Paper[]) {
  downloadText('researchpilot-方法决策.md', decisionToMarkdown(plan, papers), 'text/markdown');
}
