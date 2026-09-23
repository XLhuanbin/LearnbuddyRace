/**
 * 离线分析脚本：把样例论文跑一遍真实模型抽取，产出页面可用的缓存语料。
 *
 * 用法：
 *   node scripts/analyze.mjs --spec samples/dev-samples.json --out public/samples
 *
 * 环境变量（密钥只在这里读取，绝不写入产物）：
 *   DEEPSEEK_API_KEY  必填
 *   RP_MODEL_BASE     默认 https://api.deepseek.com
 *   RP_MODEL          默认 deepseek-chat
 *
 * 说明：本脚本会先用 esbuild 把 src/core 下的同一套逻辑打包成 Node 可执行模块，
 * 确保离线缓存与浏览器端实时分析使用完全相同的提示词与证据校验实现。
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const specPath = resolve(ROOT, arg('spec', 'samples/dev-samples.json'));
const outDir = resolve(ROOT, arg('out', 'public/samples'));
const reportOnly = process.argv.includes('--report-only');
// 打包产物放在项目内的 .build/ 目录（已加入 .gitignore）：
// 必须位于项目内才能解析 node_modules 里的 pdfjs-dist；不主动删除以避开环境对删除操作的限制。
const buildDir = join(ROOT, '.build');
const bundlePath = join(buildDir, `pipeline-${process.pid}.mjs`);

const apiKey = process.env.DEEPSEEK_API_KEY || '';
const baseUrl = process.env.RP_MODEL_BASE || 'https://api.deepseek.com';
const model = process.env.RP_MODEL || 'deepseek-chat';

if (!apiKey && !process.argv.includes('--report-only')) {
  console.error('[中止] 未检测到 DEEPSEEK_API_KEY。本脚本必须使用真实模型，不会生成占位结果。');
  process.exit(2);
}

function log(msg) {
  console.log(msg);
}

log('[1/4] 打包核心逻辑 (esbuild) ...');
await mkdir(buildDir, { recursive: true });
const esbuildBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
const build = spawnSync(
  esbuildBin,
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
if (build.status !== 0) {
  console.error('[中止] esbuild 打包失败。');
  process.exit(3);
}

const mod = await import(pathToFileURL(bundlePath).href);

log('[2/4] 读取样例清单 ...');
const spec = JSON.parse(await readFile(specPath, 'utf8'));
log(`      领域标注：${spec.domain}（已确认=${!!spec.domainConfirmed}）`);
log(`      样例数：${spec.papers.length}`);

const specs = spec.papers.map((p) => ({
  file: resolve(ROOT, p.file),
  arxivId: p.arxivId,
  purpose: p.purpose || spec.purpose,
}));

const cfg = { baseUrl, apiKey, model, timeoutMs: 180000, maxAttempts: 3 };

/* ---------- 模式：只重新生成示例决策（不重跑抽取/关系/分歧） ---------- */
if (process.argv.includes('--decision-only')) {
  const index = JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8'));
  const papers = [];
  for (const meta of index.papers) {
    const t = JSON.parse(await readFile(join(outDir, 'text', meta.id + '.json'), 'utf8'));
    papers.push({ ...meta, pages: t.pages, rawText: t.rawText, charCount: t.charCount });
  }
  const methods = index.methods.map((m) => mod.migrateMethod(m));
  const profile = index.demoProfile || spec.demoProfile;
  log('[决策] 仅重新生成示例决策（用户条件：' + (profile.compute || '未填写') + ' / ' + (profile.time || '未填写') + '）...');
  const plan = await mod.generateDecision(papers, methods, profile, cfg, (t) => {
    log('      ' + t.label + ' attempt=' + t.attempt + ' ' + t.ms + 'ms' + (t.error ? ' ERROR=' + t.error : ''));
  });
  const withEvidence = (plan.candidates || []).reduce(
    (a, c) => a + c.reasons.filter((r) => r.evidence).length,
    0,
  );
  const missingEv = (plan.candidates || []).reduce(
    (a, c) => a + c.reasons.filter((r) => r.basis === 'paper' && r.evidenceMissing).length,
    0,
  );
  log('      候选 ' + (plan.candidates || []).length + ' 个，理由中有证据 ' + withEvidence + ' 条，标记无证据 ' + missingEv + ' 条');
  index.decisionSample = { ...plan, cached: true };
  index.demoProfile = profile;
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  log('      已写回 index.json 的 decisionSample');
  process.exit(0);
}

