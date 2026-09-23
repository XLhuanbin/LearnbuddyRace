/**
 * 核对正式视觉语料的 PDF 文件：标题、版本（会议/预印本）、文本层、页数。
 * 只做读取与统计，不调用模型、不写缓存。
 *
 * 用法：node scripts/vision-check-files.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = resolve(ROOT, '..', '视觉经典论文');
const OUT = join(ROOT, 'docs', 'VISION-CORPUS-FILES.md');

const buildDir = join(ROOT, '.build');
await mkdir(buildDir, { recursive: true });
const bundle = join(buildDir, `vision-pdf-${process.pid}.mjs`);
const esbuild = join(ROOT, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');
const b = spawnSync(
  esbuild,
  [join(ROOT, 'src/core/nodePipeline.ts'), '--bundle', '--format=esm', '--platform=node', '--target=node20',
    '--external:pdfjs-dist', '--outfile=' + bundle],
  { stdio: 'inherit', cwd: ROOT },
);
if (b.status !== 0) {
  console.error('打包失败');
  process.exit(3);
}
const mod = await import(pathToFileURL(bundle).href);

const files = (await readdir(SRC_DIR)).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
console.log(`发现 ${files.length} 个 PDF：${files.join('、')}`);
console.log('');

const VENUE = /(CVPR|ICCV|ECCV|ICLR|NeurIPS|NIPS|TPAMI|arXiv)\s*[:：]?\s*(20\d\d)/gi;

const rows = [];
for (const name of files) {
  const full = join(SRC_DIR, name);
  const bytes = (await readFile(full)).length;
  console.log(`解析 ${name}（${(bytes / 1024 / 1024).toFixed(1)} MB）…`);

  const { pages, numPages } = await mod.extractPdfText(full);
  const assembled = mod.assemblePages(pages);
  const charCount = assembled.charCount;
  const first = (pages[0] ?? '').replace(/\r/g, '');
  const head = first
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 14);

  const fullText = pages.join('\n');
  const venues = [...new Set([...fullText.matchAll(VENUE)].map((m) => `${m[1]} ${m[2]}`))].slice(0, 6);
  const arxiv = (/(?:arXiv:)?(\d{4}\.\d{4,5})(v\d+)?/.exec(fullText) || [])[1] ?? null;
  const meta = mod.guessPdfMeta(first);
  const avg = numPages ? Math.round(charCount / numPages) : 0;

  rows.push({ name, bytes, numPages, charCount, avg, guessed: meta.title ?? '（未识别）', venues, arxiv, head });
  console.log(`  页数=${numPages} 字符=${charCount} 平均每页=${avg}`);
  console.log(`  启发式标题=${(meta.title ?? '（未识别）').slice(0, 80)}`);
  console.log(`  首页出现的会议/年份标记：${venues.join('、') || '（未发现）'}  arXiv=${arxiv ?? '未发现'}`);
  console.log('');
}

const lines = [
  '# 正式视觉语料：文件核对记录',
  '',
  `- 核对时间：${new Date().toLocaleString('zh-CN')}`,
  `- 文件目录：${SRC_DIR.replace(ROOT + '\\..', '<workspace>')}`,
  '- 方法：用项目自身的 PDF 解析链路读取（与线上应用同一套代码），只统计与摘录首页，不做任何模型调用。',
  '- **文件名里的年份不作为会议年份**；会议/年份以论文正文中的标记为准，逐篇记录。',
  '',
  '## 汇总',
  '',
  '| 文件 | 大小 | 页数 | 字符数 | 平均每页 | 文本层 | 正文出现的会议/年份标记 | arXiv |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
];
for (const r of rows) {
  lines.push(
    `| ${r.name} | ${(r.bytes / 1024 / 1024).toFixed(1)} MB | ${r.numPages} | ${r.charCount} | ${r.avg} | ${
      r.avg >= 120 ? '有（可解析）' : '**不足，疑似扫描件**'
    } | ${r.venues.join('、') || '未发现'} | ${r.arxiv ?? '未发现'} |`,
  );
}
lines.push('', '## 逐篇首页前若干行（用于人工核对标题与作者）', '');
for (const r of rows) {
  lines.push(`### ${r.name}`, '', `- 启发式识别标题：${r.guessed}`, '', '```text');
  lines.push(...r.head);
  lines.push('```', '');
}
lines.push(
  '## 说明',
  '',
  '- 「正文出现的会议/年份标记」只是文内字符串线索（例如页脚的 CVPR 2016），用于人工确认版本；',
  '  本项目**不会**用它自动判定年份，年份仍以抽取结果与人工复核为准。',
  '- 文本层不足的 PDF 会被解析环节直接拒绝，不会生成空结果。',
  '',
);

await writeFile(OUT, lines.join('\n'), 'utf8');
console.log(`已写出 ${OUT}`);
