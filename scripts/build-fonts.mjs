/**
 * 生成自托管中文字体（Noto Serif SC == 思源宋体的 Google 版，SIL OFL 1.1）
 * ---------------------------------------------------------------------------
 * 做法：从 @fontsource/noto-serif-sc 的分片里，挑出**覆盖整个应用用到的字符**的那些片，
 *       并把 600 / 700 / 900 三个字重都带上（草稿里品牌名用 700、R 方块用 900、
 *       正文标题用 600 —— 少一个字重浏览器就会退回系统衬线，字重看着就轻）。
 *
 * 用法：
 *   npm i @fontsource/noto-serif-sc --no-save --registry=https://registry.npmmirror.com
 *   node scripts/build-fonts.mjs
 *
 * 产物：public/fonts/*.woff2 + src/fonts.css（勿手改，重新生成即可）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

const PACK = 'node_modules/@fontsource/noto-serif-sc';
const OUT_DIR = 'public/fonts';
const CSS_OUT = 'src/fonts.css';
const WEIGHTS = [600, 700, 900];

if (!existsSync(PACK)) {
  console.error(`★ 找不到 ${PACK}，先执行：npm i @fontsource/noto-serif-sc --no-save --registry=https://registry.npmmirror.com`);
  process.exit(1);
}

/** 1) 收集字符：整个 src/ + index.html + samples/（论文元数据里也有中文会显示在界面上） */
const chars = new Set();
const collect = (dir, exts) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) collect(p, exts);
    else if (exts.test(e.name)) {
      for (const ch of readFileSync(p, 'utf8')) if (ch.codePointAt(0) >= 0x20) chars.add(ch);
    }
  }
};
collect('src', /\.(ts|tsx|css|html)$/);
collect('samples', /\.(json|md)$/);
if (existsSync('index.html')) for (const ch of readFileSync('index.html', 'utf8')) if (ch.codePointAt(0) >= 0x20) chars.add(ch);
// ASCII 全覆盖：界面上还会出现用户输入 / 文件名 / 数字
for (let c = 0x20; c <= 0x7e; c++) chars.add(String.fromCodePoint(c));

const cps = [...chars].map((c) => c.codePointAt(0));
console.log(`用到 ${cps.length} 个字符`);

/** 2) 解析 @fontsource 的字重 CSS：每条 @font-face 带 unicode-range */
const parseWeightCss = (weight) => {
  const css = readFileSync(join(PACK, `${weight}.css`), 'utf8');
  const blocks = css.split('@font-face').slice(1);
  const out = [];
  for (const b of blocks) {
    const file = (b.match(/url\(([^)]+)\)/) || [])[1];
    const range = (b.match(/unicode-range:\s*([^;]+);/) || [])[1];
    if (!file || !range) continue;
    out.push({ file: basename(file), range: range.trim() });
  }
  return out;
};

const rangeHits = (range, points) => {
  const segs = range.split(',').map((s) => {
    const m = s.trim().match(/^U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?$/);
    if (!m) return null;
    const a = parseInt(m[1], 16);
    const b = m[2] ? parseInt(m[2], 16) : a;
    return [a, b];
  }).filter(Boolean);
  return points.some((p) => segs.some(([a, b]) => p >= a && p <= b));
};

/** 3) 选片 + 拷贝 + 生成 CSS */
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const faces = [];
for (const w of WEIGHTS) {
  const slices = parseWeightCss(w);
  const keep = slices.filter((s) => rangeHits(s.range, cps));
  let bytes = 0;
  for (const s of keep) {
    copyFileSync(join(PACK, 'files', s.file), join(OUT_DIR, s.file));
    bytes += readFileSync(join(PACK, 'files', s.file)).length;
  }
  console.log(`  字重 ${w}: 选中 ${keep.length}/${slices.length} 片，共 ${(bytes / 1024).toFixed(0)} KB`);
  for (const s of keep) {
    faces.push(`@font-face {
  font-family: 'RP Serif SC';
  font-style: normal;
  font-weight: ${w};
  font-display: swap;
  src: url('/fonts/${s.file}') format('woff2');
  unicode-range: ${s.range};
}`);
  }
}

const header = `/* =========================================================================
   自托管中文衬线字体 —— **由 scripts/build-fonts.mjs 生成，请勿手改**
   来源：@fontsource/noto-serif-sc（Noto Serif SC == 思源宋体的 Google 版，SIL OFL 1.1）
   内容：挑出覆盖「整个应用用到的字符」的分片，带上 600 / 700 / 900 三个字重。
   为什么必须三个字重都有：草稿里品牌名是 700、R 方块是 900、标题是 600；
   少一个字重浏览器就会退回系统衬线（Times / 宋体），字重和字形都会明显走样。
   重新生成：npm i @fontsource/noto-serif-sc --no-save --registry=https://registry.npmmirror.com
             && node scripts/build-fonts.mjs
   ========================================================================= */

`;

writeFileSync(CSS_OUT, header + faces.join('\n\n') + '\n', 'utf8');
const total = readdirSync(OUT_DIR).length;
console.log(`写出 ${CSS_OUT}：${faces.length} 条 @font-face；public/fonts 共 ${total} 个文件`);