/* ---------- 验收模式：单变量条件对照 + 反例 ---------- */
if (process.argv.includes('--decision-variation')) {
  const index = JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8'));
  const papers = [];
  for (const meta of index.papers) {
    const t = JSON.parse(await readFile(join(outDir, 'text', meta.id + '.json'), 'utf8'));
    papers.push({ ...meta, pages: t.pages, rawText: t.rawText, charCount: t.charCount });
  }
  const methods = index.methods.map((m) => mod.migrateMethod(m));

  // 固定用户目标与基础，只改一个变量；最后一个是反例
  const FIXED = {
    background: '已读过多篇预训练语言模型论文，做过 BERT 微调实验',
    interest: '想研究大规模预训练的训练稳定性与评测方法',
    goal: '围绕预训练训练稳定性做一段可复现的对比研究',
  };
  const profiles = [
    { name: '基准：8 卡 A100 · 半年', ...FIXED, time: '半年，全职投入', compute: '可申请到 8 卡 A100 集群，持续数周' },
    { name: '只改算力：单卡 3090 · 半年', ...FIXED, time: '半年，全职投入', compute: '只有一张 RTX 3090 24GB，无集群' },
    { name: '只改时间：8 卡 A100 · 两周', ...FIXED, time: '两周，每天 2 小时', compute: '可申请到 8 卡 A100 集群，持续数周' },
    { name: '反例：笔记本无 GPU · 两年', ...FIXED, time: '两年，全职投入', compute: '只有一台笔记本，无 GPU 集群' },
  ];

  const runs = [];
  for (const p of profiles) {
    log('[决策] ' + p.name + ' ...');
    const plan = await mod.generateDecision(papers, methods, p, cfg, (t) => {
      log('      ' + t.label + ' attempt=' + t.attempt + ' ' + t.ms + 'ms' + (t.error ? ' ERROR=' + t.error : ''));
    });
    runs.push({ profile: p, plan });
  }

  const shortId = (id) => id.replace('p_arxiv_', '').slice(0, 8);
  const stateOf = (r) =>
    (r.plan.candidates || [])
      .map((c) => shortId(c.paperId) + '=' + c.fit + '/' + (c.resourceFeasibility || '?') + '@' + (c.targetStage || '?'))
      .join('  ');

  const lines = [
    '# 推荐正确性核查：单变量条件对照 + 反例（真实模型）',
    '',
    '- 生成时间：' + new Date().toLocaleString('zh-CN'),
    '- 模型：' + cfg.model + '　提示词：' + mod.PROMPT_VERSION + '　规则：' + mod.RULES_VERSION,
    '',
    '## 设计',
    '',
    '固定用户目标与基础（' + FIXED.goal + '），只改一个变量：',
    '',
    '1. **基准**：8 卡 A100 · 半年',
    '2. **只改算力**：单卡 RTX 3090 · 半年（其余与基准相同）',
    '3. **只改时间**：8 卡 A100 · 两周（其余与基准相同）',
    '4. **反例**：笔记本无 GPU · 两年（其余与基准相同）——用于检验「更长时间是否被错误换算成可复现」',
    '',
    '> 说明：本文件记录的是**候选状态、理由、证据与缺失信息**的变化，不只是排序。',
    '> 可行性状态由程序判定（stage_evidence_available / below_paper_scale / user_scale_unknown / paper_count_unknown / no_matching_stage_evidence）。',
    '',
  ];

  runs.forEach((r, i) => {
    lines.push('## ' + (i + 1) + '. ' + r.profile.name);
    lines.push('');
    lines.push('- 时间：' + r.profile.time);
    lines.push('- 算力：' + r.profile.compute);
    lines.push('');
    lines.push('**阅读顺序**：' + r.plan.steps.map((s) => shortId(s.paperId)).join(' > '));
    lines.push('');
    lines.push('**候选状态**：' + stateOf(r));
    lines.push('');
    for (const c of r.plan.candidates || []) {
      lines.push('### ' + shortId(c.paperId) + ' — fit=' + c.fit + '，目标阶段=' + (c.targetStage || '未声明') + '，可行性=' + (c.resourceFeasibility || '?'));
      if (c.fitAdjusted) lines.push('');
      if (c.fitAdjusted) lines.push('> **程序修正**：' + c.fitAdjusted);
      lines.push('');
      lines.push('- 可行性说明：' + (c.feasibilityNote || '（无）'));
      for (const reason of c.reasons) {
        const tag = reason.evidence
          ? '证据 p.' + (reason.evidence.page ?? '?') + (reason.stage ? '（' + reason.stage + '）' : '')
          : reason.basis === 'paper'
            ? '**无证据**'
            : '—';
        lines.push('- [' + reason.basis + '] ' + reason.text.replace(/\n/g, ' ').slice(0, 240));
        lines.push('  - ' + tag + (reason.bindingIssue ? '｜绑定说明：' + reason.bindingIssue : ''));
      }
      if ((c.missing || []).length) lines.push('- 缺失信息：' + c.missing.join('；'));
      lines.push('');
    }
    lines.push('');
  });

  // 反例断言：长时间不得把「预训练可复现」变成 suitable
  const negative = runs[3];
  const badNegative = (negative.plan.candidates || []).filter(
    (c) => c.fit === 'suitable' && (c.targetStage === 'pretrain' || c.targetStage === 'from_scratch'),
  );
  lines.push('## 自动核查结论');
  lines.push('');
  lines.push('- 反例（笔记本无 GPU · 两年）中被判为 suitable 且目标阶段是预训练/从头训练的候选：**' + badNegative.length + ' 个**' + (badNegative.length ? '（' + badNegative.map((c) => shortId(c.paperId)).join('、') + '）' : '（符合预期：没有把更长时间当成可复现）'));
  const robertaFeas = runs.map((r) => {
    const c = (r.plan.candidates || []).find((x) => /1907\D?11692/.test(x.paperId || ''));
    return c ? r.profile.name.slice(0, 12) + '=' + c.fit + '/' + c.resourceFeasibility : r.profile.name.slice(0, 12) + '=未出现';
  });
  lines.push('- RoBERTa 在各条件下的状态：' + robertaFeas.join('；'));
  lines.push('');
  lines.push('> 提醒：本文件只说明「程序按当前证据如何判定」，不代表这些方法一定能在用户设备上复现。');

  await writeFile(join(ROOT, 'docs', 'DECISION-VARIATION.md'), lines.join('\n'), 'utf8');
  log('');
  log('已写出：' + join(ROOT, 'docs', 'DECISION-VARIATION.md'));
  log('反例中被判 suitable 且目标阶段为训练阶段的数量=' + badNegative.length);
  process.exit(0);
}

