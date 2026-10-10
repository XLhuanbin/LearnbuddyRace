/**
 * lucide 图标（内联）—— **由 scripts/build-icons.mjs 生成，请勿手改**
 * 数据来源：Iconify API 的 lucide 图标集（与草稿 `<iconify-icon icon="lucide:xxx">` 同一套图形）
 * 用法：<DraftIcon name="upload-cloud" className="text-4xl text-[var(--accent)]" />
 * 说明：尺寸取 `1em`、颜色取 `currentColor`，因此和 iconify-icon 一样完全跟随父级 font-size / color，
 *       可以直接配合 Tailwind 的 text-* 使用。
 */
import React from 'react';

const DATA: Record<string, string> = {
  "arrow-left": "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"m12 19l-7-7l7-7m7 7H5\"/>",
  "user": "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\"><path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\"/><circle cx=\"12\" cy=\"7\" r=\"4\"/></g>",
  "upload-cloud": "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\"><path d=\"M12 13v8m-8-6.101A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242\"/><path d=\"m8 17l4-4l4 4\"/></g>",
  "info": "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4m0-4h.01\"/></g>",
  "file-text": "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\"><path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\"/><path d=\"M14 2v5a1 1 0 0 0 1 1h5M10 9H8m8 4H8m8 4H8\"/></g>",
  "x": "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M18 6L6 18M6 6l12 12\"/>",
  "loader-2": "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M21 12a9 9 0 1 1-6.219-8.56\"/>",
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
      viewBox="0 0 24 24"
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
