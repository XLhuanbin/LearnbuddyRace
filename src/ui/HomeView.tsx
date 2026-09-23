import React from 'react';
import type { CorpusScope } from '../core/corpus';
import type { CorpusId, Method, Paper } from '../core/types';
import { NextStep, Status } from './common';

type Tab = 'home' | 'library' | 'experiments' | 'compare' | 'graph' | 'decision' | 'divergence' | 'settings' | 'status';

interface Props {
  corpus: 'vision' | 'nlp-dev';
  onSwitchCorpus: (c: 'vision' | 'nlp-dev') => void;
  onLoadSample: () => void;
  papers: Paper[];
  methods: Method[];
  scope: CorpusScope;
  corpusLoading: 'vision' | 'nlp-dev' | null;
  loadResult?: { key: 'vision' | 'nlp-dev'; ok: boolean; papers: number; experiments: number; relations: number; message: string; at: number };
  modelReady: boolean;
  onGo: (tab: Tab) => void;
  onOpenSettings: () => void;
}

/**
 * 首屏：几秒内回答「这是什么 / 它能帮我做什么 / 我从哪里开始」。
 * 同时用**当前语料范围**（scope）显示论文数、实验数，以及缓存/实时与加载状态。
 */
export function HomeView({ onLoadSample, scope, corpusLoading, loadResult, onGo }: Props) {
  const loaded = scope.paperCount > 0;
  const loading = corpusLoading === scope.key;
  const vision = scope.key === 'vision';

  return (
    <div>
      <section className="welcome">
        <span className="eyebrow">ResearchPilot · 视觉论文研究工作台</span>
        <h1>别急着比较分数，先确认论文到底在比较什么。</h1>
        <p className="sub">
          ResearchPilot 帮你从论文原文、实验条件和方法关系出发，判断视觉论文的结果是否真的可比——
          每个数值都能回到原文的一行，并明确告诉你哪些能直接比、哪些只能结合条件讨论、哪些信息不足不能比。
        </p>
        <div className="cta-row">
          <button className="btn primary lg" onClick={() => onLoadSample()} disabled={loading}>
            {loading ? '正在加载…' : loaded ? '重新加载演示案例' : '开始分析视觉论文'}
          </button>
          <button className="btn lg" onClick={() => onGo(loaded ? 'experiments' : 'library')}>
            查看演示案例
          </button>
          <span className="cta-note">
            {loading
              ? '正在载入论文与分析结果，请稍候…'
              : loaded
                ? loadResult?.ok
                  ? `已就绪：${scope.presetPaperCount} 篇论文 · ${scope.experimentCount} 条实验记录 · ${loadResult.relations} 条方法关系`
                  : '上次加载未完成，可点击左侧按钮重试；已有数据保持不变。'
                : '演示案例含 5 篇 ImageNet 分类论文（ResNet / ViT / DeiT / Swin / ConvNeXt），加载后即可开始。'}
          </span>
        </div>
      </section>

      <div className="corpus-card primary">
        <div className="title">
          <b>当前语料集：{scope.meta.label}</b>
          <Status kind={vision ? 'ok' : 'cached'}>{vision ? '正式演示案例' : '仅用于回归测试'}</Status>
          {loaded && <Status kind="cached">缓存案例</Status>}
          {loading && <Status kind="info">加载中</Status>}
          {loadResult && !loadResult.ok && <Status kind="bad">上次加载失败</Status>}
          {scope.foreignPapers.length > 0 && <Status kind="pending">另有 {scope.foreignPapers.length} 篇属其它语料集</Status>}
        </div>
        <div className="case-facts">
          <div className="f">
            <div className="v">{scope.paperCount}</div>
            <div className="k">论文（当前语料）</div>
          </div>
          <div className="f">
            <div className="v">{scope.experimentCount}</div>
            <div className="k">实验记录</div>
          </div>
          <div className="f">
            <div className="v">{scope.meta.domain}</div>
            <div className="k">研究领域</div>
          </div>
          <div className="f">
            <div className="v">{loaded ? '缓存（离线真实模型生成）' : '未加载'}</div>
            <div className="k">结果来源</div>
          </div>
        </div>
        <p className="meta" style={{ margin: 0 }}>
          {scope.meta.purpose}；两套语料各自独立计算关系与推荐，不会混在一起。
        </p>
      </div>

      <h2 className="page" style={{ marginBottom: 4 }}>
        三步完成一次调研
      </h2>
      <p className="lead" style={{ marginBottom: 16 }}>
        不需要先读说明，也不需要配置模型：预置案例已经由真实模型离线分析好，并标明来源。
      </p>

      <div className="flowcards">
        <button className="flowcard" onClick={() => onGo('library')}>
          <span className="k">1</span>
          <b>选择论文</b>
          <p>
            加载演示案例，或上传自己的 PDF。每篇论文都被拆成研究任务、核心思路、训练条件等字段，
            每条字段都带可核验的原文引文。
          </p>
        </button>
        <button className="flowcard" onClick={() => onGo('experiments')}>
          <span className="k">2</span>
          <b>检查实验能否公平比较</b>
          <p>
            以「一条实验记录」为单位对照预训练数据、评估集与划分、分辨率、蒸馏、测试时增强等条件，
            再判断两个数值是不是同一个口径。
          </p>
        </button>
        <button className="flowcard" onClick={() => onGo('graph')}>
          <span className="k">3</span>
          <b>根据证据理解方法演进</b>
          <p>
            看方法之间的原文关系（原文明示 / 系统推断 / 待核查），并按你的基础与目标得到先读哪篇的建议。
          </p>
        </button>
      </div>

      {loaded && (
        <NextStep
          title="案例已就绪"
          desc={`当前语料集共 ${scope.paperCount} 篇论文、${scope.experimentCount} 条实验记录。下一步建议进「实验比较」，挑两条实验看它们能不能直接比。`}
          actionLabel="进入实验比较"
          onAction={() => onGo('experiments')}
          secondary={{ label: '先看论文库', onAction: () => onGo('library') }}
        />
      )}

      <details className="fold" style={{ marginTop: 20 }}>
        <summary>
          这个工作台的判断原则与边界（{vision ? '演示案例' : '回归样例'}）
        </summary>
        <div className="fold-body">
          <p>
            <strong>证据优先。</strong>字段、数值与结论都必须带一条能在全文里定位到的原文引文；
            定位不到就标「待人工核对」或「未找到证据」，不使用模型自称的页码。
          </p>
          <p>
            <strong>实验为单位。</strong>比较的是「某个模型变体 + 一套训练/评估条件」，不是整篇论文；
            都写 ImageNet 或 top-1 并不等于可比。
          </p>
          <p>
            <strong>待核查不等于有错。</strong>数值能定位但表格行列无法用版面确认时，一律标「待核查」，
            不进入「可直接比较」，也不参与排名。
          </p>
          <p>
            <strong>不做的事。</strong>不排名、不给「某种架构本身更优」的因果结论、不生成假引用；
            论文证据判断 ≠ 已经在你的设备上跑过。
          </p>
        </div>
      </details>
    </div>
  );
}
