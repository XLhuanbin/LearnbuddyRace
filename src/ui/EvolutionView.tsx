import React, { useMemo, useState } from 'react';
import type { Evidence, Method, Paper, ReadingPlan, Relation } from '../core/types';
import { Status } from './common';

interface Props {
  papers: Paper[];
  methods: Method[];
  relations: Relation[];
  plan?: ReadingPlan;
  onOpenEvidence: (ev: Evidence) => void;
}

/** 方法的一句话贡献：优先用人工校订过的短句；没有时取「核心思路」的第一句（不新增结论） */
const SHORT: Record<string, string> = {
  'p_arxiv_1512.03385': '让更深的 CNN 更容易训练',
  'p_arxiv_2010.11929': '把 Transformer 引入图像分类',
  'p_arxiv_2012.12877': '降低视觉 Transformer 的数据门槛',
  'p_arxiv_2103.14030': '用窗口注意力处理高分辨率图像',
  'p_arxiv_2201.03545': '重新设计现代 CNN',
};

const shortOf = (paperId: string, m?: Method) => {
  if (SHORT[paperId]) return SHORT[paperId];
  const txt = m?.fields.coreIdea?.value ?? '';
  return txt.split(/[。；]/)[0]?.slice(0, 26) || '未提取到核心思路';
};

/** 关系 → 用户能看懂的一句说明 */
const REL_TEXT: Record<string, string> = {
  extends: '在此基础上继续发展',
  improves: '针对它的不足做了改进',
  combines: '把它的思路与其他方法结合',
  similar: '与它思路相近',
  unclear: '关系不明确',
};

const STATE_TEXT: Record<string, string> = {
  explicit: '原文已说明',
  inferred: '系统推断',
  candidate: '仍需确认',
};

/**
 * 方法演进：先给一条简洁路线（方法名 + 一句话贡献 + 标签），点节点看详情；
 * 底部给「如果你刚开始学习，建议按这个顺序阅读」。
 */
