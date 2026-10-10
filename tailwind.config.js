/**
 * Tailwind 配置 —— 为了**照搬 Superdesign 草稿的代码**（草稿用的是 Tailwind 工具类）。
 *
 * 关键取舍：
 * - `corePlugins.preflight: false`：**关掉 Tailwind 的全局 reset**。本项目已有 6 个手写 CSS
 *   （styles/design-system/demo-views/map/workbench/fonts），preflight 会把它们的默认 margin / 字号 /
 *   列表样式全部重置掉，导致还没重构的页面样式被打乱。关掉后 Tailwind **只产出被用到的工具类**，
 *   与既有 CSS 共存；等所有页面都用草稿代码重写完，再考虑是否打开 preflight。
 * - `content` 覆盖 src 下所有 ts/tsx：草稿里那些任意值写法（`max-w-[var(--content-max)]`、
 *   `text-[var(--fg-3)]`、`rounded-[20px]`、`lg:ml-20`）在 JIT 下都能正常生成。
 * - 草稿没有内联 tailwind.config（用的是 Play CDN 默认主题），所以这里也用**默认主题**，不做 extend。
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};
