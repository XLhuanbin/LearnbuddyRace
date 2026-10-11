import React, { useState } from 'react';
import type { Evidence, Method, Paper, ReadingPlan, UserProfile } from '../core/types';
import {
  EXECUTION_STAGE_LABELS,
  EXECUTION_STATUS_LABELS,
  GOAL_FIT_LABELS,
  TRAINING_STAGE_LABELS,
} from '../core/types';
import { Banner, SectionHead, Status, Tag, downloadText } from './common';
import { buildMethodProfile, shortContribution } from '../core/grouping';
import { DraftIcon } from '../draft-icons';
import { innovationColor } from './innovationScale';

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
  onCancel,
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
  /** 停止等待（只停止本地等待，不保证服务端已停止计算） */
  onCancel?: () => void;
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
  /** 侧栏「AI 建议」默认只显示首句，完整条件敏感性按需展开（草稿 v7 把它收成配置卡底部一行） */
  const [adviceOpen, setAdviceOpen] = useState(false);

  const paperById = new Map(papers.map((p) => [p.id, p]));
  const methodById = new Map(methods.map((m) => [m.id, m]));
  const profileOf = (paperId: string) => {
    const m = methods.find((x) => x.paperId === paperId);
    return m ? buildMethodProfile(m, paperById.get(paperId), papers) : undefined;
  };
  const set = (k: keyof UserProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setProfile({ ...profile, [k]: e.target.value });
  const pad2 = (n: number) => String(n).padStart(2, '0');

  /** 侧栏 AI 建议：完整内容 = 模型自述的条件敏感性；默认只显示首句，避免把侧栏撑高 */
  const adviceFull = plan?.conditionSensitivity?.trim() || '';
  const adviceShort = (() => {
    if (!adviceFull) {
      return plan
        ? '本次路线基于语料里已完成抽取的论文与你填写的条件；条件里没提到的因素不会替你做假设。'
        : '填写条件后点「生成路线」：系统会给出候选方法、阅读顺序与每一步的理由与依据。';
    }
    const hit = adviceFull.match(/^[^。；;!?！？]{1,200}[。；;!?！？]/);
    const first = (hit ? hit[0] : adviceFull).trim();
    return first.length > 46 ? `${first.slice(0, 46)}…` : first;
  })();

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
    <div className="decpage sdpage">
      <div className="max-w-[1440px] mx-auto px-10 pt-14">
        <div className="grid grid-cols-12 gap-12">
          {/* 左栏：路线（草稿 8 栏） */}
          <div className="col-span-12 lg:col-span-8">
            {/* 草稿头部：eyebrow + 4xl 衬线标题 + 生成时间/篇数 */}
            <header className="mb-12">
              <div className="flex flex-col gap-4">
                <p className="text-[var(--fg-3)] tracking-[0.3em] uppercase text-xs font-bold">Personalized Learning Path</p>
                <h1 className="text-4xl font-serif font-bold tracking-tight">阅读路线</h1>
                <div className="flex items-center gap-4 mt-2 text-sm text-[var(--fg-3)] flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <DraftIcon name="calendar" />
                    {plan ? `生成于 ${new Date(plan.generatedAt).toLocaleString('zh-CN')}` : '尚未生成'}
                  </span>
                  <span className="w-1 h-1 bg-[var(--line-2)] rounded-full" />
                  <span className="flex items-center gap-1.5">
                    <DraftIcon name="file-text" />
                    包含 {plan?.steps?.length ?? 0} 篇核心论文
                  </span>
                  <span className="w-1 h-1 bg-[var(--line-2)] rounded-full" />
                  <span>{plan ? (plan.cached ? '示例路线（缓存）' : '个性化路线') : '尚未生成'}</span>
                </div>
              </div>
            </header>

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

      {/* 研究路径：编号 + 竖向轨道 + 每步一个内容区 */}
      {/* 推荐顺序摘要：只留一行（原来那套图与下面的步骤卡信息重复，草稿里也没有） */}
      {plan && plan.steps.length > 0 && (
        <p className="text-sm text-[var(--fg-2)] mb-8">
          <span className="font-bold">推荐阅读顺序：</span>
          {plan.steps.map((s2) => shortOf(s2.paperId)).join(' → ')}
        </p>
      )}

      {plan && plan.steps.length > 0 && (
        <div className="space-y-10">
          {plan.steps.map((s2, idx) => {
            const p = paperById.get(s2.paperId);
            const m = methods.find((x) => x.paperId === s2.paperId);
            const prof = profileOf(s2.paperId);
            const ev = m?.fields.coreIdea?.evidence;
            const score = m?.assessment?.innovation?.value;
            const next = plan.steps[idx + 1];
            const nextProf = next ? profileOf(next.paperId) : undefined;
            const open = openStep === s2.paperId;
            const basisText =
              s2.basis === 'profile' ? '依据你的条件' : s2.basis === 'gap' ? '存在信息缺口' : '依据论文信息';
            // 草稿第 1 步用高亮标签「起点文献」，其余用中性标签（这里放真实的推荐依据）
            const first = idx === 0;
            // 草稿的逐级变淡：这里用更克制的衰减，保证正文仍可读
            const dim = Math.max(1 - idx * 0.08, 0.72);
            return (
              <div className="step-node flex gap-8" key={`${s2.paperId}_${s2.order}`}>
                <div className="step-number shrink-0">{pad2(s2.order)}</div>
                <div className="content-card flex-1" style={{ opacity: dim }}>
                  <div className="flex justify-between items-start mb-4 gap-4">
                    <div className="flex flex-col gap-1 min-w-0">
                      <div>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded uppercase"
                          style={
                            first
                              ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                              : { background: 'var(--bg-3)', color: 'var(--fg-3)' }
                          }
                        >
                          {first ? '起点文献' : basisText}
                        </span>
                      </div>
                      <h3 className="text-2xl font-serif font-bold leading-tight">{p?.title ?? s2.paperId}</h3>
                      {/* 草稿这里是「作者 • 年份」——我们没有作者数据，统一换成真实的方法族 */}
                      <p className="text-sm text-[var(--fg-3)]">
                        {prof?.family.name ?? '方法未提取'} • {p?.year ?? '年份未识别'}
                      </p>
                    </div>
                    <div
                      className="flex items-center gap-1 font-bold text-lg shrink-0"
                      style={{ color: innovationColor(typeof score === 'number' ? score : undefined) }}
                      title="创新度是模型评估，不是论文给出的分数"
                    >
                      <DraftIcon name="sparkles" />
                      <span>{typeof score === 'number' ? score.toFixed(1) : '—'}</span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <p className="text-[var(--fg-2)] leading-relaxed">
                      <span className="font-bold">为什么先读它：</span>
                      {s2.reason}
                    </p>
                    <div className="bg-[var(--bg-3)] p-4 rounded-xl">
                      <p className="text-xs font-black uppercase text-[var(--fg-3)] tracking-widest mb-2">重点看什么</p>
                      <ul className="text-sm space-y-2 text-[var(--fg-2)]">
                        <li>• {s2.focus}</li>
                      </ul>
                    </div>
                    <div className="ln" style={{ display: 'flex', gap: 10 }}>
                      <span className="font-bold shrink-0">下一步</span>
                      <span className="text-[var(--fg-2)]">
                        {next ? (
                          <>
                            读完进入 {pad2(next.order)} · {nextProf?.shortName ?? next.paperId}
                            <span className="text-[var(--fg-3)]"> —— {next.focus}</span>
                          </>
                        ) : (
                          <>这条路径已经走完；可以回到研究地图看它与其他方法的联系。</>
                        )}
                      </span>
                    </div>

                    {open && (
                      <div className="expand-in" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <span className="font-bold shrink-0">方法定位</span>
                          <span className="text-[var(--fg-2)]">{stageWordOf(s2.paperId)}</span>
                        </div>
                        {s2.gap && (
                          <div style={{ display: 'flex', gap: 10 }}>
                            <span className="font-bold shrink-0">信息缺口</span>
                            <span style={{ color: 'var(--warn)' }}>{s2.gap}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <span className="font-bold shrink-0">原文依据</span>
                          <span>
                            {ev ? (
                              <button
                                className="text-[10px] font-bold text-[var(--accent)] flex items-center gap-1 hover:underline"
                                onClick={() => onOpenEvidence(ev, `${prof?.shortName ?? ''} 的核心思路原文`, p)}
                              >
                                打开原文（p.{ev.page ?? '?'}）
                                <DraftIcon name="chevron-right" />
                              </button>
                            ) : (
                              <span className="text-[var(--fg-3)]">
                                这一步没有绑定可核验引文（字段按「待人工核对」呈现）
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap mt-1">
                          <button className="btn sm" onClick={() => onOpenPaper(s2.paperId)}>
                            打开这篇论文
                          </button>
                          <button className="btn ghost sm" onClick={() => onGo('map')}>
                            在研究地图里看它
                          </button>
                        </div>
                      </div>
                    )}

                    <button
                      className="text-sm font-bold text-[var(--accent)] flex items-center gap-1 hover:underline"
                      onClick={() => setOpenStep(open ? '' : s2.paperId)}
                      aria-expanded={open}
                    >
                      {open ? '收起完整内容' : '查看详细分析（方法定位 · 原文依据 · 操作）'}
                      <DraftIcon name="chevron-right" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* 草稿末尾那张「后续推荐 + 锁」的卡片：换成真实事实——本次没纳入路线的论文数 */}
          {methods.length > plan.steps.length && (
            <div className="step-node flex gap-8">
              <div className="step-number shrink-0 opacity-50">···</div>
              <div className="content-card flex-1 border-dashed" style={{ opacity: 0.7 }}>
                <div className="flex items-center justify-between">
                  <p className="text-lg font-bold">
                    另有 {methods.length - plan.steps.length} 篇已分析的论文未纳入本次路线
                  </p>
                  <DraftIcon name="lock" className="text-[var(--fg-3)]" />
                </div>
                <p className="text-sm text-[var(--fg-3)] mt-2">
                  路线只包含模型按你填写的条件挑出的论文；想全部看到，去论文集合或研究地图。
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {plan && plan.steps.length === 0 && (
        <div className="lite">
          <p className="muted" style={{ margin: 0 }}>
            本次未给出阅读顺序：材料不足时不编造顺序。可以补充论文，或把条件写得更具体后重新生成。
          </p>
        </div>
      )}

      {/* 每篇论文的证据链（草稿 c122c572 v7 新增的 evidence-chain-section） */}
      {plan && (
        <section className="mt-20 border-t border-[var(--line)] pt-12" id="evidence-chain-section">
          <div className="mb-10">
            <p className="text-[var(--fg-3)] tracking-[0.3em] uppercase text-[10px] font-black mb-2">
              Evidence &amp; Methodology
            </p>
            <h2 className="text-3xl font-serif font-bold text-[var(--fg)]">每篇论文的证据链</h2>
            <p className="text-[var(--fg-2)] text-sm mt-1">
              了解推荐路径背后的深度分析依据与原文证据；每一条依据都标明来源，没有可核验证据的会直接写出来。
            </p>
          </div>

          {(!plan.candidates || plan.candidates.length === 0) && (
            <Banner kind="warn">本次没有给出候选方法。可能是材料不足，请补充论文或检查条件描述。</Banner>
          )}

          <div className="space-y-8">
            {(plan.candidates ?? []).map((c, ci) => {
              const p = paperById.get(c.paperId);
              const m = methodById.get(c.methodId);
              const prof = m ? buildMethodProfile(m, p, papers) : undefined;
              const allOpen = showAllReasons === c.methodId;
              const reasons = allOpen ? c.reasons : c.reasons.slice(0, 2);
              const stepIdx = plan.steps.findIndex((x) => x.paperId === c.paperId);
              const next = stepIdx >= 0 ? plan.steps[stepIdx + 1] : undefined;
              const quoted = c.reasons.find((r) => r.evidence)?.evidence;
              const goalLevel = c.goalMatch?.level;
              /** 目标匹配度只用「分档」表达，**不编造百分比**：档位决定进度条长度 */
              const goalWidth: Record<string, number> = {
                recommended: 100,
                worth_investigating: 66,
                background: 33,
                not_relevant: 10,
              };
              return (
                <div className="content-card bg-white border border-[var(--line)] p-8" key={c.methodId}>
                  {/* 头部：编号徽标 + 衬线标题 + 右侧标签 */}
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-8 border-b border-[var(--line)] pb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-bold bg-[var(--accent)] text-white px-2 py-0.5 rounded shrink-0">
                        {pad2(ci + 1)}
                      </span>
                      <h4 className="text-lg font-serif font-bold">{p?.title ?? c.paperId}</h4>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <span className="evidence-pill">{prof?.family.name ?? '方法未提取'}</span>
                      <span className="evidence-pill">{p?.year ?? '年份未识别'}</span>
                      <span className="evidence-pill is-key">{FIT_TEXT[c.fit]}</span>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {/* 推荐依据（草稿这里是「依据论文 Foundation Papers」的引文列表 —— 我们没有参考文献数据，
                        换成真实的推荐依据：每条理由 + 它的依据来源与绑定情况） */}
                    <div>
                      <label className="evidence-label">
                        <DraftIcon name="book-open" />
                        推荐依据
                      </label>
                      <ul className="evidence-list">
                        {reasons.map((r, i) => (
                          <li key={i}>
                            <Tag kind={r.basis === 'profile' ? 'info' : r.basis === 'gap' ? 'warn' : 'ok'}>
                              {r.basis === 'profile' ? '依据你的条件' : r.basis === 'gap' ? '信息缺口' : '依据论文'}
                            </Tag>{' '}
                            {r.text}
                            {r.basis === 'paper' && r.bindingIssue && (
                              <span className="text-[11px] text-[var(--fg-3)]"> · 绑定说明：{r.bindingIssue}</span>
                            )}
                            {r.evidenceSupportsReason === false && (
                              <div className="text-[11px] mt-1" style={{ color: 'var(--warn)' }}>
                                引用的证据与这条理由不匹配（阶段或主题不一致），不作为该理由的支持。
                              </div>
                            )}
                            {r.basis === 'paper' && r.evidenceMissing && (
                              <div className="text-[11px] mt-1" style={{ color: 'var(--warn)' }}>
                                该理由没有可核验的证据支持
                                {r.evidenceRef
                                  ? `（模型声明依据${r.evidenceRef.kind === 'field' ? '字段' : '条件'}：${r.evidenceRef.key}，但该项没有通过校验的引文）`
                                  : '（模型未声明依据来源）'}
                                。请勿据此做资源或可行性判断。
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                      {c.reasons.length > 2 && (
                        <button
                          className="btn ghost sm"
                          style={{ marginTop: 8 }}
                          onClick={() => setShowAllReasons(allOpen ? null : c.methodId)}
                        >
                          {allOpen ? '收起其余理由' : `展开其余 ${c.reasons.length - 2} 条理由`}
                        </button>
                      )}
                    </div>

                    {/* 原文证据 */}
                    <div>
                      <label className="evidence-label">
                        <DraftIcon name="quote" />
                        原文证据
                      </label>
                      {quoted ? (
                        <div className="evidence-quote">
                          <p className="text-[13px] italic text-[var(--fg-2)] leading-relaxed">“{quoted.quote}”</p>
                          <div className="mt-3">
                            <Tag kind={quoted.verified ? 'ok' : 'warn'}>
                              原文 p.{quoted.page ?? '?'}
                              {quoted.section ? ` · ${quoted.section}` : ''}
                              {quoted.verified ? '' : '（未通过定位校验）'}
                            </Tag>
                            <button
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--accent)] hover:underline ml-3"
                              onClick={() => onOpenEvidence(quoted, `${prof?.shortName ?? ''} · 推荐理由证据`, p)}
                            >
                              [查看完整上下文]
                              <DraftIcon name="external-link" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[13px] text-[var(--fg-3)]">
                          本次没有为该篇绑定可核验的原文引文（不拿未核验的文字冒充原文）。
                        </p>
                      )}
                    </div>

                    {/* 与下一步的关系（草稿的「绑定说明 Relation to Next」） */}
                    <div>
                      <label className="evidence-label">
                        <DraftIcon name="link-2" />
                        与下一步的关系
                      </label>
                      <p className="text-[13px] text-[var(--fg-2)] leading-relaxed">
                        {next
                          ? `读完进入 ${pad2(next.order)} · ${shortOf(next.paperId)} —— ${next.focus}`
                          : '这是这条路径的最后一篇；读完后可以回到研究地图看它与其他方法的联系。'}
                      </p>
                    </div>

                    {/* 目标匹配度：只用分档，不用百分比 */}
                    <div>
                      <label className="evidence-label">
                        <DraftIcon name="target" />
                        目标匹配度
                      </label>
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="text-sm font-black text-[var(--accent)] shrink-0">
                          {goalLevel ? GOAL_FIT_LABELS[goalLevel] : '未评估'}
                        </span>
                        <div className="evidence-bar">
                          <div className="evidence-bar-fill" style={{ width: `${goalLevel ? goalWidth[goalLevel] : 0}%` }} />
                        </div>
                        <span className="text-[12px] text-[var(--fg-3)] flex-1 min-w-[180px]">
                          {c.goalMatch?.reasons?.join('；') || '模型未给出匹配理由'}
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--fg-3)] mt-2">
                        这是程序按你的目标给出的分档（不是匹配概率，系统不使用置信度百分比）；与你的硬件条件无关。
                      </p>
                    </div>

                    {/* 折叠保留：这两块草稿 v7 没有，但它们是真实且必要的判定，收进折叠不占版面 */}
                    {((c.execution && c.execution.length > 0) ||
                      c.applicability ||
                      c.feasibilityNote ||
                      c.fitAdjusted ||
                      c.missing.length > 0) && (
                      <details className="fold">
                        <summary>在你的条件下能做哪一步 · 还缺什么信息</summary>
                        <div className="fold-body">
                          {c.execution && c.execution.length > 0 && (
                            <>
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
                            </>
                          )}
                          {(c.applicability || c.feasibilityNote || c.fitAdjusted || c.missing.length > 0) && (
                            <p className="small" style={{ margin: '10px 0 0', lineHeight: 1.75 }}>
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
                              {c.missing.length > 0 && (
                                <span style={{ color: 'var(--warn)' }}>缺失信息：{c.missing.join('；')}</span>
                              )}
                            </p>
                          )}
                        </div>
                      </details>
                    )}

                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn sm" onClick={() => onOpenPaper(c.paperId)}>
                        打开这篇论文
                      </button>
                      <button className="btn ghost sm" onClick={() => onGo('map')}>
                        在研究地图里看它
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!plan && methods.length > 0 && (
        <div className="lite">
          <p style={{ margin: 0, color: 'var(--fg-2)', fontSize: 'var(--fs-body)' }}>
            {modelReady
              ? '还没有生成路线：点右侧「生成个性化路线」，系统会按你填写的条件给出候选方法、阅读顺序与每步理由。'
              : '还没有路线可看：当前未配置模型，点右侧「查看示例路线」会载入预置示例（界面会标明它没有按你的条件生成）。'}
          </p>
        </div>
      )}
          </div>

          {/* 右栏：个性化配置 + AI 建议（草稿 4 栏，sticky） */}
          <aside className="col-span-12 lg:col-span-4">
            {/* 右侧常驻栏：sticky 让它在页面滚动时不移动（实测滚动 900/2400px 后顶部始终钉在 32px）。
                把面板压到能整块放下之后，max-height/overflow 只作为极窄窗口的兜底 —— 正常情况下
                没有内部滚动条，整块面板完整可见（原来内容 800px > 可用 706px，底部 94px 被藏起来）。 */}
            <div className="sticky top-8" style={{ maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}>
              <div className="content-card bg-white" style={{ border: '2px solid var(--accent)', boxShadow: '0 4px 24px rgba(22,38,61,.10)', padding: 22 }}>
                <h3 className="text-xl font-serif font-bold mb-4 flex items-center gap-2">
                  <DraftIcon name="settings-2" className="text-[var(--accent)]" />
                  个性化路线配置
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-black uppercase text-[var(--fg-3)] tracking-widest mb-2">
                      我的基础水平
                    </label>
                    <textarea
                      className="w-full bg-[var(--bg)] border border-[var(--line)] p-2.5 rounded-xl text-sm focus:outline-none focus:border-[var(--accent)]"
                      rows={2}
                      value={profile.background}
                      onChange={set('background')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase text-[var(--fg-3)] tracking-widest mb-2">
                      研究目标 / 兴趣
                    </label>
                    <textarea
                      className="w-full bg-[var(--bg)] border border-[var(--line)] p-2.5 rounded-xl text-sm focus:outline-none focus:border-[var(--accent)]"
                      rows={2}
                      value={profile.interest}
                      onChange={set('interest')}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-black uppercase text-[var(--fg-3)] tracking-widest mb-2">
                        可用时间
                      </label>
                      <input
                        className="w-full bg-[var(--bg)] border border-[var(--line)] p-2.5 rounded-xl text-sm focus:outline-none focus:border-[var(--accent)]"
                        value={profile.time ?? ''}
                        onChange={set('time')}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black uppercase text-[var(--fg-3)] tracking-widest mb-2">
                        计算资源
                      </label>
                      <input
                        className="w-full bg-[var(--bg)] border border-[var(--line)] p-2.5 rounded-xl text-sm focus:outline-none focus:border-[var(--accent)]"
                        value={profile.compute ?? ''}
                        onChange={set('compute')}
                      />
                    </div>
                  </div>
                  <button
                    className="w-full btn-primary mt-2"
                    style={{ justifyContent: 'center' }}
                    disabled={busy || methods.length === 0}
                    onClick={() => {
                      setLastProfile(profile);
                      onGenerate(profile);
                    }}
                  >
                    {busy ? '生成中…' : modelReady ? '重新生成路线' : '查看示例路线'}
                  </button>
                  {busy && onCancel && (
                    <button className="w-full btn-outline" style={{ justifyContent: 'center' }} disabled={!modelReady} onClick={onCancel}>
                      停止等待
                    </button>
                  )}
                  {plan?.cached && (
                    <button className="w-full btn-outline" style={{ justifyContent: 'center' }} disabled={busy || methods.length === 0} onClick={onUseSample}>
                      重新载入示例路线
                    </button>
                  )}
                  {lastProfile && plan && !plan.cached && (
                    <p className="text-[11px] text-[var(--fg-3)] leading-relaxed">
                      本次结果对应的条件是「{lastProfile.compute || '未填写'} / {lastProfile.time || '未填写'}」。
                    </p>
                  )}
                </div>

                {/* AI 建议：草稿 v7 就是配置卡底部的一行（分隔线 + 灯泡 + 11px 短句），不是独立大卡 ——
                    原来独立成卡时那一整段条件敏感性把侧栏撑得比视口还高，滚动时上下被截断。
                    这里按草稿收成一行：默认只显示首句，完整内容按需展开（不丢真实信息）。 */}
                <div className="mt-4 pt-4 border-t border-[var(--line)] flex items-start gap-3">
                  <DraftIcon name="lightbulb" className="text-[var(--accent)] text-lg shrink-0" />
                  <div className="min-w-0">
                    {/* 草稿这里是 text-[11px]，但项目有 12px 字号下限（11px 不在元数据白名单里）——
                        这是承载解释的整句，按项目规则取 12px（长度仍然很短，不影响侧栏高度） */}
                    <p className="text-xs text-[var(--fg-2)] leading-relaxed">{adviceShort}</p>
                    {adviceFull && (
                      <button
                        className="text-[10px] font-bold text-[var(--accent)] hover:underline mt-1"
                        onClick={() => setAdviceOpen((v) => !v)}
                        aria-expanded={adviceOpen}
                      >
                        {adviceOpen ? '收起' : '展开完整条件敏感性'}
                      </button>
                    )}
                    {adviceOpen && adviceFull && (
                      <>
                        <p className="text-xs text-[var(--fg-2)] leading-relaxed mt-2">{adviceFull}</p>
                        <p className="text-[10px] text-[var(--fg-3)] mt-1">以上为模型自述的条件敏感性，未经验证。</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* 页脚：草稿是「导出 PDF / 分享路线 / 返回论文库」；
            我们没有 PDF 导出与分享功能，换成真实入口（导出 Markdown / 返回论文集合 / 研究地图） */}
        <footer className="mt-20 pt-12 border-t border-[var(--line)] flex flex-col md:flex-row justify-between items-center gap-8 mb-4">
          <div className="flex items-center gap-3 text-sm flex-wrap">
            <button
              className="btn-outline flex items-center gap-2"
              disabled={!plan}
              onClick={() => plan && downloadText('researchpilot-方法决策.md', decisionToMarkdown(plan, papers), 'text/markdown')}
            >
              <DraftIcon name="file-down" />
              导出路线（Markdown）
            </button>
            <button className="btn-outline flex items-center gap-2" onClick={() => onGo('library')}>
              <DraftIcon name="arrow-left" />
              返回论文集合
            </button>
            <button className="btn-outline flex items-center gap-2" onClick={() => onGo('map')}>
              在研究地图里看它们
            </button>
          </div>
          <p className="text-[10px] text-[var(--fg-3)] uppercase tracking-widest">
            © 2026 ResearchPilot · 路线只依据语料与你的条件，不做排名
          </p>
        </footer>
      </div>
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