let result;
let divergences;
let decisionSample;
let demoProfile;

if (reportOnly) {
  log("[3/5] --report-only：跳过模型调用，直接读取已有缓存重建报告");
  const index = JSON.parse(await readFile(join(outDir, "index.json"), "utf8"));
  const papers = [];
  for (const meta of index.papers) {
    const t = JSON.parse(await readFile(join(outDir, "text", meta.id + ".json"), "utf8"));
    papers.push({ ...meta, pages: t.pages, rawText: t.rawText, charCount: t.charCount });
  }
  result = { papers, methods: index.methods, relations: index.relations, relationIssues: [] };
  divergences = index.divergences ?? { findings: [], checkedPairs: [] };
  decisionSample = index.decisionSample ?? { steps: [], candidates: [] };
  demoProfile = index.demoProfile ?? {};
} else {
  log("[3/5] 真实模型抽取 ...");
  result = await mod.runOfflineExtraction(specs, cfg, log);

  log("[4/5] 跨论文分歧分析 + 示例决策 ...");
  divergences = await mod.findDivergences(result.papers, result.methods, cfg, (t) => {
    log("      " + t.label + " attempt=" + t.attempt + " " + t.ms + "ms" + (t.error ? " ERROR=" + t.error : ""));
  });
  log("      分歧发现 " + divergences.findings.length + " 条：" + divergences.findings.map((f) => f.kind).join("、"));

  demoProfile = spec.demoProfile || {
    background: "计算机相关专业，上过机器学习课，能读懂 Transformer 基本结构",
    interest: "想了解预训练语言模型的训练与评测思路",
    time: "两周，每天约 2 小时",
    compute: "只有一台笔记本，无 GPU 集群",
    goal: "选一个能上手复现的小方向做课程项目",
  };
  decisionSample = await mod.generateDecision(result.papers, result.methods, demoProfile, cfg, (t) => {
    log("      " + t.label + " attempt=" + t.attempt + " " + t.ms + "ms" + (t.error ? " ERROR=" + t.error : ""));
  });
  log("      示例决策：候选 " + (decisionSample.candidates?.length ?? 0) + " 个，阅读顺序 " + decisionSample.steps.length + " 步");
}

