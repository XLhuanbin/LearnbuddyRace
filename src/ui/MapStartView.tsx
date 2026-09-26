import React, { useState } from 'react';
import type { Evidence, Method, Paper, ReadingPlan, UserProfile } from '../core/types';
import { Status } from './common';

interface Props {
  papers: Paper[];
  methods: Method[];
  plan?: ReadingPlan;
  modelReady: boolean;
  busy: boolean;
  /** 停止等待（只停止本地等待） */
  onCancel?: () => void;
  onGenerate: (profile: UserProfile) => void;
  onOpenEvidence: (ev: Evidence) => void;
  /** 有证据支持的少量待调查问题（可空） */
  questions?: { id: string; text: string; basis?: string; evidence?: Evidence[] }[];
}

const BACKGROUNDS = ['刚接触这个方向', '有一定基础', '比较熟悉这个方向'];
const GOALS = ['先快速理解方法', '想复现某篇论文', '想在自己的数据上微调', '想从头训练模型'];

const isTrainingGoal = (goal: string) => /复现|微调|训练/.test(goal);

/**
 * 视图三：从哪里开始。
 * 首次只问「当前基础」与「想解决的问题」；只有复现/微调/训练才继续问时间与算力。
 * 单纯阅读不会被预训练算力门槛阻断。
 */
