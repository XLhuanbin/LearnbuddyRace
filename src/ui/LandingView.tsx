import React from 'react';

interface Props {
  onExperienceCase: () => void;
  onUploadOwn: () => void;
}

/**
 * 宣传型首页：只做三件事——
 * 1. 一句话说明产品做什么；2. 一句话说明解决什么问题；3. 提供入口进入 Demo / 上传自己的论文。
 *
 * 刻意不显示：论文数量、实验记录数、版本号、API 配置、缓存说明、开发状态与技术规则。
 * 示意图是**示意**，不是真实分析结果（页面已标明）。
 */
export function LandingView({ onExperienceCase, onUploadOwn }: Props) {
  return (
    <div className="landing">
      <section className="lead-block">
        <h1>把一组论文，变成你看得懂的研究地图。</h1>
        <p className="sub">
          看懂各类方法解决了什么、彼此如何发展，以及你应该先读哪篇。关键结论都能回到原文。
        </p>
      </section>

      <div className="kw-row">
        <span className="kw">
          <span className="dot">1</span>
          <b>看懂方法差异</b>
        </span>
        <span className="kw">
          <span className="dot">2</span>
          <b>理清技术关系</b>
        </span>
        <span className="kw">
          <span className="dot">3</span>
          <b>决定先读什么</b>
        </span>
      </div>

      {/* 抽象示意图：一组论文 → 方法分组与关联 → 阅读路线（示意，不是真实分析结果） */}
      <div className="abstract" aria-hidden="true">
        <div className="mini">
          <div className="t">一组论文</div>
          <div className="n" style={{ fontSize: 18 }}>
            5 篇
          </div>
          <div className="m">同一方向的论文集合</div>
        </div>
        <div className="arrow">→</div>
        <div className="mini">
          <div className="t">方法分组与关联</div>
          <div className="n" style={{ fontSize: 18 }}>
            2 组 · 10 条关系
          </div>
          <div className="m">按技术思路归类，关系有原文依据</div>
        </div>
        <div className="arrow">→</div>
        <div className="concl" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}>
          <b style={{ color: 'var(--accent-2)' }}>阅读路线</b>
          <span>先读哪篇、顺序、每篇重点看什么，都有理由。</span>
        </div>
      </div>
      <p className="small dim" style={{ textAlign: 'center', marginTop: -8 }}>
        上图为功能示意，非真实分析结果。
      </p>

      <div className="cta-row">
        <button className="btn primary lg" onClick={onExperienceCase}>
          体验视觉论文案例
        </button>
        <button className="btn lg" onClick={onUploadOwn}>
          上传我的论文
        </button>
      </div>
    </div>
  );
}
