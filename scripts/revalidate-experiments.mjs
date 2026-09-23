/**
 * 实验记录的表格语境核查：确定性重算（不调用模型）。
 *
 * 为什么需要：表格语境核查属于「程序判定」，规则调整后应当用同一批模型输出重算，
 * 而不是重新调用模型（那样既浪费额度，也会把规则问题和模型输出混在一起）。
 * 本脚本只重算 verification（引文/表题/行标签/列标签的定位与行列确认）与别名说明。
 *
 * 用法：node scripts/revalidate-experiments.mjs --out public/samples-vision-core [--out ...]
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outs = args.reduce((acc, a, i) => (a === '--out' && args[i + 1] ? [...acc, args[i + 1]] : acc), []);
if (!outs.length) outs.push('public/samples-vision-core');

const buildDir = join(ROOT, '.build');
await mkdir(buildDir, { recursive: true });
const bundle = join(buildDir, `reval-exp-${process.pid}.mjs`);
const esbuild = join(ROOT, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');
const b = spawnSync(
  esbuild,
  [join(ROOT, 'src/core/nodePipeline.ts'), '--bundle', '--format=esm', '--platform=node', '--target=node20', '--external:pdfjs-dist', '--outfile=' + bundle],
  { stdio: 'inherit', cwd: ROOT },
);
if (b.status !== 0) process.exit(3);
const mod = await import(pathToFileURL(bundle).href);

const report = [
  '# 实验记录：表格语境核查（确定性重算，未调用模型）',
  '',
  `- 执行时间：${new Date().toLocaleString('zh-CN')}`,
  '- 说明：只重算「引文/表题/行标签/列标签的定位」与「行列对应是否确认」，不改动模型给出的数值与条件。',
  '',
];

for (const outRel of outs) {
  const outDir = resolve(ROOT, outRel);
  const indexPath = join(outDir, 'index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8'));

  let total = 0;
  let confirmed = 0;
  const rows = [];

  for (const m of index.methods) {
    const textFile = join(outDir, 'text', `${m.paperId}.json`);
    let paper;
    try {
      const t = JSON.parse(await readFile(textFile, 'utf8'));
      const meta = index.papers.find((p) => p.id === m.paperId);
      paper = { ...meta, rawText: t.rawText, pages: t.pages };
    } catch {
      continue;
    }

    for (const e of m.experiments ?? []) {
      total++;
      const around = e.evidence?.start ?? 0;
      const locate = (x) => {
        if (!x || x.length < 2) return 'none';
        const r = mod.locateNear(paper.rawText, x, around, 1500);
        return r.found && r.near ? r.matchType : 'none';
      };
      const capMatch = locate(e.table?.caption);
      const rowMatch = locate(e.table?.rowLabel);
      const colMatch = locate(e.table?.colLabel);

      const quoteHit = e.evidence?.quote ? mod.locateQuote(paper.rawText, e.evidence.quote) : null;
      const quoteLocated = !!quoteHit;

      const issues = [];
      if (!quoteLocated) issues.push('引文未能定位');
      if (!e.table?.caption) issues.push('未给出表题，无法核查表格语境');
      else if (capMatch === 'none') issues.push('表题未在引文附近定位到');
      else issues.push(`表题已定位（${capMatch === 'strict' ? '逐字一致' : '归一化后一致'}）`);
      if (!e.table?.rowLabel) issues.push('未给出行标签，无法核查该行对应哪一列');
      else if (rowMatch === 'none') issues.push('行标签未在引文附近定位到');
      else issues.push(`行标签已定位（${rowMatch === 'strict' ? '逐字一致' : '归一化后一致'}）`);
      if (e.table?.colLabel && colMatch === 'none') issues.push('列标签未在原文中定位到');

      const rowColConfirmed = quoteLocated && capMatch !== 'none' && rowMatch !== 'none';
      if (rowColConfirmed) confirmed++;

      e.verification = {
        quoteLocated,
        tableCaptionLocated: capMatch !== 'none',
        rowLabelLocated: rowMatch !== 'none',
        colLabelLocated: colMatch !== 'none',
        rowColConfirmed,
        issues,
        matchTypes: { caption: capMatch, rowLabel: rowMatch, colLabel: colMatch },
      };
      if (e.evidence && quoteHit) {
        e.evidence.page = mod.pageAt(paper.pages, quoteHit.start) ?? e.evidence.page;
        e.evidence.verified = true;
      }

      rows.push({ paper: m.paperId, variant: e.modelVariant, value: `${e.metricName}=${e.metricValue}`, task: e.taskTag, cap: capMatch, row: rowMatch, confirmed: rowColConfirmed });
    }
  }

  index.experimentsRevalidatedAt = new Date().toISOString();
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');

  report.push(`## ${outRel}`, '', `- 实验记录 ${total} 条，行列关系已确认 **${confirmed}** 条，待核查 ${total - confirmed} 条`, '');
  report.push('| 论文 | 模型变体 | 记录值 | 任务 | 表题匹配 | 行标签匹配 | 行列确认 |');
  report.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) report.push(`| ${r.paper} | ${r.variant} | ${r.value} | ${r.task} | ${r.cap} | ${r.row} | ${r.confirmed ? '✅' : '⚠️ 待核查'} |`);
  report.push('');
  console.log(`${outRel}：实验 ${total} 条，行列确认 ${confirmed} 条`);
}

report.push('## 边界', '', '- 本文件只反映「定位」结果：表题/行标签能在原文中找到 ≠ 该数值一定取自那一行那一列；', '  行列仍可能因表格分栏、跨页而需要人工复核（记录里保留了匹配类型供判断）。', '');
await writeFile(join(ROOT, 'docs', 'EXPERIMENT-TABLE-CHECK.md'), report.join('\n'), 'utf8');
console.log('已写出 docs/EXPERIMENT-TABLE-CHECK.md');
