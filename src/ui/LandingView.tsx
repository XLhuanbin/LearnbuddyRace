import React, { useEffect, useMemo, useState } from 'react';
import type { Method, Paper, Relation } from '../core/types';
import { buildMethodProfile, exploreQuestion, firstSentence, pickExploreRelation } from '../core/grouping';

interface Props {
  onExperienceCase: () => void;
  onUploadOwn: () => void;
}

interface Facts {
  families: { name: string; count: number; pending: boolean }[];
  question: { text: string; from: string; to: string; state: string; hasEvidence: boolean; type: string } | null;
  route: { name: string; focus: string }[];
  relationCount: number;
  paperCount: number;
}

const STATE_LABEL: Record<string, string> = { explicit: '原文已说明', inferred: '系统推断', candidate: '待核查' };

/**
 * 从预置视觉案例里读出首页要用的**真实**内容（家族分组、一条真实关系、示例路线前三步）。
 * 全部来自已经过全文定位校验的缓存结果；读不到就返回 null，页面退回不声称具体内容的占位。
 */
function buildFacts(idx: { papers: Paper[]; methods: Method[]; relations: Relation[]; decisionSample?: { steps?: { paperId: string; focus?: string }[] } }): Facts {
  const papers = idx.papers ?? [];
  const methods = idx.methods ?? [];
  const profiles = methods.map((m) => buildMethodProfile(m, papers.find((p) => p.id === m.paperId), papers));

  const byFamily = new Map<string, { name: string; count: number; pending: boolean }>();
  for (const p of profiles) {
    const key = p.family.id;
    if (!byFamily.has(key)) byFamily.set(key, { name: p.family.name, count: 0, pending: p.family.confidence === 'pending' });
    byFamily.get(key)!.count += 1;
  }
  const families = [...byFamily.values()].sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || b.count - a.count);

  const nameOf = (id: string) => profiles.find((p) => p.methodId === id)?.shortName ?? id;
  const best = pickExploreRelation(idx.relations ?? []);
  const question = best
    ? {
        text: exploreQuestion(best.type, nameOf(best.fromMethodId), nameOf(best.toMethodId)),
        from: nameOf(best.fromMethodId),
        to: nameOf(best.toMethodId),
        state: STATE_LABEL[best.evidenceState] ?? best.evidenceState,
        hasEvidence: Boolean(best.evidence),
        type: best.type,
      }
    : null;

  const steps = idx.decisionSample?.steps ?? [];
  const route = steps.slice(0, 3).map((st) => {
    const m = methods.find((x) => x.paperId === st.paperId);
    const prof = m ? profiles.find((p) => p.methodId === m.id) : undefined;
    return { name: prof?.shortName ?? '', focus: firstSentence(st.focus ?? '', 26) };
  }).filter((x) => x.name);

  return { families, question, route, relationCount: (idx.relations ?? []).length, paperCount: papers.length };
}

/**
 * 宣传型首页：学术出版物气质。
 *
 * 首屏顺序：ResearchPilot → 论文方法梳理智能体 → 中文主张 → 一句说明 → 两个入口
 * 向下依次是三个作用段落（每段一句重点 + 三条要点 + 一个取自预置案例的真实片段）：
 *   01 看懂方法差异（真实家族分组）→ 02 理清技术关系（真实关系与证据状态）→ 03 决定先读什么（示例路线前三步）
 * 段落末尾给出进入案例的入口；图形内容全部来自预置视觉案例，且标注证据状态，不冒充实时分析。
 */
