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
}

const STATE_LABEL: Record<string, string> = { explicit: '原文已说明', inferred: '系统推断', candidate: '待核查' };

/** 从预置视觉案例里读出首页要用的真实内容；读不到就返回 null，页面退回不声称具体内容的占位 */
function buildFacts(idx: {
  papers: Paper[];
  methods: Method[];
  relations: Relation[];
  decisionSample?: { steps?: { paperId: string; focus?: string }[] };
}): Facts {
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
  const route = steps
    .slice(0, 3)
    .map((st) => {
      const m = methods.find((x) => x.paperId === st.paperId);
      const prof = m ? profiles.find((p) => p.methodId === m.id) : undefined;
      const focus = firstSentence(st.focus ?? '', 30).replace(/^重点看[:：]?/, '').trim();
      return { name: prof?.shortName ?? '', focus };
    })
    .filter((x) => x.name);

  return { families, question, route };
}

const d = (ms: number) => ({ ['--d' as never]: `${ms}ms` }) as React.CSSProperties;

/**
 * 宣传型首页。
 *
 * 首屏：ResearchPilot → 论文方法梳理智能体 → 中文主张 → 一句说明 → 两个入口。
 *  - 品牌标题与中文主张使用自托管衬线字体，**字体就绪前不显示**（只做不改变布局的淡入），避免系统字体切到自托管字体的跳变；
 *  - 首屏元素不参与滚动动画，向上滚动不会重新触发。
 * 三屏作用段落：01 分组 / 02 关系 / 03 顺序，每屏一个标题 + 一句解释 + 极少量要点 + 一个简洁图形。
 *  - 进入视口时播放（0.9s、位移 24px、分层错峰），离开视口移除状态、再次进入重新播放（可逆）；
 *  - prefer减少动效时直接显示。
 * 图形内容全部取自预置视觉案例，并按证据状态标注，不冒充实时分析。
 */
