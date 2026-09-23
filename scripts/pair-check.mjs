/**
 * 论文对级可比性核对（开发用）：把同一对论文在两处的结论打出来对照。
 * 用法：node scripts/pair-check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(ROOT, '.build', 'pair-check.mjs');
const bin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
spawnSync(
  bin,
  [join(ROOT, 'src/core/nodePipeline.ts'), '--bundle', '--format=esm', '--platform=node', '--target=node20', '--external:pdfjs-dist', '--outfile=' + out],
  { stdio: 'ignore', shell: process.platform === 'win32' },
);
const mod = await import(pathToFileURL(out).href);

const idx = JSON.parse(await readFile(join(ROOT, 'public/samples/index.json'), 'utf8'));
const papers = [];
for (const m of idx.papers) {
  const t = JSON.parse(await readFile(join(ROOT, 'public/samples/text', `${m.id}.json`), 'utf8'));
  papers.push({ ...m, ...t });
}
const methods = idx.methods.map(mod.migrateMethod);
const byTitle = (kw) => methods.find((m) => (papers.find((p) => p.id === m.paperId)?.title ?? '').includes(kw));

const pairs = [
  ['BERT', 'RoBERTa'],
  ['BERT', 'DistilBERT'],
  ['BERT', 'Language Models'],
  ['Attention', 'BERT'],
];

for (const [a, b] of pairs) {
  const pa = byTitle(a);
  const pb = byTitle(b);
  if (!pa || !pb) {
    console.log(`跳过（未找到）：${a} / ${b}`);
    continue;
  }
  const rep = mod.comparePair(papers, mod.methods ?? methods, pa.paperId, pb.paperId);
  console.log(`--- ${a} ↔ ${b} => ${mod.LEVEL_LABELS[rep.overall.level]}`);
  for (const d of rep.dimensions) {
    const diff = d.differences.length ? `｜${d.differences[0].slice(0, 100)}` : '';
    const miss = d.missing.length ? `｜缺失：${d.missing[0].slice(0, 60)}` : '';
    console.log(`    ${d.label}：${mod.LEVEL_LABELS[d.level]}${diff}${miss}`);
  }
}
