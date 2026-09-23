/**
 * 构建指纹：给 index.html 引用的静态资源加上版本查询串。
 *
 * 背景（实测结论）：
 * - 本作品的部署通道是纯静态托管，资源文件名固定（因为构建目录无法清空，见 vite.config.ts 注释）；
 * - 固定文件名会被 CDN 按 URL 缓存，导致「重新部署后访问者仍看到旧版本」；
 * - 实测带查询串的请求会绕过旧缓存并返回最新文件（Eo-Cache-Status: MISS）。
 *
 * 因此这里在每次构建后，把 index.html 中的资源引用改写为 `app.js?v=<构建指纹>`。
 * 文件名不变（磁盘上不会遗留旧文件），但 URL 变化，从而避免看到过期版本。
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const html = await readFile(join(DIST, 'index.html'), 'utf8');

// 指纹 = 入口脚本内容哈希，保证「内容变了指纹才变」
let js = '';
try {
  js = await readFile(join(DIST, 'assets', 'app.js'), 'utf8');
} catch {
  console.warn('[stamp] 未找到 dist/assets/app.js，跳过指纹注入。');
  process.exit(0);
}
const buildId = createHash('sha256').update(js).digest('hex').slice(0, 10);

let out = html;
const stamp = (file) => {
  const re = new RegExp(`(\\./assets/${file.replace('.', '\\.')})(\\?v=[a-z0-9]+)?`, 'g');
  return out.replace(re, `$1?v=${buildId}`);
};
out = stamp('app.js');
out = stamp('index.css');

if (out !== html) {
  await writeFile(join(DIST, 'index.html'), out, 'utf8');
}

// 记录本次构建指纹，便于排查「线上是不是最新版本」
await writeFile(
  join(DIST, 'build.json'),
  JSON.stringify({ buildId, builtAt: new Date().toISOString(), appJsBytes: js.length }, null, 2),
  'utf8',
);

console.log(`[stamp] 构建指纹 ${buildId}（app.js ${js.length} 字节）已写入 index.html`);
