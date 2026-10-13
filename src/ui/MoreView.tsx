import React from 'react';
import type { CorpusKey, CorpusScope } from '../core/corpus';
import { SectionHead, Status } from './common';

type Tab =
  | 'landing'
  | 'case'
  | 'results'
  | 'evolution'
  | 'more'
  | 'library'
  | 'experiments'
  | 'compare'
  | 'graph'
  | 'decision'
  | 'divergence'
  | 'settings'
  | 'status'
  | 'version'
  | 'future';

interface Props {
  scope: CorpusScope;
  corpus: CorpusKey;
  onGo: (tab: Tab) => void;
  onSwitchCorpus: (c: CorpusKey) => void;
  modelReady: boolean;
  counts: { papers: number; experiments: number; relations: number; expConfirmed: number };
}

/**
 * 「更多」：面向开发者与评审的次级入口。
 * 普通用户的核心流程（首页 → 比较结果 → 方法演进）不放在这里，这里放细节与开发信息。
 */
export function MoreView({ scope, corpus, onGo, onSwitchCorpus, modelReady, counts }: Props) {
  /**
   * 2026-10-13 用户实测：「未来展望是希望使用者提建议，但把它和开发状态、版本信息放一起，
   * 基本上很少人会去点击查看。」 ⇒ 这里不再是一张扁平的十宫格，而是分三组：
   *   ① 想参与（未来展望）放在最上面、单独高亮；
   *   ② 继续研究（真正的分析页面）；
   *   ③ 记录与信息（开发状态 / 版本 / 设置）—— 评审才会看，放最后。
   */
  const research: { tab: Tab; title: string; desc: string }[] = [
    { tab: 'library', title: '论文集合（原始字段）', desc: '每篇论文解析出来的字段、实验条件与程序校验记录' },
    { tab: 'experiments', title: '全部结果与条件（专业视图）', desc: '按论文筛选全部结果，逐个对照训练条件与原始表格' },
    { tab: 'graph', title: '方法关系图（完整）', desc: '所有方法与关系，含证据状态与人工修正入口' },
    { tab: 'decision', title: '阅读路线（完整版）', desc: '按你的基础、时间与算力条件生成阅读路径' },
    { tab: 'divergence', title: '待调查问题', desc: '跨论文的分歧与仍未解决的问题' },
    { tab: 'compare', title: '跨论文比较（论文级）', desc: '以整篇论文为单位比较评估口径是否一致' },
  ];
  const records: { tab: Tab; title: string; desc: string }[] = [
    { tab: 'status', title: '开发状态与记录', desc: '规则版本、缓存版本、验证范围、模型调用记录与运行日志' },
    { tab: 'version', title: '版本信息与更新历史', desc: '真实版本线、当前能力边界、技术栈与致谢' },
    { tab: 'settings', title: '设置', desc: '模型接口配置（密钥只保存在本机，不会写入产物）' },
  ];

  return (
    <div>
      <div className="morehead">
        <div className="morehead-text">
          <h2 className="page">更多</h2>
          <p className="lead">
            这里是细节与开发信息：面向评审与开发者。普通演示只需要「研究地图」（看懂方法 + 真实关系）和「阅读路线」两页；
            论文集合、实验可比性、方法关系图、待调查问题、跨论文比较、开发状态与设置都放在这里。
          </p>
        </div>
        {/* 淡色装饰字（自首页迁移）：纯装饰，桌面完整显示，窄屏只显示 Research */}
        <div className="deco-wm" aria-hidden="true">
          <span>Research</span>
          <span className="deco-tail">Pilot</span>
        </div>
      </div>

      <div className="card tight" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong style={{ fontSize: 14 }}>当前论文集合：{scope.meta.label}</strong>
          <Status kind={corpus === 'vision' ? 'ok' : 'cached'}>{scope.meta.domain}</Status>
          <Status kind="info">{counts.papers} 篇论文</Status>
          <Status kind="info">{counts.experiments} 条结果</Status>
          <Status kind="info">{counts.relations} 条方法关系</Status>
          <Status kind="ok">行列已核验 {counts.expConfirmed} 条</Status>
          <Status kind="cached">{modelReady ? '模型已配置' : '缓存案例'}</Status>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn ghost sm" onClick={() => onSwitchCorpus(corpus === 'vision' ? 'nlp-dev' : 'vision')}>
            {corpus === 'vision' ? '切换到开发回归样例（NLP）' : '切换到正式视觉案例'}
          </button>
          <span className="small dim">两套论文集合各自独立计算关系与推荐，不会混在一起。</span>
        </div>
      </div>

      {/* ① 想参与：未来展望单独成块、置顶高亮（这是唯一一个希望使用者留下意见的页面） */}
      <section style={{ marginBottom: 28 }}>
        <div className="card tight" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}>
          <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <p className="small dim" style={{ letterSpacing: '.08em', textTransform: 'uppercase' }}>
                想给我们提建议
              </p>
              <h3 style={{ fontSize: 20, fontFamily: 'var(--serif, Georgia, serif)', margin: '6px 0 8px' }}>
                未来展望与功能建议
              </h3>
              <p className="small dim" style={{ lineHeight: 1.7 }}>
                正在做什么、还缺什么、明确不做什么 —— 都写在这一页。页面的勾选只存在你自己的浏览器里，
                可以一键导出成文本再发给我们。
              </p>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => onGo('future')}>
                打开并提建议
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ② 继续研究 */}
      <section style={{ marginBottom: 28 }}>
        <SectionHead title="继续研究" sub="分析与核对的页面" />
        <div className="moregrid">
          {research.map((it) => (
            <button key={it.tab} className="morecard" onClick={() => onGo(it.tab)}>
              <b>{it.title}</b>
              <span>{it.desc}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ③ 记录与信息（开发状态 / 版本 / 设置）：评审与开发者才需要，明确排在最后 */}
      <section>
        <SectionHead title="记录与信息" sub="开发过程与运行信息，评审与开发者用" />
        <div className="moregrid">
          {records.map((it) => (
            <button key={it.tab} className="morecard" onClick={() => onGo(it.tab)}>
              <b>{it.title}</b>
              <span>{it.desc}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
