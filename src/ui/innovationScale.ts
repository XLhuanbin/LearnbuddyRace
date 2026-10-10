/**
 * 创新度分档 —— **全站唯一一处定义**
 *
 * 为什么必须抽出来：草稿 `f3570956`（分析结果页）、`17763ea3`（研究地图）、`6db41280`（论文库主页）、
 * `bab0a034`（跨论文对比表）、`c122c572`（阅读路线）**五张稿都用同一套阈值与配色**：
 *   - 分析结果页：三张指标卡里的「创新度评分」
 *   - 研究地图：图例与网络节点的配色依据
 *   - 论文库：平均创新评分、每行 score-badge、右栏「创新度分布」
 *   - 对比表：每列的「8.7 / 10」
 *   - 阅读路线：每一步的「8.9」
 * 三档阈值（8.5+ / 7.0-8.5 / <7.0）与颜色若散在各页，改一处就会漏四处。
 *
 * ⚠️ 诚实口径：创新度是**模型评估**，不是论文给出的分数。凡展示这两个字的地方都要标明这一点；
 *    没有评估结果的论文一律走中性色，绝不凭猜测上色。
 */

export type InnovationTierKey = 'high' | 'mid' | 'low';

export interface InnovationTier {
  key: InnovationTierKey;
  /** 下限（含）—— 从高到低排列，取第一个满足的档 */
  min: number;
  /** 图例/说明用的一句话标签（草稿原文口径，含阈值，便于用户自行核对） */
  label: string;
  /** 颜色走 CSS 令牌（在 draft.css 里统一给），不在 JS 里重复写色值 */
  color: string;
}

/** 从高到低，取第一个 score >= min 的档 */
export const INNOVATION_TIERS: InnovationTier[] = [
  { key: 'high', min: 8.5, label: '革命性创新 (创新度 > 8.5)', color: 'var(--score-high)' },
  { key: 'mid', min: 7.0, label: '重要改进 (7.0 - 8.5)', color: 'var(--score-mid)' },
  { key: 'low', min: -Infinity, label: '常规优化 (< 7.0)', color: 'var(--score-low)' },
];

/** 没有评估结果时的中性色（灰色） */
export const INNOVATION_NEUTRAL = 'var(--score-none)';

/** 取某一分数所属档位；没有评估结果返回 undefined */
export function innovationTier(score: number | undefined): InnovationTier | undefined {
  if (typeof score !== 'number' || !Number.isFinite(score)) return undefined;
  return INNOVATION_TIERS.find((t) => score >= t.min);
}

/** 取某一分数的配色；没有评估结果返回中性色 */
export function innovationColor(score: number | undefined): string {
  return innovationTier(score)?.color ?? INNOVATION_NEUTRAL;
}

/** score-badge 用的类名后缀（与 INNOVATION_TIERS 的 key 一致） */
export function innovationBadgeClass(score: number | undefined): string {
  return `score-badge score-${innovationTier(score)?.key ?? 'none'}`;
}
