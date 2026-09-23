import React from 'react';
import type { CorpusScope } from '../core/corpus';
import type { CorpusKey } from '../core/corpus';

interface Props {
  scope: CorpusScope;
  corpusLoading: CorpusKey | null;
  onStart: () => void;
  onGoResults: () => void;
}

/**
 * Demo 第一步：选择一个案例。
 * 普通用户只看到正式案例；旧的 NLP 样例不出现在这里（它在「更多 → 开发用」里）。
 */
export function CaseView({ scope, corpusLoading, onStart, onGoResults }: Props) {
  const ready = scope.paperCount > 0 && scope.experimentCount > 0;
  const loading = corpusLoading === scope.key;

  return (
    <div className="casepage">
      <h1>选择一个视觉论文案例</h1>
      <div className="casecard">
        <h2>ImageNet 图像分类方法演进</h2>
        <p>
          比较 ResNet、ViT、DeiT、Swin Transformer 和 ConvNeXt 的代表性结果，
          看看不同训练条件下的分数能否直接放在一起比较。
        </p>
        <div className="methods">
          {['ResNet', 'ViT', 'DeiT', 'Swin Transformer', 'ConvNeXt'].map((m) => (
            <span key={m} className="chip">
              {m}
            </span>
          ))}
        </div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          {ready ? (
            <button className="btn primary lg" onClick={onGoResults}>
              开始查看案例
            </button>
          ) : (
            <button className="btn primary lg" onClick={onStart} disabled={loading}>
              {loading ? '正在准备…' : '开始查看案例'}
            </button>
          )}
        </div>
        <p className="small dim" style={{ margin: '14px 0 0' }}>
          案例内的分析结果由真实模型离线生成（缓存案例），每条结论都能回到论文原文；
          判断只针对论文里写清楚的条件，不代表已经在你本机运行过。
        </p>
      </div>
    </div>
  );
}