export function LandingView({ onExperienceCase, onUploadOwn }: Props) {
  const [facts, setFacts] = useState<Facts | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}samples-vision/index.json`, { cache: 'no-cache' });
        if (!res.ok) return;
        const idx = await res.json();
        if (alive) setFacts(buildFacts(idx));
      } catch {
        /* 取不到真实内容时，用不声称具体数字的占位 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.landing .reveal'));
    if (!els.length) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const familyRows = useMemo(() => {
    if (facts?.families.length) return facts.families;
    return [
      { name: '卷积网络（CNN）', count: 0, pending: false },
      { name: 'Transformer 架构', count: 0, pending: false },
    ];
  }, [facts]);

  return (
    <div className="landing">
      {/* ---------------- 首屏 ---------------- */}
      <section className="lead-block">
        <h1 className="brand-title reveal">ResearchPilot</h1>
        <p className="positioning reveal" style={{ transitionDelay: '60ms' }}>
          <span className="rule" aria-hidden="true" />
          论文方法梳理智能体
          <span className="rule" aria-hidden="true" />
        </p>
        <h2 className="cn-sub reveal" style={{ transitionDelay: '110ms' }}>
          把一组论文，变成你看得懂的研究地图。
        </h2>
        <p className="sub reveal" style={{ transitionDelay: '160ms' }}>
          看懂各类方法解决了什么、彼此如何发展，以及你应该先读哪篇。关键结论都能回到原文。
        </p>
        <div className="cta-row reveal" style={{ transitionDelay: '210ms' }}>
          <button className="btn primary lg" onClick={onExperienceCase}>
            体验视觉论文案例
          </button>
          <button className="btn lg" onClick={onUploadOwn}>
            上传我的论文
          </button>
        </div>
        <p className="hero-next reveal" style={{ transitionDelay: '260ms' }}>
          下面三段，分别说明你会<span>看到</span>什么、<span>能做</span>什么、<span>得到</span>什么帮助。
        </p>
      </section>

      {/* ---------------- 01 看懂方法差异 ---------------- */}
      <section className="cap reveal" aria-labelledby="cap-1">
        <div className="cap-text">
          <span className="cap-no">01</span>
          <h3 id="cap-1">看懂方法差异</h3>
          <p className="cap-lead">同一方向的论文，按技术思路分成几组，每篇一句话说清它做了什么。</p>
          <ul className="cap-list">
            <li>
              <b>看到</b>分组与技术路线，以及每篇的核心做法
            </li>
            <li>
              <b>能做</b>点开任一方法，跳到原文对应位置核对
            </li>
            <li>
              <b>得到</b>这组论文的整体印象，不必先读完全文
            </li>
          </ul>
        </div>
        <figure className="cap-fig">
          <div className="g-group" aria-hidden="true">
            {familyRows.map((f) => (
              <div className={`g-row${f.pending ? ' muted' : ''}`} key={f.name}>
                <span className="g-name">{f.name}</span>
                <span className="g-chips">
                  {Array.from({ length: Math.max(f.count, 1) }).map((_, i) => (
                    <span className="g-chip" key={i} />
                  ))}
                </span>
                <span className="g-count">{f.count ? `${f.count} 篇` : '—'}</span>
              </div>
            ))}
          </div>
          <figcaption>
            一组论文
            <span className="src">（预置视觉案例的真实分组）</span>
          </figcaption>
        </figure>
      </section>

      {/* ---------------- 02 理清技术关系 ---------------- */}
      <section className="cap alt reveal" aria-labelledby="cap-2">
        <div className="cap-text">
          <span className="cap-no">02</span>
          <h3 id="cap-2">理清技术关系</h3>
          <p className="cap-lead">方法之间的关系只按原文里的真实依据连线，并标明这份依据有多硬。</p>
          <ul className="cap-list">
            <li>
              <b>看到</b>继承 / 改进 / 组合 / 相近，以及原文明示、系统推断、待核查
            </li>
            <li>
              <b>能做</b>点开一条连线，看「谁基于谁、改了什么」和原文片段
            </li>
            <li>
              <b>得到</b>哪些结论有原文支撑、哪些还需自己回论文确认
            </li>
          </ul>
        </div>
        <figure className="cap-fig">
          <div className="g-rel">
            <div className="g-rel-head" aria-hidden="true">
              <span className="n from">{facts?.question?.from ?? '前置方法'}</span>
              <span className="n to">{facts?.question?.to ?? '后续方法'}</span>
            </div>
            <svg viewBox="0 0 320 56" role="presentation" aria-hidden="true">
              <path className="drawline solid" pathLength={1} d="M 24 28 L 140 28" />
              <path className="drawline dash" pathLength={1} d="M 144 44 C 190 44 196 12 246 12" />
              <circle className="g-dot" cx="24" cy="28" r="4" />
              <circle className="g-dot" cx="246" cy="12" r="4" />
              <circle className="g-dot" cx="250" cy="44" r="4" />
            </svg>
            <div className="g-legend">
              <span className="k">
                <i className="sw solid" /> 原文明示
              </span>
              <span className="k">
                <i className="sw dash" /> 系统推断
              </span>
              {facts?.question && (
                <span className={`k tag ${facts.question.state === '原文已说明' ? 'ok' : facts.question.state === '系统推断' ? 'pending' : 'neutral'}`}>
                  {facts.question.text.replace('？', '')} · {facts.question.state}
                  {!facts.question.hasEvidence ? '（无直接引文）' : ''}
                </span>
              )}
            </div>
          </div>
          <figcaption>
            方法分组与关联
            <span className="src">（预置视觉案例中的一条真实关系）</span>
          </figcaption>
        </figure>
      </section>

      {/* ---------------- 03 决定先读什么 ---------------- */}
      <section className="cap reveal" aria-labelledby="cap-3">
        <div className="cap-text">
          <span className="cap-no">03</span>
          <h3 id="cap-3">决定先读什么</h3>
          <p className="cap-lead">结合你的基础与目标给出阅读顺序，每篇说明重点看什么、为什么先读它。</p>
          <ul className="cap-list">
            <li>
              <b>看到</b>有先后顺序的清单，每篇标注重点与理由
            </li>
            <li>
              <b>能做</b>换条件重新生成；条件变了顺序也会变
            </li>
            <li>
              <b>得到</b>能照着读的路线，且不会因暂时没算力被劝退
            </li>
          </ul>
        </div>
        <figure className="cap-fig">
          <ol className="g-order" aria-hidden="true">
            {(facts?.route.length ? facts.route : [{ name: '基础方法', focus: '' }, { name: '改进版本', focus: '' }, { name: '最新工作', focus: '' }]).map(
              (st, i) => (
                <li key={`${st.name}-${i}`}>
                  <b>{i + 1}</b>
                  <span className="t">{st.name}</span>
                  {st.focus ? <em>重点看：{st.focus}</em> : <em />}
                </li>
              ),
            )}
          </ol>
          <figcaption>
            阅读路线
            <span className="src">（预置案例自带的示例路线）</span>
          </figcaption>
        </figure>
      </section>

      <p className="disclaimer reveal">
        以上分组、关系与路线均来自<strong>预置视觉案例</strong>（离线生成、已通过原文定位校验的结果），关系按证据状态标注；不是本次操作触发的实时分析。
      </p>

      <div className="cap-cta reveal">
        <button className="btn primary lg" onClick={onExperienceCase}>
          进入视觉论文案例
        </button>
        <span className="small dim">不用上传任何东西，直接看这 5 篇的方法地图。</span>
      </div>
    </div>
  );
}