export function MapStartView({ papers, methods, plan, modelReady, busy, onCancel, onGenerate, onOpenEvidence, questions }: Props) {
  const [background, setBackground] = useState(BACKGROUNDS[0]);
  const [goal, setGoal] = useState(GOALS[0]);
  const [time, setTime] = useState('');
  const [compute, setCompute] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const nameOf = (paperId: string) => {
    const t = papers.find((p) => p.id === paperId)?.title ?? '';
    if (/Residual/.test(t)) return 'ResNet';
    if (/AN IMAGE/.test(t)) return 'ViT';
    if (/data-efficient/.test(t)) return 'DeiT';
    if (/Swin/.test(t)) return 'Swin';
    if (/ConvNet/.test(t)) return 'ConvNeXt';
    return t.slice(0, 14) || paperId;
  };

  const needResource = isTrainingGoal(goal);
  const steps = plan?.steps ?? [];
  const showPlan = submitted && steps.length > 0;

  /**
   * 两种状态必须说清楚（本轮要求）：
   * - 未配置模型：入口与结果都叫「示例路线」，并明确「你选择的条件未生效」；
   * - 只有真实按条件生成成功（plan 非缓存）才叫「个性化路线」。
   */
  const isPersonal = Boolean(modelReady && plan && !plan.cached);
  const planLabel = isPersonal ? '个性化路线' : '示例路线';
  const ctaLabel = modelReady ? (isPersonal ? '重新生成个性化路线' : '生成个性化路线') : '查看示例路线';

  return (
    <div>
      <h2 className="page">从哪里开始</h2>
      <p className="lead">结合你的目标，你应该先读什么、重点看什么？</p>

      <div className="card">
        <div className="grid2">
          <div>
            <label className="f">你当前的基础</label>
            <select className="f" value={background} onChange={(e) => setBackground(e.target.value)}>
              {BACKGROUNDS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="f">你想解决的问题 / 学习目标</label>
            <select className="f" value={goal} onChange={(e) => setGoal(e.target.value)}>
              {GOALS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </div>
        </div>

        {needResource && (
          <div className="grid2" style={{ marginTop: 12 }}>
            <div>
              <label className="f">可投入的时间（可留空）</label>
              <input className="f" value={time} onChange={(e) => setTime(e.target.value)} placeholder="例如：两周，每天 2 小时" />
            </div>
            <div>
              <label className="f">可用的计算资源（可留空）</label>
              <input className="f" value={compute} onChange={(e) => setCompute(e.target.value)} placeholder="例如：单卡 16GB" />
            </div>
          </div>
        )}

        <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button
            className="btn primary"
            onClick={() => {
              setSubmitted(true);
              if (!modelReady) return; // 没配模型就不发无效请求：只展示示例路线
              onGenerate({ background, interest: goal, time: needResource ? time : undefined, compute: needResource ? compute : undefined, goal });
            }}
            disabled={busy}
          >
            {busy ? '正在生成…' : ctaLabel}
          </button>
          {busy && onCancel && (
            <button className="btn ghost" onClick={onCancel}>
              停止等待
            </button>
          )}
          {!modelReady && (
            <span className="small dim">
              未配置模型：这里只能看案例自带的<strong>示例路线</strong>，你上面选的条件不会生效（配置模型后才会按条件生成）。
            </span>
          )}
        </div>
      </div>

      {showPlan ? (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{planLabel}</h3>
            {isPersonal ? <Status kind="live">已按你的条件生成</Status> : <Status kind="cached">示例路线（未按你的条件生成）</Status>}
          </div>
          <p className="small" style={{ margin: '0 0 10px', color: isPersonal ? 'var(--fg-2)' : 'var(--warn)' }}>
            {isPersonal
              ? '下面的顺序是按你上面选择的「基础 + 目标 + 时间/算力」生成的。'
              : '下面的顺序来自案例自带的示例条件，你上面选择的「基础 / 目标 / 时间 / 算力」没有生效；配置模型后可以按你的条件重新生成。'}
          </p>
          <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {plan?.profile && (
              <span className="small dim">
                {isPersonal ? '本次条件' : '示例条件'}：{plan.profile.background} · {plan.profile.interest}
                {plan.profile.time ? ` · ${plan.profile.time}` : ''}
                {plan.profile.compute ? ` · ${plan.profile.compute}` : ''}
              </span>
            )}
          </div>

          <h3 style={{ margin: '6px 0 10px' }}>建议按这个顺序读</h3>
          <div className="readlist">
            {steps.map((st) => (
              <div className="readitem" key={st.paperId}>
                <span className="ord">{st.order}</span>
                <div className="bd">
                  <b>{nameOf(st.paperId)}</b>
                  {st.reason && <p>{st.reason}</p>}
                  {st.focus && <p className="focus">重点看：{st.focus.replace(/^重点看[:：]?/, '').slice(0, 150)}</p>}
                  <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    {(() => {
                      const m = methods.find((x) => x.paperId === st.paperId);
                      return m?.fields.coreIdea?.evidence ? (
                        <button className="btn ghost sm" onClick={() => onOpenEvidence(m.fields.coreIdea!.evidence!)}>
                          查看依据
                        </button>
                      ) : null;
                    })()}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="small dim" style={{ marginTop: 10 }}>
            阅读路线依据论文里写明的条件与内容，不代表已经在你本机运行过；
            如果你选了复现/微调/训练，「能不能跑」会单独判断，不会因为算力不足就取消阅读建议。
          </p>

          {questions && questions.length > 0 && (
            <>
              <h3 style={{ margin: '22px 0 10px' }}>值得继续调查的问题（{questions.length} 项）</h3>
              {questions.slice(0, 4).map((q) => (
                <div className="qa" key={q.id}>
                  <h4>{q.text}</h4>
                  {q.basis && <p className="small dim" style={{ margin: 0 }}>{q.basis}</p>}
                  {q.evidence && q.evidence.length > 0 && (
                    <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => onOpenEvidence(q.evidence![0])}>
                      查看依据
                    </button>
                  )}
                </div>
              ))}
              <p className="small dim">这些问题是根据论文自述的局限或分歧提出的，不代表已经确认的研究空白。</p>
            </>
          )}
        </>
      ) : (
        <div className="card">
          <p className="small" style={{ margin: 0, color: 'var(--fg-2)' }}>
            {submitted
              ? modelReady
                ? '没有生成成功：可能是接口不可用或当前论文不足。可以稍后重试；上面的示例路线仍可参考（已标注为示例）。'
                : '未配置模型：暂时看不到示例路线（这份案例可能没有预置）。可以先看研究地图与联系与区别。'
              : modelReady
                ? '选好基础与目标后点「生成个性化路线」，这里会给出先读哪篇、顺序、重点与理由。'
                : '未配置模型时点「查看示例路线」，会显示案例自带的示例顺序（并标明不是按你的条件生成的）。'}
          </p>
        </div>
      )}
    </div>
  );
}
