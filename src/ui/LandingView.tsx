import React, { useEffect } from 'react';

interface Props {
  onExperienceCase: () => void;
  onUploadOwn: () => void;
  onGo: (tab: 'library' | 'upload' | 'map' | 'experiments' | 'decision') => void;
}

/* =====================================================================
 * 宣传首页 —— v8（2026-10-09 按 Superdesign draft abec2060 v8 严格落实）
 *
 * 结构：贯穿全页的编辑脊线 + 超大中文标题首屏 + 核心能力四卡
 *       + 论文集合 / 研究地图 / 阅读路线三段（错落）+ 快速开始示例 + 页脚
 *
 * 与 v8 原型的对应关系：
 *   - v8 用 Tailwind CDN + Google Fonts + iconify；这里全部换成原生 CSS
 *     （.landing / .g12 / .content-card / .illustration-box / .btn-primary …），
 *     数值与 v8 一致，但不引入任何外部依赖。
 *   - v8 的 <header>（fixed + mix-blend-difference）由外壳 AppBrandBar 的
 *     landingbar 形态渲染，见 mapChrome.tsx。
 *   - v8 的 <script>（平滑滚动 + IntersectionObserver）改为 React useEffect。
 *   - 概念图形一律照搬 v8 的自绘 SVG（用户 2026-10-09 明确选择"用 v8 的自绘图"）。
 *   - 装饰性 SVG 补了 aria-hidden（不影响渲染，只补可访问性）。
 * ===================================================================== */

