import React from 'react';

interface Props {
  onExperienceCase: () => void;
  onUploadOwn: () => void;
}

/**
 * 宣传型首页：学术出版物气质。
 *
 * 结构（自上而下）：
 * 1. 若隐若现的超大品牌字（纯装饰，不承载信息，aria-hidden，pointer-events:none）
 * 2. 眉标 + 主标题（衬线）+ 副标题 + 两个入口（首屏内、看得见、点得到）
 * 3. 三项能力（编号排版，不是卡片堆叠）
 * 4. 克制的流程示意（一组论文 → 方法分组与关联 → 阅读路线），并标明是示意
 *
 * 刻意不显示：论文数量、实验记录数、版本号、API 配置、缓存说明、开发状态与技术规则。
 */
export function LandingView({ onExperienceCase, onUploadOwn }: Props) {
  return (
    <div className="landing">
      {/* 装饰性超大品牌字：只在背景层，不参与布局与语义 */}
      <div className="wm" aria-hidden="true">
        ResearchPilot
      </div>

      <section className="lead-block">
        <p className="eyebrow">
          <span className="rule" aria-hidden="true" />
          论文方法梳理智能体
        </p>
        <h1>把一组论文，变成你看得懂的研究地图。</h1>
        <p className="sub">看懂各类方法解决了什么、彼此如何发展，以及你应该先读哪篇。关键结论都能回到原文。</p>
        <div className="cta-row">
          <button className="btn primary lg" onClick={onExperienceCase}>
            体验视觉论文案例
          </button>
          <button className="btn lg" onClick={onUploadOwn}>
            上传我的论文
          </button>
        </div>
      </section>

      {/* 三项能力：编号排版块（不是卡片） */}
      <section className="faculties">
        <div className="fac">
          <span className="no">01</span>
          <b>看懂方法差异</b>
          <p>同方向的论文按技术思路归类，一句话说清每篇在做什么。</p>
        </div>
        <div className="fac">
          <span className="no">02</span>
          <b>理清技术关系</b>
          <p>只按原文里的真实关系连线，标注原文明示或系统推断。</p>
        </div>
        <div className="fac">
          <span className="no">03</span>
          <b>决定先读什么</b>
          <p>结合你的基础与目标，给出顺序、重点与理由。</p>
        </div>
      </section>

      {/* 流程示意：一条轴线 + 三个节点（克制图形，非真实数据） */}
      <section className="dlg" aria-label="流程示意">
        <div className="axis" aria-hidden="true">
          <span className="node" />
          <span className="track" />
          <span className="node" />
          <span className="track" />
          <span className="node" />
        </div>
        <div className="caption">
          <div className="cap">
            <b>一组论文</b>
            <span>同一方向的论文集合</span>
          </div>
          <div className="cap">
            <b>方法分组与关联</b>
            <span>按技术思路归类，关系有原文依据</span>
          </div>
          <div className="cap">
            <b>阅读路线</b>
            <span>先读哪篇、顺序、每篇重点看什么</span>
          </div>
        </div>
        <p className="disclaimer">上图为功能示意，非真实分析结果。</p>
      </section>
    </div>
  );
}
