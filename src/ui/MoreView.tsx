import React from 'react';
import type { CorpusKey, CorpusScope } from '../core/corpus';
import { Status } from './common';

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
  | 'status';

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
  const items: { tab: Tab; title: string; desc: string }[] = [
    { tab: 'library', title: '论文集合（原始字段）', desc: '每篇论文解析出来的字段、实验条件与程序校验记录' },
    { tab: 'experiments', title: '全部结果与条件（专业视图）', desc: '按论文筛选全部结果，逐个对照训练条件与原始表格' },
    { tab: 'graph', title: '方法关系图（完整）', desc: '所有方法与关系，含证据状态与人工修正入口' },
    { tab: 'decision', title: '阅读路线（完整版）', desc: '按你的基础、时间与算力条件生成阅读路径' },
    { tab: 'divergence', title: '待调查问题', desc: '跨论文的分歧与仍未解决的问题' },
    { tab: 'compare', title: '跨论文比较（论文级）', desc: '以整篇论文为单位比较评估口径是否一致' },
    { tab: 'status', title: '开发状态与记录', desc: '规则版本、缓存版本、验证范围、模型调用记录与运行日志' },
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

      <div className="moregrid">
        {items.map((it) => (
          <button key={it.tab} className="morecard" onClick={() => onGo(it.tab)}>
            <b>{it.title}</b>
            <span>{it.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