export function LandingView({ onExperienceCase, onUploadOwn, onGo }: Props) {
  /* v8 的第二段脚本：滚动进入 .reveal 时浮现，并激活同一 section 内的脊线节点 */
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.landing .reveal'));
    if (!els.length) return;
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.classList.add('active'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          const node = (e.target as HTMLElement).querySelector('.spine-node');
          if (e.isIntersecting) {
            e.target.classList.add('active');
            node?.classList.add('active');
          } else {
            e.target.classList.remove('active');
            node?.classList.remove('active');
          }
        }),
      { threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="landing">
      <div className="editorial-spine" aria-hidden="true" />
      <div className="landing-main">
        {/* ---------------- 首屏 ---------------- */}
        <section className="hero-sec cascade">
          <div className="g12">
            <div className="col-12 lg-7">
              <p className="eyebrow" style={{ animationDelay: '100ms' }}>
                ResearchPilot — 论文方法梳理智能体
              </p>
              <h1 className="hero-title" style={{ animationDelay: '250ms' }}>
                把一组论文，变成你看得懂的研究地图。
              </h1>
              <p className="hero-lede" style={{ animationDelay: '400ms' }}>
                读懂方法演进，知道先读哪一篇。
              </p>
              <div className="cta-row" style={{ animationDelay: '550ms' }}>
                <button className="btn-primary" id="cta-experience-btn" onClick={onExperienceCase}>
                  体验视觉论文案例
                </button>
                <button className="text-link lg" id="cta-upload-btn" onClick={onUploadOwn}>
                  上传我的论文
                </button>
              </div>
            </div>
            <div className="col-12 lg-5 lg-only" style={{ animationDelay: '600ms' }}>
              {/* 首屏概念图（v8 自绘） */}
              <svg viewBox="0 0 500 400" className="w-full h-auto" style={{ width: '100%', height: 'auto' }} aria-hidden="true">
                <circle cx="50" cy="350" r="8" fill="var(--fig-ink)" />
                <path d="M 50 350 Q 150 300 250 200" className="f-path f-ink" strokeWidth="2.5" />
                <path d="M 250 200 Q 350 100 450 80" className="f-path f-brand" strokeWidth="2" />
                <path d="M 250 200 Q 320 180 430 180" className="f-path f-mid" strokeWidth="1.5" />
                <path d="M 250 200 Q 350 300 440 320" className="f-path f-mid" strokeWidth="1.5" />
                <circle cx="250" cy="200" r="6" fill="var(--fig-ink)" />
                <circle cx="450" cy="80" r="4" fill="var(--fig-brand)" />
                <circle cx="430" cy="180" r="4" fill="var(--fig-mid)" />
                <circle cx="440" cy="320" r="4" fill="var(--fig-mid)" />
                <text x="40" y="380" fill="var(--fig-ink)" fontSize="12" fontWeight="bold">
                  Origin
                </text>
                <text x="430" y="60" fill="var(--fig-brand)" fontSize="12">
                  Pathway A
                </text>
                <text x="445" y="345" fill="var(--fig-mid)" fontSize="12">
                  Pathway B
                </text>
              </svg>
            </div>
          </div>
        </section>

        {/* ---------------- 核心能力 ---------------- */}
        <section id="features" className="sec reveal">
          <div className="spine-node" style={{ top: 0 }} />
          <div className="geometric-mark" />
          <h2 className="sec-title">核心能力</h2>
          <div className="feat-grid">
            <div className="content-card feat-card">
              <div className="feat-icon">
                <svg viewBox="0 0 80 80" aria-hidden="true">
                  <circle cx="40" cy="40" r="25" className="f-path f-pale" strokeWidth="1" />
                  <circle cx="40" cy="40" r="15" className="f-path f-mid" strokeWidth="1.5" />
                  <path d="M 40 15 L 40 65 M 15 40 L 65 40" className="f-path f-brand" strokeWidth="2" />
                  <circle cx="40" cy="40" r="4" fill="var(--fig-brand)" />
                </svg>
              </div>
              <h4 className="feat-name">自动分析方法论</h4>
              <p className="feat-desc">深度解析论文核心算法、实验设计与创新点，提取关键参数。</p>
            </div>
            <div className="content-card feat-card">
              <div className="feat-icon">
                <svg viewBox="0 0 80 80" aria-hidden="true">
                  <path d="M 20 20 L 60 20 M 20 35 L 50 35 M 20 50 L 60 50 M 20 65 L 40 65" className="f-path f-brand" strokeWidth="2.5" />
                  <circle cx="15" cy="20" r="2" fill="var(--fig-brand)" />
                  <circle cx="15" cy="50" r="2" fill="var(--fig-brand)" />
                </svg>
              </div>
              <h4 className="feat-name">生成结构化大纲</h4>
              <p className="feat-desc">将复杂的方法说明重组为清晰的逻辑框架，加速理解效率。</p>
            </div>
            <div className="content-card feat-card">
              <div className="feat-icon">
                <svg viewBox="0 0 80 80" aria-hidden="true">
                  <path d="M 20 60 Q 40 60 60 20" className="f-path f-brand" strokeWidth="2.5" />
                  <path d="M 50 20 L 60 20 L 60 30" className="f-path f-brand" strokeWidth="2.5" />
                  <path d="M 30 65 Q 45 65 55 45" className="f-path f-mid" strokeWidth="1.5" />
                </svg>
              </div>
              <h4 className="feat-name">提供优化建议</h4>
              <p className="feat-desc">基于现有研究对比，为您的复现或改进方向提供参考洞察。</p>
            </div>
            <div className="content-card feat-card">
              <div className="feat-icon">
                <svg viewBox="0 0 80 80" aria-hidden="true">
                  <rect x="15" y="20" width="20" height="30" className="f-path f-mid" strokeWidth="1.5" />
                  <rect x="45" y="20" width="20" height="30" className="f-path f-brand" strokeWidth="2" />
                  <path d="M 35 35 L 45 35" className="f-path f-ink" strokeWidth="1" />
                  <circle cx="40" cy="35" r="2" fill="var(--fig-ink)" />
                </svg>
              </div>
              <h4 className="feat-name">支持多篇对比</h4>
              <p className="feat-desc">一键对比不同方法论的优劣、适用场景及其演进逻辑。</p>
            </div>
          </div>
        </section>

        {/* ---------------- 论文集合 ---------------- */}
        <section id="library" className="sec">
          <div className="spine-node" style={{ top: '50%' }} />
          <div className="g12">
            <div className="col-12 lg-5 reveal">
              <div className="content-card sh-sm">
                <div className="geometric-mark" />
                <h3 className="sec-h3">论文集合</h3>
                <p className="sec-lede">先把论文按技术路线放在一起，再看每篇具体解决了什么。</p>
                <button className="text-link lg" id="sec-library-btn" onClick={() => onGo('library')}>
                  打开论文集合
                </button>
              </div>
            </div>
            <div className="col-12 lg-6s7 reveal">
              <div className="illustration-box">
                {/* 概念图（v8 自绘）：散落页片 → 分类脊线 → 整理后的条目 */}
                <svg viewBox="0 0 640 360" aria-hidden="true">
                  <defs>
                    <marker id="arrow-head-pale" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fig-brand)" />
                    </marker>
                  </defs>
                  <g strokeLinecap="round" strokeLinejoin="round">
                    <rect x="80" y="80" width="40" height="52" rx="2" className="f-path f-pale" strokeWidth="1.2" transform="rotate(-15, 100, 106)" />
                    <rect x="60" y="160" width="40" height="52" rx="2" className="f-path f-pale" strokeWidth="1.2" transform="rotate(10, 80, 186)" />
                    <rect x="90" y="240" width="40" height="52" rx="2" className="f-path f-pale" strokeWidth="1.2" transform="rotate(-5, 110, 266)" />
                    <path d="M 140 100 Q 250 100 320 180" className="f-path f-mid" strokeWidth="1" markerEnd="url(#arrow-head-pale)" />
                    <path d="M 120 180 L 300 180" className="f-path f-mid" strokeWidth="1" markerEnd="url(#arrow-head-pale)" />
                    <path d="M 145 260 Q 250 260 320 180" className="f-path f-mid" strokeWidth="1" markerEnd="url(#arrow-head-pale)" />
                    <line x1="340" y1="100" x2="340" y2="260" className="f-path f-ink" strokeWidth="2.5" />
                    <g transform="translate(360, 130)">
                      <rect x="0" y="0" width="120" height="100" rx="4" className="f-path f-brand" strokeWidth="1.5" fill="var(--bg-3)" />
                      <line x1="20" y1="30" x2="100" y2="30" className="f-path f-brand" strokeWidth="1" />
                      <line x1="20" y1="50" x2="80" y2="50" className="f-path f-mid" strokeWidth="1" />
                      <line x1="20" y1="70" x2="90" y2="70" className="f-path f-mid" strokeWidth="1" />
                    </g>
                  </g>
                </svg>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- 研究地图 ---------------- */}
        <section id="map" className="sec">
          <div className="spine-node" style={{ top: '50%' }} />
          <div className="g12">
            <div className="col-12 lg-6 reveal">
              <div className="illustration-box">
                {/* 概念图（v8 自绘）：中心方法向四个方向生长，虚线表示待核查 */}
                <svg viewBox="0 0 640 360" aria-hidden="true">
                  <defs>
                    <marker id="arrow-solid-brand" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fig-brand)" />
                    </marker>
                    <marker id="arrow-solid-mid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fig-mid)" />
                    </marker>
                    <marker id="arrow-dashed-mid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fig-mid)" />
                    </marker>
                  </defs>
                  <g strokeLinecap="round" strokeLinejoin="round">
                    <path d="M 320 180 L 320 88" className="f-path f-brand" strokeWidth="2" markerEnd="url(#arrow-solid-brand)" />
                    <path d="M 320 180 L 190 245" className="f-path f-brand" strokeWidth="2" markerEnd="url(#arrow-solid-brand)" />
                    <path d="M 320 180 L 452 246" className="f-path f-brand" strokeWidth="2" markerEnd="url(#arrow-solid-brand)" />
                    <path d="M 320 180 L 490 180" className="f-path f-brand" strokeWidth="2" markerEnd="url(#arrow-solid-brand)" />
                    <path d="M 320 80 Q 220 50 185 115" className="f-path f-mid" strokeWidth="1.5" strokeDasharray="4 4" markerEnd="url(#arrow-dashed-mid)" />
                    <path d="M 500 180 Q 520 220 468 246" className="f-path f-mid" strokeWidth="1.5" strokeDasharray="4 4" markerEnd="url(#arrow-dashed-mid)" />
                    <path d="M 320 80 Q 420 80 492 172" className="f-path f-mid" strokeWidth="1.5" markerEnd="url(#arrow-solid-mid)" />
                    <path d="M 460 250 L 192 250" className="f-path f-mid" strokeWidth="1.5" markerEnd="url(#arrow-solid-mid)" />
                    <circle cx="320" cy="180" r="12" fill="var(--fig-brand)" className="f-path f-ink" strokeWidth="2" />
                    <circle cx="320" cy="80" r="6" fill="var(--fig-ink)" />
                    <circle cx="180" cy="250" r="6" fill="var(--fig-mid)" />
                    <circle cx="460" cy="250" r="6" fill="var(--fig-mid)" />
                    <circle cx="500" cy="180" r="6" fill="var(--fig-ink)" />
                    <circle cx="180" cy="120" r="4" fill="var(--fig-pale)" stroke="var(--fig-mid)" strokeWidth="1" />
                  </g>
                </svg>
              </div>
            </div>
            <div className="col-12 lg-5s8 reveal">
              <div className="content-card sh-sm">
                <div className="geometric-mark" />
                <h3 className="sec-h3">研究地图</h3>
                <p className="sec-lede">看清方法之间的联系、区别和证据状态。</p>
                <button className="text-link lg" id="sec-map-btn" onClick={() => onGo('map')}>
                  打开研究地图
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- 阅读路线 ---------------- */}
        <section id="route" className="sec">
          <div className="spine-node" style={{ top: '50%' }} />
          <div className="g12">
            <div className="col-12 lg-5 reveal">
              <div className="content-card sh-sm">
                <div className="geometric-mark" />
                <h3 className="sec-h3">阅读路线</h3>
                <p className="sec-lede">先读哪篇，以及读每篇时重点看什么。</p>
                <button className="text-link lg" id="sec-route-btn" onClick={() => onGo('decision')}>
                  查看阅读路线
                </button>
              </div>
            </div>
            <div className="col-12 lg-6s7 reveal">
              <div className="illustration-box">
                {/* 概念图（v8 自绘）：从起点沿一条明确顺序推进到终点 */}
                <svg viewBox="0 0 640 360" aria-hidden="true">
                  <defs>
                    <marker id="reading-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fig-ink)" />
                    </marker>
                  </defs>
                  <g strokeLinecap="round" strokeLinejoin="round">
                    <path d="M 100 180 C 180 100 280 100 320 180 C 360 260 460 260 540 180" className="f-path f-brand" strokeWidth="2.5" markerEnd="url(#reading-arrow)" />
                    <g transform="translate(100, 180)">
                      <circle r="12" fill="var(--fig-ink)" />
                      <text y="4" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">
                        01
                      </text>
                    </g>
                    <g transform="translate(210, 120)">
                      <circle r="10" fill="white" stroke="var(--fig-brand)" strokeWidth="2" />
                      <text y="3.5" textAnchor="middle" fill="var(--fig-brand)" fontSize="9" fontWeight="bold">
                        02
                      </text>
                    </g>
                    <g transform="translate(320, 180)">
                      <circle r="10" fill="white" stroke="var(--fig-brand)" strokeWidth="2" />
                      <text y="3.5" textAnchor="middle" fill="var(--fig-brand)" fontSize="9" fontWeight="bold">
                        03
                      </text>
                    </g>
                    <g transform="translate(430, 240)">
                      <circle r="10" fill="white" stroke="var(--fig-brand)" strokeWidth="2" />
                      <text y="3.5" textAnchor="middle" fill="var(--fig-brand)" fontSize="9" fontWeight="bold">
                        04
                      </text>
                    </g>
                    <g transform="translate(540, 180)">
                      <circle r="12" fill="var(--fig-brand)" />
                      <text y="4" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">
                        05
                      </text>
                    </g>
                  </g>
                </svg>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- 快速开始示例 ---------------- */}
        <section id="quickstart" className="sec" style={{ marginBottom: 96 }}>
          <div className="spine-node" style={{ top: '50%' }} />
          <div className="g12">
            <div className="col-12 reveal">
              <div className="content-card qs-card">
                <h3 className="qs-title">快速开始示例</h3>
                <div className="qs-flow">
                  <div className="qs-row">
                    <div className="qs-col">
                      <p className="qs-label">上传论文 / Raw Inputs</p>
                      <div className="qs-art">
                        <svg viewBox="0 0 200 150" aria-hidden="true">
                          <g className="f-path">
                            <rect x="60" y="30" width="45" height="60" rx="2" className="f-pale" strokeWidth="1.5" fill="white" />
                            <line x1="70" y1="45" x2="95" y2="45" stroke="var(--fig-pale)" strokeWidth="1" />
                            <line x1="70" y1="55" x2="90" y2="55" stroke="var(--fig-pale)" strokeWidth="1" />
                            <rect x="75" y="45" width="45" height="60" rx="2" className="f-pale" strokeWidth="1.5" fill="white" />
                            <line x1="85" y1="60" x2="110" y2="60" stroke="var(--fig-pale)" strokeWidth="1" />
                            <line x1="85" y1="70" x2="105" y2="70" stroke="var(--fig-pale)" strokeWidth="1" />
                            <rect x="90" y="60" width="45" height="60" rx="2" className="f-mid" strokeWidth="1.5" fill="white" />
                            <line x1="100" y1="75" x2="125" y2="75" stroke="var(--fig-mid)" strokeWidth="1" />
                            <line x1="100" y1="85" x2="120" y2="85" stroke="var(--fig-mid)" strokeWidth="1" />
                          </g>
                        </svg>
                      </div>
                    </div>

                    <div className="qs-col-mid">
                      <div className="qs-mid-in">
                        <div className="qs-mid-art">
                          <svg viewBox="0 0 100 40" className="qs-mid-arrow" aria-hidden="true">
                            <defs>
                              <marker id="arrow-head-accent-fixed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
                              </marker>
                            </defs>
                            <path d="M 0 20 L 90 20" className="f-path" stroke="var(--accent)" strokeWidth="3" markerEnd="url(#arrow-head-accent-fixed)" fill="none" />
                          </svg>
                          <span className="qs-mid-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 4v16M6 14l6 6 6-6" />
                            </svg>
                          </span>
                        </div>
                        <span className="qs-mid-label">Transform</span>
                      </div>
                    </div>

                    <div className="qs-col">
                      <p className="qs-label on">得到研究地图 / Visual Map</p>
                      <div className="qs-art">
                        <svg viewBox="0 0 200 150" aria-hidden="true">
                          <g strokeLinecap="round" strokeLinejoin="round">
                            <path d="M 100 75 L 100 35 M 100 75 L 40 105 M 100 75 L 160 105" className="f-path f-brand" strokeWidth="2.5" />
                            <circle cx="100" cy="75" r="8" fill="var(--fig-brand)" className="f-path f-ink" strokeWidth="1.5" />
                            <circle cx="100" cy="35" r="4" fill="var(--fig-ink)" />
                            <circle cx="40" cy="105" r="4" fill="var(--fig-mid)" />
                            <circle cx="160" cy="105" r="4" fill="var(--fig-mid)" />
                            <path d="M 100 35 Q 150 40 160 105" className="f-path f-mid" strokeWidth="1" strokeDasharray="3 3" />
                          </g>
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div className="qs-cta">
                    <button className="btn-primary" id="quickstart-btn" onClick={onUploadOwn}>
                      立即尝试梳理
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ---------------- 页脚 ---------------- */}
      <footer className="sitefoot">
        <div className="foot-in">
          <div className="foot-top">
            <div className="foot-c6">
              <h2 className="foot-h2">安静的研究编辑部</h2>
              <p className="foot-lede">学术、克制、可信，为严谨的研究者设计。</p>
            </div>
            <div className="foot-c3">
              <h4 className="foot-lab">功能入口</h4>
              <div className="foot-links">
                <button className="text-link" id="foot-lib" onClick={() => onGo('library')}>
                  论文集合
                </button>
                <button className="text-link" id="foot-map" onClick={() => onGo('map')}>
                  研究地图
                </button>
                <button className="text-link" id="foot-route" onClick={() => onGo('decision')}>
                  阅读路线
                </button>
              </div>
            </div>
            <div className="foot-c3">
              <h4 className="foot-lab">关于我们</h4>
              <div className="foot-links">
                <button className="text-link" id="foot-dev" onClick={() => onGo('experiments')}>
                  开发状态
                </button>
                <button className="text-link" id="foot-set" onClick={() => onGo('experiments')}>
                  偏好设置
                </button>
              </div>
            </div>
          </div>
          <div className="foot-bottom">
            <p className="disclaimer">
              以上配图为<strong>产品概念示意</strong>，不代表当前案例的真实关系数量与证据状态；真实的分组、关系与阅读顺序在研究地图与阅读路线页按证据展示。
            </p>
            <p className="foot-copy">© 2026 ResearchPilot. 基于墨蓝设计系统构建.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
