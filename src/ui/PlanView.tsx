import React, { useState } from 'react';
import type { Evidence, Method, Paper, ReadingPlan, UserProfile } from '../core/types';
import {
  EXECUTION_STAGE_LABELS,
  EXECUTION_STATUS_LABELS,
  GOAL_FIT_LABELS,
  TRAINING_STAGE_LABELS,
} from '../core/types';
import { Banner, Tag, downloadText } from './common';

const FIT_TEXT = {
  suitable: '条件匹配',
  conditional: '有条件可用',
  unknown: '无法判断',
} as const;
const FIT_KIND = { suitable: 'ok', conditional: 'warn', unknown: '' } as const;

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
}) {
  const [profile, setProfile] = useState<UserProfile>({
    background: '计算机相关专业，上过机器学习课，能读懂 Transformer 基本结构',
    interest: '想了解预训练语言模型的训练与评测思路',
    time: '两周，每天约 2 小时',
    compute: '只有一台笔记本，无 GPU 集群',
    goal: '选一个能上手复现的小方向做课程项目',
  });
  const [lastProfile, setLastProfile] = useState<UserProfile | undefined>();

  const paperById = new Map(papers.map((p) => [p.id, p]));
  const methodById = new Map(methods.map((m) => [m.id, m]));
  const set = (k: keyof UserProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setProfile({ ...profile, [k]: e.target.value });

  return (
    <div>
      <h2 className="page">阅读建议</h2>
      <p className="sub">
        填入你的研究目标、基础、可用时间和计算资源，系统会结合已导入论文给出候选方法、阅读顺序，以及每项推荐的理由与适用条件。
        论文没有报告算力或训练时长时会明确说无法确认，不会推测能不能跑。
      </p>

      <div className="card">
        <h3>你的条件</h3>
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
        <div className="row" style={{ marginTop: 12 }}>
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
          {plan?.cached && (
            <button className="btn" disabled={busy || methods.length === 0} onClick={onUseSample}>
              重新载入示例路线
            </button>
          )}
          <span className="small dim">基于 {methods.length} 篇已完成抽取的论文</span>
        </div>
        {lastProfile && plan && !plan.cached && (
          <p className="small dim" style={{ marginTop: 8 }}>
            本次结果对应的条件是「{lastProfile.compute || '未填写'} / {lastProfile.time || '未填写'}」。
            修改条件后重新生成，结果应随之变化。
          </p>
        )}
      </div>

      {methods.length === 0 && <Banner kind="info">还没有可用的论文分析结果。</Banner>}

      {plan?.cached ? (
        <Banner kind="warn">
          当前显示的是<strong>示例路线</strong>（预置、由真实模型离线生成{sampleProfile ? `，对应示例条件：${sampleProfile.compute || '未填写'} / ${sampleProfile.time || '未填写'}` : ''}）。
          你上面填写的条件<strong>没有生效</strong>；{modelReady ? '点「生成个性化路线」才会按你的条件生成' : '配置模型后才能按你的条件生成'}。
        </Banner>
      ) : plan ? (
        <Banner kind="info">这是<strong>个性化路线</strong>：已按你填写的条件生成。</Banner>
      ) : null}

      {plan && (
        <>
          {plan.conditionSensitivity && (
            <div className="card tight">
              <div className="row">
                <Tag kind="info">模型自述的条件敏感性（未经验证）</Tag>
                <span className="small">{plan.conditionSensitivity}</span>
              </div>
            </div>
          )}

          <div className="card">
            <h3>候选方法（{plan.candidates?.length ?? 0}）</h3>
            {(!plan.candidates || plan.candidates.length === 0) && (
              <Banner kind="warn">本次没有给出候选方法。可能是材料不足，请补充论文或检查条件描述。</Banner>
            )}
            {(plan.candidates ?? []).map((c) => {
              const p = paperById.get(c.paperId);
              const m = methodById.get(c.methodId);
              return (
                <div key={c.methodId} className="qa" style={{ borderLeftColor: c.fit === 'suitable' ? 'var(--ok)' : c.fit === 'conditional' ? 'var(--warn)' : 'var(--line-2)' }}>
                  <div className="row" style={{ marginBottom: 4 }}>
                    <strong style={{ fontSize: 13.5 }}>{p?.title ?? c.paperId}</strong>
                    <Tag kind={FIT_KIND[c.fit]}>{FIT_TEXT[c.fit]}</Tag>
                    {c.computeReported && c.computeStage && (
                      <Tag>论文算力阶段：{TRAINING_STAGE_LABELS[c.computeStage]}</Tag>
                    )}
                    {c.targetStage && <Tag>目标阶段：{TRAINING_STAGE_LABELS[c.targetStage]}</Tag>}
                    {c.resourceFeasibility && c.resourceFeasibility !== 'stage_evidence_available' && (
                      <Tag kind="warn">可行性未验证</Tag>
                    )}
                    {!c.computeReported && <Tag kind="warn">算力信息未报告</Tag>}
                  </div>
                  {c.reasons.map((r, i) => (
                    <div className="small" key={i} style={{ lineHeight: 1.8 }}>
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
                            {r.stage && <Tag>{TRAINING_STAGE_LABELS[r.stage]}</Tag>}
                            <button
                              className="btn ghost sm"
                              onClick={() =>
                                onOpenEvidence(r.evidence!, `${p?.title?.slice(0, 24) ?? ''} · 推荐理由证据`, p)
                              }
                            >
                              查看完整上下文
                            </button>
                          </div>
                        </div>
                      )}
                      {r.basis === 'paper' && r.bindingIssue && (
                        <div className="small dim" style={{ marginTop: 3 }}>
                          绑定说明：{r.bindingIssue}
                        </div>
                      )}
                      {r.basis === 'paper' && r.evidenceMissing && (
                        <div style={{ color: 'var(--warn)', marginTop: 3 }}>
                          该理由没有可核验的证据支持
                          {r.evidenceRef ? `（模型声明依据 ${r.evidenceRef.kind === 'field' ? '字段' : '条件'}：${r.evidenceRef.key}，但该项没有通过校验的引文）` : '（模型未声明依据来源）'}
                          。请勿据此做资源或可行性判断。
                        </div>
                      )}
                    </div>
                  ))}

                  {c.goalMatch && (
                    <div style={{ marginTop: 8 }}>
                      <Tag kind={c.goalMatch.level === 'not_relevant' ? '' : 'info'}>
                        目标匹配：{GOAL_FIT_LABELS[c.goalMatch.level]}
                      </Tag>
                      <div className="small dim" style={{ marginTop: 4 }}>
                        为什么值得研究（与硬件条件无关）
                      </div>
                      <ul className="small" style={{ margin: '2px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                        {c.goalMatch.reasons.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {c.execution && c.execution.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div className="small dim" style={{ marginBottom: 4 }}>
                        在你的条件下能做哪一步（按操作分开判断）
                      </div>
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
                      <p className="small dim" style={{ margin: '6px 0 0', lineHeight: 1.7 }}>
                        以上是<strong>基于论文证据的判断</strong>：系统不会实际运行训练或推理，也没有读取你的机器信息。
                        因此「论文证据支持该阶段」表示论文给出了与该操作阶段相符、规模可比的算力条目，
                        <strong>不等于「已经验证能在你的设备上跑通」</strong>；实际执行验证需要你在本机另行确认（显存、并行配置、依赖环境）。
                      </p>
                    </div>
                  )}
                  {c.applicability && (
                    <div className="small" style={{ marginTop: 4 }}>
                      <span className="dim">适用条件：</span>
                      {c.applicability}
                    </div>
                  )}
                  {c.feasibilityNote && (
                    <div className="small" style={{ marginTop: 4 }}>
                      <span className="dim">资源可行性（程序判定）：</span>
                      {c.feasibilityNote}
                    </div>
                  )}
                  {c.fitAdjusted && (
                    <div className="small" style={{ marginTop: 4, color: 'var(--warn)' }}>
                      程序修正：{c.fitAdjusted}
                    </div>
                  )}
                  {c.missing.length > 0 && (
                    <div className="small" style={{ marginTop: 4, color: 'var(--warn)' }}>
                      缺失信息：{c.missing.join('；')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="card">
            <h3>建议阅读顺序</h3>
            {plan.steps.length === 0 && <p className="muted">本次未给出阅读顺序。</p>}
            {plan.steps.map((s) => {
              const p = paperById.get(s.paperId);
              return (
                <div className="step" key={`${s.paperId}_${s.order}`}>
                  <div className="num">{s.order}</div>
                  <div className="c">
                    <div className="row" style={{ marginBottom: 4 }}>
                      <strong style={{ fontSize: 13.5 }}>{p?.title ?? s.paperId}</strong>
                      <Tag>{p?.year ?? '年份未识别'}</Tag>
                      <Tag kind={s.basis === 'gap' ? 'warn' : s.basis === 'profile' ? 'info' : 'ok'}>
                        {s.basis === 'paper' ? '依据论文信息' : s.basis === 'profile' ? '依据你的条件' : '存在信息缺口'}
                      </Tag>
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.75 }}>
                      <span className="dim">阅读重点：</span>
                      {s.focus}
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.75 }}>
                      <span className="dim">理由：</span>
                      {s.reason}
                    </div>
                    {s.gap && (
                      <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>
                        信息缺口：{s.gap}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
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
