import React, { useEffect } from 'react';

interface Props {
  onExperienceCase: () => void;
  onUploadOwn: () => void;
}

/**
 * 宣传型首页：学术出版物气质。
 *
 * 首屏文字顺序（自上而下，作为一个整体）：
 *   1. ResearchPilot —— 最大标题
 *   2. 论文方法梳理智能体 —— 产品定位
 *   3. 把一组论文，变成你看得懂的研究地图。 —— 中文主张
 *   4. 一句说明 + 两个入口
 *
 * 向下滚动依次是三个作用段落（每段一种排版 + 一个简洁图形）：
 *   01 看懂方法差异 → 02 理清技术关系 → 03 决定先读什么
 * 图形一律标注为示意，不使用真实分析结果。
 *
 * 动效：只在内容进入视口时做一次克制的渐入/连线描绘；尊重 prefers-reduced-motion。
 * 刻意不显示：论文数量、实验记录数、版本号、API 配置、缓存说明、开发状态与技术规则。
 */
export function LandingView({ onExperienceCase, onUploadOwn }: Props) {
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
      </section>

      {/* ---------------- 01 看懂方法差异 ---------------- */}
      <section className="cap reveal" aria-labelledby="cap-1">
        <div className="cap-text">
          <span className="cap-no">01</span>
          <h3 id="cap-1">看懂方法差异</h3>
          <p className="cap-lead">同一方向的论文，先按技术思路分成几组，再看每一篇具体做了什么。</p>
          <ul className="cap-list">
            <li>
              <b>你会看到</b>：这组论文分成哪几组技术路线，每篇方法一句话说清它做了什么、核心做法是什么。
            </li>
            <li>
              <b>你可以</b>：点开任一方法，查看它的研究任务、核心做法与作者自述的局限，并直接跳到论文原文的位置。
            </li>
            <li>
              <b>你会得到</b>：对「这组论文大概在研究什么」的整体印象，不必先读完全文。
            </li>
          </ul>
        </div>
        <figure className="cap-fig">
          <div className="g-group" aria-hidden="true">
            <div className="g-row">
              <span className="g-name">卷积网络（CNN）</span>
              <span className="g-chip" />
              <span className="g-chip" />
            </div>
            <div className="g-row">
              <span className="g-name">Transformer 架构</span>
              <span className="g-chip" />
              <span className="g-chip" />
              <span className="g-chip" />
            </div>
            <div className="g-row muted">
              <span className="g-name">待确认</span>
              <span className="g-chip" />
            </div>
          </div>
          <figcaption>一组论文</figcaption>
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
              <b>你会看到</b>：继承 / 改进 / 组合 / 相近四类关系，每条都标着证据状态——原文明示、系统推断，还是待核查。
            </li>
            <li>
              <b>你可以</b>：点开一条连线，看到「谁基于谁、具体改了什么」以及可核对的原文片段；没有依据的关系不会连线。
            </li>
            <li>
              <b>你会得到</b>：清楚哪些结论有原文支撑、哪些还需要你自己回到论文确认，不会把推断说成事实。
            </li>
          </ul>
        </div>
        <figure className="cap-fig">
          <div className="g-rel" aria-hidden="true">
            <svg viewBox="0 0 320 96" role="presentation">
              <path className="drawline solid" pathLength={1} d="M 58 48 L 158 48" />
              <path className="drawline dash" pathLength={1} d="M 162 74 C 210 74 214 30 262 30" />
              <rect className="g-node" x="10" y="34" width="48" height="28" rx="7" />
              <rect className="g-node" x="262" y="16" width="48" height="28" rx="7" />
              <rect className="g-node" x="262" y="60" width="48" height="28" rx="7" />
            </svg>
            <div className="g-legend">
              <span className="k">
                <i className="sw solid" /> 原文明示
              </span>
              <span className="k">
                <i className="sw dash" /> 系统推断
              </span>
            </div>
          </div>
          <figcaption>方法分组与关联</figcaption>
        </figure>
      </section>

      {/* ---------------- 03 决定先读什么 ---------------- */}
      <section className="cap reveal" aria-labelledby="cap-3">
        <div className="cap-text">
          <span className="cap-no">03</span>
          <h3 id="cap-3">决定先读什么</h3>
          <p className="cap-lead">结合你的基础与目标给一份阅读顺序，每篇都说明该重点看什么、为什么值得先读。</p>
          <ul className="cap-list">
            <li>
              <b>你会看到</b>：一份有先后顺序的阅读清单，每篇标注重点，并写清推荐理由的依据。
            </li>
            <li>
              <b>你可以</b>：告诉它你的方向、时间与算力条件，随时重新生成；条件变了顺序也会跟着变。
            </li>
            <li>
              <b>你会得到</b>：能照着读的路线，而不是一堆需要自己排序的论文，也不会因为暂时没有算力就被劝退。
            </li>
          </ul>
        </div>
        <figure className="cap-fig">
          <ol className="g-order" aria-hidden="true">
            <li>
              <b>1</b>
              <span className="t">基础方法</span>
              <em>重点看：核心思路</em>
            </li>
            <li>
              <b>2</b>
              <span className="t">改进版本</span>
              <em>重点看：与前一版的差异</em>
            </li>
            <li>
              <b>3</b>
              <span className="t">最新工作</span>
              <em>重点看：实验条件是否可比</em>
            </li>
          </ol>
          <figcaption>阅读路线</figcaption>
        </figure>
      </section>

      <p className="disclaimer reveal">上图为功能示意，非真实分析结果。</p>
    </div>
  );
}
