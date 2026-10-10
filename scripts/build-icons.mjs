/**
 * 生成 lucide 图标的内联组件（数据取自 Iconify API 的 lucide 原始集）
 * ---------------------------------------------------------------------------
 * 为什么不用 iconify-icon 运行时组件：草稿是靠 CDN 提供的；本作品是自包含静态站，
 * 不能在运行时依赖外部 CDN（国内访问也不稳）。这里一次性把**同一个 lucide 图标集的原始 path**
 * 拉下来内联，渲染出的图形与草稿完全一致，但没有运行时依赖。
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
];

const url = `https://api.iconify.design/lucide.json?icons=${NAMES.join(',')}`;
const res = await fetch(url, { headers: { accept: 'application/json' } });
if (!res.ok) {
  console.error(`★ 拉取失败：${res.status} ${res.statusText}`);
  process.exit(1);
}
const data = await res.json();
const W = data.width ?? 24;
const H = data.height ?? 24;

const entries = [];
const missing = [];
for (const n of NAMES) {
  let body = data.icons?.[n]?.body;
  if (!body) {
    const parent = data.aliases?.[n]?.parent;
    if (parent && data.icons?.[parent]) body = data.icons[parent].body;
  }
  if (!body) missing.push(n);
  else entries.push([n, body]);
}
if (missing.length) {
  console.error(`★ 以下图标在 lucide 里找不到：${missing.join(', ')}`);
  process.exit(1);
}

const out = `/**
 * lucide 图标（内联）—— **由 scripts/build-icons.mjs 生成，请勿手改**
 * 数据来源：Iconify API 的 lucide 图标集（与草稿 \`<iconify-icon icon="lucide:xxx">\` 同一套图形）
 * 用法：<DraftIcon name="upload-cloud" className="text-4xl text-[var(--accent)]" />
 * 说明：尺寸取 \`1em\`、颜色取 \`currentColor\`，因此和 iconify-icon 一样完全跟随父级 font-size / color，
 *       可以直接配合 Tailwind 的 text-* 使用。
 */
import React from 'react';

const DATA: Record<string, string> = {
${entries.map(([n, b]) => `  ${JSON.stringify(n)}: ${JSON.stringify(b)},`).join('\n')}
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
      viewBox="0 0 ${W} ${H}"
      width="1em"
      height="1em"
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
console.log(`写出 src/draft-icons.tsx：${entries.length} 个图标（${NAMES.length} 个请求，含 ${NAMES.length - entries.length} 个别名解析）`);
