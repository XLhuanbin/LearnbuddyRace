/**
 * PostCSS 配置 —— 启用 Tailwind，用于**照搬 Superdesign 草稿的代码**（草稿用的是 Tailwind 工具类）。
 *
 * 依赖：tailwindcss@3 / postcss@8 / autoprefixer（已写入 package.json devDependencies）。
 * 配置见 tailwind.config.js（**preflight 关闭**，避免重置掉本项目中尚未重构页面的既有样式）。
 *
 * 本机安装踩过的坑（2026-10-10）：用 `--no-save` 装包时，**后续任何一次 npm install 都会把它剪掉**，
 * 插件被剪掉后 PostCSS 加载失败会让**整个项目构建不了**。所以这三个包必须写在 package.json 里。
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