export function EvolutionView({ papers, methods, relations, plan, onOpenEvidence }: Props) {
  const [active, setActive] = useState<string | null>(null);
  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const methodByPaper = useMemo(() => new Map(methods.map((m) => [m.paperId, m])), [methods]);

  /** 路线顺序：按论文年份（取不到年份时保持原顺序） */
  const route = useMemo(() => {
    const ps = [...papers].filter((p) => methods.some((m) => m.paperId === p.id));
    return ps.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  }, [papers, methods]);

  const nameOf = (p: Paper) => {
    const t = p.title ?? '';
    if (/Residual/.test(t)) return 'ResNet';
    if (/AN IMAGE/.test(t)) return 'ViT';
    if (/data-efficient/.test(t)) return 'DeiT';
    if (/Swin/.test(t)) return 'Swin';
    if (/ConvNet/.test(t)) return 'ConvNeXt';
    return t.slice(0, 14);
  };

  /** 与上一个方法的关系（有则用，没有则如实说明） */
  const relationWithPrev = (paperId: string, prevPaperId?: string) => {
    if (!prevPaperId) return null;
    const m = methodByPaper.get(paperId);
    const pm = methodByPaper.get(prevPaperId);
    if (!m || !pm) return null;
    return (
      relations.find((r) => r.fromMethodId === pm.id && r.toMethodId === m.id) ??
      relations.find((r) => r.fromMethodId === m.id && r.toMethodId === pm.id) ??
      null
    );
  };

  const activePaper = route.find((p) => p.id === active);
  const activeMethod = activePaper ? methodByPaper.get(activePaper.id) : undefined;
  const activeIdx = route.findIndex((p) => p.id === active);
  const prevPaper = activeIdx > 0 ? route[activeIdx - 1] : undefined;
  const activeRel = activePaper ? relationWithPrev(activePaper.id, prevPaper?.id) : null;

  const steps = plan?.steps ?? [];

  return (
    <div>
      <h2 className="page">方法演进</h2>
      <p className="lead">
        五个代表性方法按时间排成一条线：点任意一个，看它做了什么、与前一个方法的关系，以及原文依据。
      </p>

      <div className="route">
        {route.map((p, i) => {
          const m = methodByPaper.get(p.id);
          const rel = relationWithPrev(p.id, route[i - 1]?.id);
          const state = rel ? rel.evidenceState : null;
          const labelText = i === 0 ? '起点' : rel ? STATE_TEXT[state ?? 'candidate'] : '未见原文说明';
          const kind = i === 0 ? 'cached' : state === 'explicit' ? 'ok' : state === 'inferred' ? 'info' : 'pending';
          return (
            <React.Fragment key={p.id}>
              {i > 0 && <span className="sep">→</span>}
              <button className={`rnode${active === p.id ? ' on' : ''}`} onClick={() => setActive(p.id)}>
                <div className="nm">{nameOf(p)}</div>
                <div className="ct">{shortOf(p.id, m)}</div>
                <div className="lb">
                  <Status kind={kind}>{labelText}</Status>
                </div>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {activePaper && activeMethod && (
        <div className="nodedetail">
          <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <strong style={{ fontSize: 16 }}>{nameOf(activePaper)}</strong>
            <button className="btn ghost sm" onClick={() => setActive(null)}>
              关闭详情
            </button>
          </div>
          <dl>
            <dt>它做了什么</dt>
            <dd>{activeMethod.fields.coreIdea?.value?.slice(0, 300) || '未提取到核心思路'}</dd>
            <dt>和前一个方法（{prevPaper ? nameOf(prevPaper) : '起点'}）的关系</dt>
            <dd>
              {activeRel
                ? `${REL_TEXT[activeRel.type] ?? '关系待确认'}（${STATE_TEXT[activeRel.evidenceState]}）${
                    activeRel.rationale ? '：' + activeRel.rationale.slice(0, 120) : ''
                  }`
                : prevPaper
                  ? '论文里没有直接说明两者的继承或改进关系（仍需确认）。'
                  : '这是路线上的第一个方法。'}
            </dd>
            <dt>原文依据</dt>
            <dd>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {activeMethod.fields.coreIdea?.evidence && (
                  <button className="btn sm" onClick={() => onOpenEvidence(activeMethod.fields.coreIdea!.evidence!)}>
                    核心思路的原文（p.{activeMethod.fields.coreIdea.evidence.page ?? '?'}）
                  </button>
                )}
                {activeRel?.evidence && (
                  <button className="btn ghost sm" onClick={() => onOpenEvidence(activeRel.evidence!)}>
                    关系依据的原文（p.{activeRel.evidence.page ?? '?'}）
                  </button>
                )}
              </div>
            </dd>
          </dl>
        </div>
      )}

      <h3 style={{ margin: '28px 0 10px' }}>如果你刚开始学习，建议按这个顺序阅读</h3>
      <div className="readlist">
        {(steps.length
          ? steps
          : route.map((p, i) => ({ order: i + 1, paperId: p.id, reason: '', focus: '' }))
        ).map((st) => {
          const p = paperById.get(st.paperId);
          if (!p) return null;
          const m = methodByPaper.get(st.paperId);
          return (
            <div className="readitem" key={st.paperId}>
              <span className="ord">{st.order}</span>
              <div className="bd">
                <b>{nameOf(p)}</b>
                {st.reason && <p>{st.reason}</p>}
                {st.focus && <p className="focus">重点看：{st.focus.replace(/^重点看[:：]?/, '').slice(0, 140)}</p>}
                <div className="row" style={{ gap: 8, marginTop: 6 }}>
                  {m?.fields.coreIdea?.evidence && (
                    <button className="btn ghost sm" onClick={() => onOpenEvidence(m.fields.coreIdea!.evidence!)}>
                      查看依据
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="small dim" style={{ marginTop: 12 }}>
        阅读顺序来自论文证据判断（每条的原文依据可展开确认），不代表已经实际运行过这些方法。
      </p>
    </div>
  );
}
