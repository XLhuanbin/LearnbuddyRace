/**
 * 规则重算脚本（不调用模型）。
 *
 * 用途：本轮修正了可比性、关系可信度、条件范围与分歧复核等一系列**程序判定规则**。
 * 模型余额不足时无法重新生成模型输出，但规则类结论可以直接用新规则在已有缓存上重算。
 *
 * 重要边界（不允许混淆）：
 * - 本脚本**不调用任何模型**，不改写模型给出的文字结论、字段值、引文；
 * - 它对「程序判定」负责：字段校验问题、条件范围与状态、关系可信度三档、分歧发现的种类与可比性；
 * - 结果会写入 revalidatedOnly=true，并在界面上明确标注「判定类结论已按新规则重算，模型输出仍是旧提示词产物」。
 *
 * 用法：
 *   node scripts/revalidate.mjs [--out public/samples]
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

const outDir = resolve(ROOT, arg('out', 'public/samples'));
const buildDir = join(ROOT, '.build');
const bundlePath = join(buildDir, `revalidate-${process.pid}.mjs`);

function log(m) {
  console.log(m);
}

log('[1/3] 打包核心逻辑 (esbuild) ...');
await mkdir(buildDir, { recursive: true });
const bin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
const b = spawnSync(
  bin,
  [join(ROOT, 'src/core/nodePipeline.ts'), '--bundle', '--format=esm', '--platform=node', '--target=node20', '--external:pdfjs-dist', '--outfile=' + bundlePath],
  { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' },
);
if (b.status !== 0) {
  console.error('[中止] esbuild 打包失败。');
  process.exit(3);
}
const mod = await import(pathToFileURL(bundlePath).href);

log('[2/3] 读取已有缓存 ...');
const indexPath = join(outDir, 'index.json');
const index = JSON.parse(await readFile(indexPath, 'utf8'));

const papers = [];
for (const meta of index.papers) {
  const t = JSON.parse(await readFile(join(outDir, 'text', `${meta.id}.json`), 'utf8'));
  papers.push({ ...meta, pageCount: meta.pageCount ?? t.pages?.length, pages: t.pages, rawText: t.rawText, charCount: t.charCount });
}
log(`      论文 ${papers.length} 篇，方法 ${index.methods.length} 个，关系 ${index.relations.length} 条`);

log('[3/3] 按当前规则重算判定类结论 ...');

// ---- 1. 方法：条件结构迁移 + 字段/条件校验（不触碰模型给出的值与引文）----
let issueTotal = 0;
const issuesBefore = { total: 0, byCode: {} };
for (const m of index.methods) {
  for (const i of m.validation || []) {
    issuesBefore.total++;
    issuesBefore.byCode[i.code] = (issuesBefore.byCode[i.code] ?? 0) + 1;
  }
}

const methods = index.methods.map((raw) => {
  const migrated = mod.migrateMethod(raw);
  // 条件范围按当前规则归一化（与实时抽取共用同一函数）
  migrated.conditions = mod.normalizeConditions(migrated.conditions ?? {});
  const paper = papers.find((p) => p.id === migrated.paperId);
  const issues = mod.validateMethod(paper, migrated);
  issueTotal += issues.length;
  return { ...migrated, validation: issues };
});

// ---- 2. 关系：重新做证据充分性判定（含别名匹配与降级理由）----
let relationChanges = 0;
const relationLog = [];
const relations = index.relations.map((raw) => {
  const rel = mod.migrateRelation(raw);
  const before = rel.evidenceState;
  // 重新定位主证据与全部片段（模型输出的引文本身不变）
  const fromMethod = methods.find((m) => m.id === rel.fromMethodId);
  const toMethod = methods.find((m) => m.id === rel.toMethodId);
  const fromPaper = papers.find((p) => p.id === fromMethod?.paperId);
  const toPaper = papers.find((p) => p.id === toMethod?.paperId);
  const searchOrder = [toPaper, fromPaper, ...papers].filter(Boolean);
  const quotes = [...new Set([rel.evidence?.quote, ...(rel.evidenceList || []).map((e) => e.quote)].filter(Boolean))];
  const located = [];
  let unlocated;
  for (const q of quotes) {
    let hit;
    const seen = new Set();
    for (const cand of searchOrder) {
      if (seen.has(cand.id)) continue;
      seen.add(cand.id);
      const ev = mod.buildEvidence(cand, { quote: q });
      if (ev?.verified) {
        hit = ev;
        break;
      }
    }
    if (hit) located.push(hit);
    else if (!unlocated) unlocated = mod.buildEvidence(toPaper ?? fromPaper, { quote: q });
  }

  const assess = (ev) =>
    mod.assessRelationEvidence(ev.quote, fromMethod?.fields.methodName.value, toMethod?.fields.methodName.value, rel.type);
  let primary;
  if (rel.evidenceState === 'explicit') primary = located.find((ev) => assess(ev).sufficient);
  if (!primary) primary = located[0] ?? unlocated;

  const draft = {
    ...rel,
    evidence: primary,
    evidenceList: located.length ? located : undefined,
    stateAdjusted: [],
    evidenceAssessment: primary && primary.verified ? assess(primary).reason : undefined,
  };
  const { relation } = mod.validateRelation(draft, methods, papers);
  if (relation.evidenceState !== before) {
    relationChanges++;
    relationLog.push(`${fromPaper?.title?.slice(0, 26) ?? '?'} → ${toPaper?.title?.slice(0, 26) ?? '?'}：${before} → ${relation.evidenceState}｜${relation.stateAdjusted?.[0]?.reason ?? ''}`);
  } else if (relation.evidenceAssessment) {
    relationLog.push(`${fromPaper?.title?.slice(0, 26) ?? '?'} → ${toPaper?.title?.slice(0, 26) ?? '?'}：保持 ${relation.evidenceState}｜${relation.evidenceAssessment}`);
  }
  return relation;
});

// ---- 3. 分歧：用共享规则重算种类、可比性与复核说明 ----
let divergenceChanges = 0;
const divergenceLog = [];
let divergences = index.divergences;
if (divergences?.findings) {
  const beforeKinds = divergences.findings.map((f) => f.kind);
  const findings = divergences.findings.map((f, i) => mod.applyDivergenceRules(papers, methods, f, i));
  const afterKinds = findings.map((f) => f.kind);
  divergenceChanges = beforeKinds.filter((k, i) => k !== afterKinds[i]).length;
  beforeKinds.forEach((k, i) => {
    if (k !== afterKinds[i]) divergenceLog.push(`第 ${i + 1} 条：${k} → ${afterKinds[i]}｜${findings[i].ruleNotes?.[0] ?? ''}`);
  });
  divergences = {
    ...divergences,
    findings,
    checkedPairs: mod.buildCheckedPairs(papers, methods, (id) => papers.find((p) => p.id === id)?.title ?? id),
    derivedFrom: { rulesVersion: mod.RULES_VERSION, paperSignature: papers.map((p) => p.id).sort().join(',') },
    stale: true,
    staleReasons: [`本文件的分歧种类与可比性已由程序按规则 ${mod.RULES_VERSION} 重算（规则重算，未重新调用模型）`],
  };
}

// ---- 4. 写回 ----
const verification = mod.buildVerificationStat(methods);
const next = {
  ...index,
  cacheVersion: mod.CACHE_VERSION,
  methods,
  relations,
  divergences,
  verification,
  rulesVersion: mod.RULES_VERSION,
  inputsSignature: papers.map((p) => p.id).sort().join(','),
  revalidatedOnly: true,
  revalidationNote:
    `本文件的「判定类结论」（字段校验问题、条件范围与状态、关系可信度三档、分歧种类与可比性、已检查论文对）` +
    `已由程序按规则 ${mod.RULES_VERSION} 在模型输出上重算；` +
    `模型给出的字段值、引文、理由文字来自提示词 ${index.meta?.promptVersion ?? '未知'} 的那次真实调用（未在重算中重新调用模型）。`,
  papers: index.papers.map((p) => {
    const full = papers.find((x) => x.id === p.id);
    return { ...p, pageCount: full?.pageCount ?? p.pageCount };
  }),
};

await writeFile(indexPath, JSON.stringify(next, null, 2), 'utf8');

// ---- 5. 变更记录（人工可读）----
const lines = [
  '# 规则重算记录（未调用模型）',
  '',
  `- 执行时间：${new Date().toLocaleString('zh-CN')}`,
  `- 规则版本：${mod.RULES_VERSION}`,
  `- 模型输出来源：提示词 ${index.meta?.promptVersion ?? '未知'}（本脚本未重新调用模型）`,
  '',
  '## 校验问题',
  '',
  `- 重算前：${issuesBefore.total} 条 ${JSON.stringify(issuesBefore.byCode)}`,
  `- 重算后：${issueTotal} 条 ${JSON.stringify(mod.summarizeIssues(methods.flatMap((m) => m.validation)).byCode)}`,
  '',
  '## 关系可信度',
  '',
  `- 状态发生变化的条数：${relationChanges}`,
  '',
  ...relationLog.map((s) => `- ${s}`),
  '',
  '## 分歧发现',
  '',
  `- 种类发生变化的条数：${divergenceChanges}`,
  '',
  ...divergenceLog.map((s) => `- ${s}`),
  '',
  '## 说明',
  '',
  '本文件中的变化全部由程序按新规则重算得到，不包含任何新的模型输出。',
  '需要模型重新判断的部分（字段值、实验条件的取值范围、推荐文字）保持原样，并在界面标记为旧提示词产物。',
];
await writeFile(join(ROOT, 'docs', 'REVALIDATION.md'), lines.join('\n'), 'utf8');

log('');
log(`完成。校验问题 ${issuesBefore.total} → ${issueTotal}；关系状态变化 ${relationChanges} 条；分歧种类变化 ${divergenceChanges} 条`);
log(`记录：${join(ROOT, 'docs', 'REVALIDATION.md')}`);