export function LandingView({ onExperienceCase, onUploadOwn }: Props) {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [fontsReady, setFontsReady] = useState(false);

  /** 字体就绪门控：避免首屏最大标题出现「系统衬线 → 自托管衬线」的字形跳变（最多等 700ms 兜底） */
  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setFontsReady(true);
    };
    const timer = window.setTimeout(finish, 700);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) fonts.ready.then(finish).catch(finish);
    else finish();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}samples-vision/index.json`, { cache: 'no-cache' });
        if (!res.ok) return;
        const idx = await res.json();
        if (alive) setFacts(buildFacts(idx));
      } catch {
        /* 取不到真实内容时用不声称具体数字的占位 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** 滚动动效：进入视口播放、离开移除（不 unobserve），向上滚动同样反向淡出 */
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
        entries.forEach((entry) => entry.target.classList.toggle('in', entry.isIntersecting));
      },
      { rootMargin: '-6% 0px -14% 0px', threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const families = useMemo(() => {
    const list = facts?.families?.length ? facts.families : [];
    if (list.length >= 2) return list.slice(0, 3);
    return [
      { name: '卷积网络（CNN）', count: 0, pending: false },
      { name: 'Transformer 架构', count: 0, pending: false },
    ];
  }, [facts]);

  const seenLine = useMemo(() => {
    const withCount = families.filter((f) => f.count > 0);
    if (!withCount.length) return '每篇属于哪条技术路线、一句话贡献是什么';
    return `${withCount.map((f) => `${f.name} ${f.count} 篇`).join('、')}，以及每篇的一句话贡献`;
  }, [families]);

  const rel = facts?.question ?? null;
  const route = facts?.route?.length ? facts.route : [];

  return (
    <div className="landing">
      {/* ---------------- 首屏（不参与滚动动画） ---------------- */}
      <section className="lead-block">
        <h1 className={`brand-title font-gate${fontsReady ? ' ready' : ''}`}>ResearchPilot</h1>
        <p className="positioning">
          <span className="rule" aria-hidden="true" />
          论文方法梳理智能体
          <span className="rule" aria-hidden="true" />
        </p>
        <h2 className={`cn-sub font-gate${fontsReady ? ' ready' : ''}`}>把一组论文，变成你看得懂的研究地图。</h2>
        <p className="sub">看懂各类方法解决了什么、彼此如何发展，以及你应该先读哪篇。关键结论都能回到原文。</p>
        <div className="cta-row">
          <button className="btn primary lg" onClick={onExperienceCase}>
            体验视觉论文案例
          </button>
          <button className="btn lg" onClick={onUploadOwn}>
            上传我的论文
          </button>
        </div>
        <p className="hero-next">下面三段，分别说明你会看到什么、能做什么、得到什么帮助。</p>
      </section>

      {/* ---------------- 01 分组 ---------------- */}
      <section className="cap" aria-labelledby="cap-1">
        <div className="cap-text">
          <div className="cap-head reveal" style={d(0)}>
            <span className="cap-no">01</span>
            <h3 id="cap-1">看懂方法差异</h3>
          </div>
          <p className="cap-lead reveal" style={d(130)}>
            先把论文按技术路线放在一起，再看每篇具体解决了什么。
          </p>
          <ul className="cap-list reveal" style={d(260)}>
            <li>
              <b>看到</b>
              {seenLine}
            </li>
            <li>
              <b>点开</b>查看核心做法和对应的原文依据
            </li>
          </ul>
        </div>
        <figure className="cap-fig reveal" style={d(130)}>
          <div className="g-group" aria-hidden="true">
            {families.map((f) => (
              <div className="g-row" key={f.name}>
                <span className="g-name">{f.name}</span>
                <span className="g-count">{f.count ? `${f.count} 篇` : '—'}</span>
              </div>
            ))}
          </div>
          <figcaption>一组论文</figcaption>
        </figure>
      </section>

      {/* ---------------- 02 关系 ---------------- */}
      <section className="cap alt" aria-labelledby="cap-2">
        <div className="cap-text">
          <div className="cap-head reveal" style={d(0)}>
            <span className="cap-no">02</span>
            <h3 id="cap-2">理清技术关系</h3>
          </div>
          <p className="cap-lead reveal" style={d(130)}>
            实线表示论文明确写出，虚线表示系统推断，需要复核。
          </p>
        </div>
        <figure className="cap-fig reveal" style={d(130)}>
          <div className="g-rel">
            <div className="g-rel-head">
              <span className="n">{rel?.from ?? '前置方法'}</span>
              <span className={`rel-arrow${rel && rel.state === '原文已说明' ? '' : ' dash'}`} aria-hidden="true" />
              <span className="n">{rel?.to ?? '后续方法'}</span>
            </div>
            <div className="g-legend">
              <span className="k">
                <i className="sw solid" /> 论文明确写出
              </span>
              <span className="k">
                <i className="sw dash" /> 系统推断
              </span>
              {rel && (
                <span className={`tag ${rel.state === '原文已说明' ? 'ok' : rel.state === '系统推断' ? 'pending' : 'neutral'}`}>
                  这条：{rel.state}
                  {!rel.hasEvidence ? '（无直接引文）' : ''}
                </span>
              )}
            </div>
          </div>
          <figcaption>方法分组与关联</figcaption>
        </figure>
      </section>

      {/* ---------------- 03 顺序 ---------------- */}
      <section className="cap" aria-labelledby="cap-3">
        <div className="cap-text">
          <div className="cap-head reveal" style={d(0)}>
            <span className="cap-no">03</span>
            <h3 id="cap-3">决定先读什么</h3>
          </div>
          <p className="cap-lead reveal" style={d(130)}>
            按你的基础和目标排出顺序，每步只看一件事。
          </p>
        </div>
        <figure className="cap-fig reveal" style={d(130)}>
          <ol className="g-order">
            {(route.length
              ? route
              : [
                  { name: '基础方法', focus: '' },
                  { name: '改进版本', focus: '' },
                  { name: '最新工作', focus: '' },
                ]
            ).map((st, i) => (
              <li key={`${st.name}-${i}`}>
                <b>{i + 1}</b>
                <span className="t">{st.name}</span>
                <em>{st.focus ? `重点看：${st.focus}` : '重点看：论文自述的核心做法'}</em>
              </li>
            ))}
          </ol>
          <figcaption>阅读路线</figcaption>
        </figure>
      </section>

      <p className="disclaimer reveal" style={d(0)}>
        以上分组、关系与顺序来自<strong>预置视觉案例</strong>（离线生成、已通过原文定位校验），并按证据状态标注；不是本次操作触发的实时分析。
      </p>

      <div className="cap-cta">
        <button className="btn primary lg" onClick={onExperienceCase}>
          进入视觉论文案例
        </button>
      </div>
    </div>
  );
}
