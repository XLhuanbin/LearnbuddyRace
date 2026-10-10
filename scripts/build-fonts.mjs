/**
 * 生成自托管中文字体（Noto Serif SC / Noto Sans SC == 思源宋体 / 思源黑体的 Google 版，SIL OFL 1.1）
 * ---------------------------------------------------------------------------
 * 做法：从 @fontsource 的分片里，挑出**覆盖整个应用用到的字符**的那些片，并把草稿用到的字重全带上。
 *   衬线 'RP Serif SC'：600 / 700 / 900 —— 草稿里正文标题 600、品牌名 700、R 方块 900
 *   无衬线 'RP Sans SC'：400 / 500 / 700 —— 草稿里正文 400、中粗 500、强调 700
 * 少一个字重，浏览器就会退回系统字体（Times / Segoe UI / 宋体），字重与字形都会明显走样。
 *
 * 用法：
 *   npm i @fontsource/noto-serif-sc @fontsource/noto-sans-sc --no-save --registry=https://registry.npmmirror.com
 *   node scripts/build-fonts.mjs
 *
 * 产物：public/fonts/*.woff2 + src/fonts.css（勿手改，重新生成即可）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

const OUT_DIR = 'public/fonts';
const CSS_OUT = 'src/fonts.css';

const FAMILIES = [
  { pkg: 'noto-serif-sc', family: 'RP Serif SC', weights: [600, 700, 900] },
  { pkg: 'noto-sans-sc', family: 'RP Sans SC', weights: [400, 500, 700] },
];

for (const f of FAMILIES) {
  if (!existsSync(`node_modules/@fontsource/${f.pkg}`)) {
    console.error(`★ 找不到 node_modules/@fontsource/${f.pkg}，先执行：`);
    console.error('  npm i @fontsource/noto-serif-sc @fontsource/noto-sans-sc --no-save --registry=https://registry.npmmirror.com');
    process.exit(1);
  }
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

const parseWeightCss = (pkg, weight) => {
  const css = readFileSync(join('node_modules/@fontsource', pkg, `${weight}.css`), 'utf8');
  const out = [];
  for (const b of css.split('@font-face').slice(1)) {
    const file = (b.match(/url\(([^)]+)\)/) || [])[1];
    const range = (b.match(/unicode-range:\s*([^;]+);/) || [])[1];
    if (file && range) out.push({ file: basename(file), range: range.trim() });
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

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const faces = [];
for (const { pkg, family, weights } of FAMILIES) {
  for (const w of weights) {
    const slices = parseWeightCss(pkg, w);
    const keep = slices.filter((s) => rangeHits(s.range, cps));
    let bytes = 0;
    for (const s of keep) {
      copyFileSync(join('node_modules/@fontsource', pkg, 'files', s.file), join(OUT_DIR, s.file));
      bytes += readFileSync(join('node_modules/@fontsource', pkg, 'files', s.file)).length;
    }
    console.log(`  ${family} ${w}: 选中 ${keep.length}/${slices.length} 片，${(bytes / 1024).toFixed(0)} KB`);
    for (const s of keep) {
      faces.push(`@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${w};
  font-display: swap;
  src: url('/fonts/${s.file}') format('woff2');
  unicode-range: ${s.range};
}`);
    }
  }
}

const header = `/* =========================================================================
   自托管中文字体 —— **由 scripts/build-fonts.mjs 生成，请勿手改**
   来源：@fontsource/noto-serif-sc（思源宋体 Google 版）+ @fontsource/noto-sans-sc（思源黑体 Google 版），SIL OFL 1.1
   内容：挑出覆盖「整个应用用到的字符」的分片，带上草稿用到的全部字重 ——
         衬线 RP Serif SC: 600 / 700 / 900（标题 / 品牌名 / R 方块）
         无衬线 RP Sans SC: 400 / 500 / 700（正文 / 中粗 / 强调）
   为什么必须每个字重都有：少一个，浏览器就退回系统字体（Times / Segoe UI / 宋体），字重和字形都会走样。
   重新生成：npm i @fontsource/noto-serif-sc @fontsource/noto-sans-sc --no-save \\
             --registry=https://registry.npmmirror.com && node scripts/build-fonts.mjs
   ========================================================================= */

`;

writeFileSync(CSS_OUT, header + faces.join('\n\n') + '\n', 'utf8');
console.log(`写出 ${CSS_OUT}：${faces.length} 条 @font-face；public/fonts 共 ${readdirSync(OUT_DIR).length} 个文件`);