if (!reportOnly) {
log('[5/5] 写出缓存 ...');
await mkdir(join(outDir, 'text'), { recursive: true });

const verification = mod.buildVerificationStat
  ? mod.buildVerificationStat(result.methods)
  : undefined;

const index = {
  cacheVersion: mod.CACHE_VERSION,
  generatedBy: 'scripts/analyze.mjs（本地离线真实模型分析）',
  notLive: true,
  notice:
    '本页预置样例的结构化结论由真实模型对各论文原文抽取产生，每条引文均通过全文定位校验；' +
    '它属于预置样例，不是本次操作触发的实时分析。',
  meta: {
    generatedAt: new Date().toISOString(),
    model: cfg.model,
    promptVersion: mod.PROMPT_VERSION,
    domain: spec.domain,
    domainConfirmed: !!spec.domainConfirmed,
    samplesAreDevOnly: !!spec.samplesAreDevOnly,
    purpose: spec.purpose,
    baseUrlHost: new URL(baseUrl).host,
  },
  // 缓存与生成条件绑定：规则版本 / 输入签名不一致时界面会标为过期
  rulesVersion: mod.RULES_VERSION,
  inputsSignature: result.papers.map((p) => p.id).sort().join(","),
  papers: result.papers.map((p) => ({ ...p, rawText: undefined, pages: undefined, cached: true })),
  // 必须打上 cached 标记：否则界面会把预置结果误显示为「本次实时分析」，属于失实标注
  methods: result.methods.map((m) => mod.methodToCache(m)),
  relations: result.relations.map((r) => ({ ...r, cached: true })),
  divergences: { ...divergences, cached: true },
  decisionSample: { ...decisionSample, cached: true },
  demoProfile,
  verification,
};

await writeFile(join(outDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');

for (const p of result.papers) {
  await writeFile(
    join(outDir, 'text', `${p.id}.json`),
    JSON.stringify({ paperId: p.id, pages: p.pages, rawText: p.rawText, charCount: p.charCount }),
    'utf8',
  );
}
}

// 写一份人工可读摘要，便于开发期核对，也作为真实验证记录的一部分
const report = [
  '# 离线分析报告（真实模型）',
  '',
  `- 生成时间：${new Date().toLocaleString('zh-CN')}`,
  `- 模型：${cfg.model}（${new URL(baseUrl).host}）`,
  `- 提示词版本：${mod.PROMPT_VERSION}`,
  `- 领域标注：${spec.domain}（已确认=${!!spec.domainConfirmed}）`,
  '',
  '## 字段抽取与证据校验',
  '',
  '| 论文 | 年份 | 有值字段 | 可核验 | 待人工核对 | 未找到证据 | 缺失 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
];
const ORDER = mod.FIELD_KEYS_ORDER || [];
const cntStatus = (m, s) => ORDER.filter((k) => m.fields[k].status === s).length;
for (const m of result.methods) {
  const p = result.papers.find((x) => x.id === m.paperId);
  report.push(
    `| ${p.title} | ${p.year ?? '未识别'} | ${ORDER.filter((k) => m.fields[k].value).length}/${ORDER.length} | ${cntStatus(
      m,
      'verified',
    )} | ${cntStatus(m, 'unverified')} | ${cntStatus(m, 'no_evidence')} | ${cntStatus(m, 'missing')} |`,
  );
}

report.push('', '## 实验条件（不可比检测依据）', '');
report.push('| 论文 | 维度 | 取值 | 状态 |', '| --- | --- | --- | --- |');
for (const m of result.methods) {
  const p = result.papers.find((x) => x.id === m.paperId);
  for (const [dim, c] of Object.entries(m.conditions || {})) {
    report.push(`| ${p.title.slice(0, 34)} | ${dim} | ${c.values.join('、') || '—'} | ${c.status} |`);
  }
}

report.push('', '## 程序校验问题', '');
let issueCount = 0;
for (const m of result.methods) {
  for (const i of m.validation || []) {
    issueCount++;
    report.push(`- [${i.severity}] ${m.paperId} ${i.field ?? ''} ${i.code}：${i.message}`);
  }
}
if (!issueCount) report.push('- 无');

report.push('', '## 方法关系', '');
for (const r of result.relations) {
  const a = result.methods.find((m) => m.id === r.fromMethodId);
  const b = result.methods.find((m) => m.id === r.toMethodId);
  const pa = result.papers.find((p) => p.id === a?.paperId);
  const pb = result.papers.find((p) => p.id === b?.paperId);
  const stateText =
    r.evidenceState === 'explicit' ? '原文明示' : r.evidenceState === 'inferred' ? '系统推断' : '待核查';
  report.push(`- ${pa?.title ?? '?'} → ${pb?.title ?? '?'}：${r.type}（${stateText}）`);
  report.push(`  - 依据：${(r.evidence?.quote || r.rationale || '无').replace(/\s+/g, ' ').slice(0, 220)}`);
  for (const adj of r.stateAdjusted || []) {
    report.push(`  - 状态调整：${adj.from} → ${adj.to}（${adj.reason}）`);
  }
}
for (const i of result.relationIssues || []) {
  report.push(`- [${i.severity}] 关系问题 ${i.code}：${i.message}`);
}

report.push('', '## 跨论文分歧发现', '');
for (const f of divergences.findings) {
  report.push(`- [${f.kind}] ${f.topic}｜可比性=${f.comparabilityLevel}`);
  report.push(`  - 涉及：${f.paperIds.join('、') || '—'}`);
  report.push(`  - 说明：${f.explanation || '—'}`);
  if (f.conditionDifferences?.length) {
    report.push(`  - 条件差异：${f.conditionDifferences.map((d) => `${d.label}(${d.detail})`).join('；')}`);
  }
  report.push(`  - 下一步：${f.nextAction}`);
}
report.push('', '### 已检查的论文对', '');
for (const c of divergences.checkedPairs) report.push(`- ${c.pair}：${c.result}`);

// 可比性矩阵：规则计算结果，供人工核对
const cmp = mod.compareConditions(result.papers, result.methods);
report.push('', '## 不可比检测矩阵（规则计算）', '');
report.push(`总体结论：**${mod.LEVEL_LABELS[cmp.overall.level]}** —— ${cmp.overall.summary}`, '');
report.push('| 条件维度 | 结论 | 具体差异 |', '| --- | --- | --- |');
for (const d of cmp.dimensions) {
  report.push(`| ${d.label} | ${mod.LEVEL_LABELS[d.level]} | ${d.differences.join('；').slice(0, 300) || '—'} |`);
}
report.push('', '### 各论文条件取值', '');
for (const m of result.methods) {
  const p = result.papers.find((x) => x.id === m.paperId);
  report.push(`- ${p.title}`);
  for (const [dim, c] of Object.entries(m.conditions || {})) {
    report.push(`  - ${dim}：${c.values.join('、').slice(0, 160) || '—'}（${c.status}${c.note ? '，' + c.note : ''}）`);
  }
}

report.push('', '## 示例决策（演示用用户条件）', '');
report.push(`- 用户条件：${JSON.stringify(demoProfile)}`);
for (const c of decisionSample.candidates || []) {
  report.push(`- 候选 ${c.paperId}：fit=${c.fit}，算力已报告=${c.computeReported}`);
  for (const r of c.reasons) report.push(`  - [${r.basis}] ${r.text}`);
  if (c.missing.length) report.push(`  - 缺失信息：${c.missing.join('；')}`);
}
for (const s of decisionSample.steps) {
  report.push(`- ${s.order}. ${s.paperId}｜${s.basis}：${s.reason}`);
}
report.push(`- 条件敏感性：${decisionSample.conditionSensitivity || '—'}`);

await writeFile(join(outDir, 'REPORT.md'), report.join('\n'), 'utf8');

log('');
log(`完成。索引：${join(outDir, 'index.json')}`);
log(`      全文：${join(outDir, 'text')}/ (${result.papers.length} 篇)`);
log(`      报告：${join(outDir, 'REPORT.md')}`);
