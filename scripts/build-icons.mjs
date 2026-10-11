/**
 * 生成图标的内联组件（数据取自 Iconify API）
 * ---------------------------------------------------------------------------
 * 为什么不用 iconify-icon 运行时组件：草稿是靠 CDN 提供的；本作品是自包含静态站，
 * 不能在运行时依赖外部 CDN（国内访问也不稳）。这里一次性把**图标集的原始 path**
 * 拉下来内联，渲染出的图形与草稿完全一致，但没有运行时依赖。
 *
 * 两个来源：
 *  - `lucide`  —— 界面上的线形图标（与草稿 `<iconify-icon icon="lucide:xxx">` 同一套）
 *  - `logos`   —— Simple Icons 的**真实品牌标志**（草稿的技术墙用的就是 `logos:react` 之类，
 *                 之前只能拿 lucide 的通用图形顶替；现在直接上真图标）
 *
 * 用法：node scripts/build-icons.mjs
 * 产物：src/draft-icons.tsx（勿手改）
 */
import { writeFileSync } from 'node:fs';

/** 草稿里用到的全部 lucide 图标（做新页面时把新出现的名字加进来再重跑） */
const NAMES = [
  // 方法提取页（草稿 a6947252）
  'arrow-left',
  'user',
  'upload-cloud',
  'info',
  'file-text',
  'x',
  'loader-2',
  // 分析结果页（草稿 f3570956）
  'share-2',
  'download',
  'plus',
  'sparkles',
  'layers',
  'link-2',
  'chevron-down',
  'chevron-right',
  'lightbulb',
  'arrow-up-right',
  'map',
  'arrow-right',
  // 分析结果页 v2「指标优化版」：六张指标卡换了标志图标
  'check-circle-2',
  'table-2',
  'book-open',
  // 研究地图（草稿 17763ea3 v3）
  'network',
  'git-branch',
  'search',
  'filter',
  'zoom-in',
  'zoom-out',
  'maximize',
  'mouse-pointer-2',
  'star',
  // 论文库主页（草稿 6db41280）
  'map-pin',
  'upload',
  // 跨论文对比表（草稿 bab0a034）
  'edit-3',
  'library',
  // 阅读路线（草稿 c122c572）
  'calendar',
  'settings-2',
  'lock',
  'file-down',
  'home',
  // 阅读路线 v7：证据链区块
  'quote',
  'target',
  'external-link',
  // 待调查问题（草稿 2b574366）：草稿的 star / check-circle 换成了真实操作，
  // 只新增「加载更多问题」用的 refresh-cw（book-open / download / search / sparkles / arrow-up-right 上面已有）
  'refresh-cw',
  // 版本信息与更新历史（草稿 0b5dcfda）
  'git-graph',
  'compass',
  // 同上：草稿这页用 logos:* 品牌图标画技术栈，本项目自包含不能依赖 CDN，统一换成 lucide 表意图标
  'file-code',
  'zap',
  'wind',
  'database',
  'cloud',
  'brain-circuit',
  'terminal',
  'eye',
  // 未来展望与功能建议（草稿 4bdccae1）
  'plus-circle',
  'arrow-up-circle',
  'arrow-up',
  'check-circle',
  'timer',
  // 投票后的对勾（草稿点完把图标换成 lucide:check）
  'check',
];

/**
 * 技术墙的真实品牌标志（Simple Icons / Iconify 的 `logos` 集）。
 * 没有品牌标志的三项（pdf.js / IndexedDB / LearnBuddy）继续用 lucide 表意图形 ——
 * 草稿自己也是这么混用的（它的 LearnBuddy 就是 lucide:brain-circuit）。
 */
const LOGOS = ['react', 'typescript-icon', 'vite-icon', 'tailwindcss-icon', 'nodejs-icon', 'chrome', 'deepseek-icon'];

async function fetchSet(prefix, names) {
  const url = `https://api.iconify.design/${prefix}.json?icons=${names.join(',')}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    console.error(`★ 拉取 ${prefix} 失败：${res.status} ${res.statusText}`);
    process.exit(1);
  }
  return res.json();
}

const lucide = await fetchSet('lucide', NAMES);
const logos = await fetchSet('logos', LOGOS);
const W = lucide.width ?? 24;
const H = lucide.height ?? 24;

const entries = [];
const boxes = [];
const missing = [];
const take = (data, names, prefix) => {
  const dw = data.width ?? 24;
  const dh = data.height ?? 24;
  for (const n of names) {
    let ic = data.icons?.[n];
    if (!ic) {
      const parent = data.aliases?.[n]?.parent;
      if (parent && data.icons?.[parent]) ic = data.icons[parent];
    }
    if (!ic?.body) {
      missing.push(`${prefix}:${n}`);
      continue;
    }
    entries.push([n, ic.body]);
    // 品牌标志是 256×256 画布，且每个图标高度可能不同（react 228 / vite 157）；按图标各自带 viewBox
    const w = ic.width ?? dw;
    const h = ic.height ?? dh;
    if (w !== 24 || h !== 24) boxes.push([n, `0 0 ${w} ${h}`]);
  }
};
take(lucide, NAMES, 'lucide');
take(logos, LOGOS, 'logos');
if (missing.length) {
  console.error(`★ 以下图标找不到：${missing.join(', ')}`);
  process.exit(1);
}

const out = `/**
 * 草稿图标（内联）—— **由 scripts/build-icons.mjs 生成，请勿手改**
 * 数据来源：Iconify API
 *   - lucide 线形图标（与草稿 \`<iconify-icon icon="lucide:xxx">\` 同一套图形）
 *   - logos（Simple Icons）真实品牌标志（与草稿 \`<iconify-icon icon="logos:xxx">\` 同一套图形）
 * 用法：<DraftIcon name="upload-cloud" className="text-4xl text-[var(--accent)]" />
 * 说明：尺寸取 \`1em\`、颜色取 \`currentColor\`（svg 上带 fill="currentColor"，lucide 自己的
 *       fill="none"/stroke 优先），因此和 iconify-icon 一样完全跟随父级 font-size / color，
 *       可以直接配合 Tailwind 的 text-* 使用。
 */
import React from 'react';

const DATA: Record<string, string> = {
${entries.map(([n, b]) => `  ${JSON.stringify(n)}: ${JSON.stringify(b)},`).join('\n')}
};

/** 画布不是 24×24 的图标（品牌标志多为 256×N）；不在这个表里的按 24×24 处理 */
const BOX: Record<string, string> = {
${boxes.map(([n, v]) => `  ${JSON.stringify(n)}: ${JSON.stringify(v)},`).join('\n')}
};

export function DraftIcon({
  name,
  className,
  style,
  'aria-hidden': ariaHidden = true,
}: {
  name: string;
  className?: string;
  style?: React.CSSProperties;
  'aria-hidden'?: boolean;
}) {
  const body = DATA[name];
  if (!body) return null;
  return (
    <svg
      viewBox={BOX[name] ?? "0 0 ${W} ${H}"}
      width="1em"
      height="1em"
      fill="currentColor"
      className={className}
      style={{ display: 'inline-block', verticalAlign: '-0.125em', ...style }}
      aria-hidden={ariaHidden}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}

export const DRAFT_ICON_NAMES = Object.keys(DATA);
`;

writeFileSync('src/draft-icons.tsx', out, 'utf8');
console.log(
  `写出 src/draft-icons.tsx：${entries.length} 个图标（lucide ${NAMES.length} + logos ${LOGOS.length}）`,
);
