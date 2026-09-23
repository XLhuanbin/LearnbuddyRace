/**
 * 未预置论文的真实导入验证（真实模型调用）。
 *
 * 目的：验证「用一篇没有预置过的论文」走完整条解析 + 抽取 + 校验链路，
 * 并检验它与已有预置论文放在一起时的可比性结论是否合理。
 *
 * 关键点：不写入预置语料（public/samples），只产出验证记录，避免把验证用样本混进参赛语料。
 *
 * 用法：
 *   node scripts/import-verify.mjs --pdf samples/pdfs/2006.11239.pdf
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const pdfPath = resolve(ROOT, arg('pdf', 'samples/pdfs/2006.11239.pdf'));
const outPath = resolve(ROOT, arg('out', 'docs/IMPORT-VERIFICATION.md'));
const apiKey = process.env.DEEPSEEK_API_KEY || '';
const baseUrl = process.env.RP_MODEL_BASE || 'https://api.deepseek.com';
const model = process.env.RP_MODEL || 'deepseek-chat';

if (!apiKey) {
  console.error('[中止] 未检测到 DEEPSEEK_API_KEY。本脚本必须使用真实模型，不会生成占位结果。');
  process.exit(2);
}

const log = (m) => console.log(m);

log('[1/3] 打包核心逻辑 (esbuild) ...');
const buildDir = join(ROOT, '.build');
await mkdir(buildDir, { recursive: true });
const bundlePath = join(buildDir, `import-verify-${process.pid}.mjs`);
const bin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
const b = spawnSync(
  bin,
  [
    join(ROOT, 'src/core/nodePipeline.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--target=node20',
    '--external:pdfjs-dist',
    '--outfile=' + bundlePath,
  ],
  { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' },
);
if (b.status !== 0) {
  console.error('[中止] esbuild 打包失败。');
  process.exit(3);
}
const mod = await import(pathToFileURL(bundlePath).href);

log('[2/3] 解析并抽取这篇未预置论文 ...');
const paper = await mod.buildPaperFromPdf({ file: pdfPath, purpose: '未预置论文导入验证（不进入参赛语料）' });
log(`      标题=${paper.title}`);
log(`      年份=${paper.year ?? '未识别'} | 页数=${paper.pageCount ?? '未知'} | 字符=${paper.charCount}`);

const cfg = { baseUrl, apiKey, model, timeoutMs: 180000, maxAttempts: 3 };
const traces = [];
const method = await mod.extractMethod(paper, cfg, (t) => {
  traces.push(`${t.label} attempt=${t.attempt} ${t.ms}ms prompt=${t.promptChars} out=${t.completionChars}${t.error ? ' ERROR=' + t.error : ''}`);
  log(`      ${traces[traces.length - 1]}`);
});

// 标题校正：模型给出的标题必须在原文中验证通过才采用（未预置论文的启发式标题常常不准）
const beforeTitle = paper.title;
const correctedPaper = mod.applyTitleCorrection(paper, method);
const titleCorrected = correctedPaper.title !== beforeTitle;
if (titleCorrected) {
  log(`      标题已由模型校正并在原文中验证：${correctedPaper.title}`);
  paper.title = correctedPaper.title;
  paper.titleFrom = correctedPaper.titleFrom;
} else {
  log(`      标题未校正（模型给出的标题未通过原文验证或与启发式一致）`);
}
if (method.paperTitleGuess && !titleCorrected) log(`      模型候选标题（未采用）：${method.paperTitleGuess}`);

const FIELD_KEYS = mod.FIELD_KEYS_ORDER;
const byStatus = (s) => FIELD_KEYS.filter((k) => method.fields[k].status === s).length;
log(`      字段：可核验 ${byStatus('verified')} / 待人工核对 ${byStatus('unverified')} / 未找到证据 ${byStatus('no_evidence')} / 缺失 ${byStatus('missing')}`);
const condOk = Object.entries(method.conditions || {}).filter(([, c]) => c.status === 'verified').length;
log(`      实验条件可核验 ${condOk} / 9`);
log(`      程序校验问题 ${method.validation?.length ?? 0} 条`);

log('[3/3] 与预置论文放在一起做可比性检查 ...');
const idx = JSON.parse(await readFile(join(ROOT, 'public/samples/index.json'), 'utf8'));
const papers = [];
const methods = [];
for (const meta of idx.papers) {
  const t = JSON.parse(await readFile(join(ROOT, 'public/samples/text', `${meta.id}.json`), 'utf8'));
  papers.push({ ...meta, pages: t.pages, rawText: t.rawText, charCount: t.charCount });
}
for (const m of idx.methods) methods.push(mod.migrateMethod(m));

papers.push(paper);
methods.push(method);

const pairLines = [];
for (const other of idx.methods) {
  const otherPaper = papers.find((p) => p.id === other.paperId);
  const rep = mod.comparePair(papers, methods, paper.id, other.paperId);
  const diffs = mod.differingDimensions(papers, methods, paper.id, other.paperId);
  pairLines.push(
    `| ${otherPaper.title.slice(0, 42)} | ${mod.LEVEL_LABELS[rep.overall.level]} | ${
      diffs.map((d) => d.label).join('、') || '—'
    } |`,
  );
  log(`      ${otherPaper.title.slice(0, 34)} → ${mod.LEVEL_LABELS[rep.overall.level]}`);
}

const lines = [
  '# 未预置论文的真实导入验证',
  '',
  `- 执行时间：${new Date().toLocaleString('zh-CN')}`,
  `- 模型：${model}（${new URL(baseUrl).host}）`,
  `- 提示词版本：${mod.PROMPT_VERSION}　规则版本：${mod.RULES_VERSION}`,
  `- 论文文件：${pdfPath.replace(ROOT, '<repo>')}`,
  `- **该论文不在预置语料中**；本脚本不写入 public/samples，验证结果只落在本文件。`,
  '',
  '## 解析与抽取结果',
  '',
  `- 标题：${paper.title}${titleCorrected ? '（由模型校正并在原文中验证）' : ''}`,
  `- 年份：${paper.year ?? '未识别'}`,
  `- 页数：${paper.pageCount ?? '未知'}　字符数：${paper.charCount}`,
  `- 字段：可核验 ${byStatus('verified')} / 待人工核对 ${byStatus('unverified')} / 未找到证据 ${byStatus('no_evidence')} / 缺失 ${byStatus('missing')}（共 ${FIELD_KEYS.length}）`,
  `- 实验条件可核验：${condOk} / 9`,
  `- 程序校验问题：${method.validation?.length ?? 0} 条`,
  '',
  '## 字段明细（含页码与是否通过定位校验）',
  '',
  '| 字段 | 状态 | 页码 | 值 |',
  '| --- | --- | --- | --- |',
];
for (const k of FIELD_KEYS) {
  const f = method.fields[k];
  lines.push(
    `| ${k} | ${f.status} | ${f.evidence?.verified ? 'p.' + (f.evidence.page ?? '?') : '—'} | ${(f.value ?? '（无）').replace(/\|/g, '/').slice(0, 90)} |`,
  );
}

lines.push('', '## 实验条件明细（含适用范围与阶段）', '', '| 维度 | 状态 | 取值 | 适用范围 | 阶段 |', '| --- | --- | --- | --- | --- |');
for (const [dim, c] of Object.entries(method.conditions || {})) {
  lines.push(
    `| ${dim} | ${c.status} | ${(c.values.join('、') || '—').slice(0, 60)} | ${c.scope ?? '—'}${c.scopeDetail ? '：' + c.scopeDetail.slice(0, 40) : ''} | ${c.stage ?? '—'} |`,
  );
}

lines.push('', '## 程序校验问题', '');
if (method.validation?.length) {
  for (const i of method.validation) lines.push(`- [${i.severity}] ${i.code}：${i.message}`);
} else {
  lines.push('- 无');
}

lines.push('', '## 与预置论文的可比性（按论文对计算）', '', '| 预置论文 | 结论 | 主要差异维度 |', '| --- | --- | --- |');
lines.push(...pairLines);

lines.push('', '## 模型调用记录', '');
for (const t of traces) lines.push(`- ${t}`);

lines.push(
  '',
  '## 说明',
  '',
  '- 本文件为验证记录，不进入参赛语料；预置语料仍为固定的 5 篇开发验证样例。',
  '- 该论文的所有结论同样受「论文级初筛」限制：结果级比较需要选定具体实验。',
  '',
  '本文件不包含任何 API 密钥。',
);

await writeFile(outPath, lines.join('\n'), 'utf8');
log('');
log(`已写出：${outPath}`);
