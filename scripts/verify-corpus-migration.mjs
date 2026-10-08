/**
 * 预置语料缓存迁移一致性回归（纯离线，不调用模型，不需要浏览器）。
 *
 * 用法：node scripts/verify-corpus-migration.mjs
 *
 * 验证两件事：
 *   1. 旧格式缓存索引（字段两态、缺条件维度、关系用已废弃 assertedBy）经
 *      `normalizeCorpusIndex` 迁移后，全部落到当前格式：
 *        字段 → 四态（verified / unverified / no_evidence / missing）；
 *        条件 → 覆盖全部 CONDITION_DIMENSIONS 维度；
 *        关系 → 有 evidenceState，且 explicit/inferred 带非空 rationale。
 *   2. 当前格式缓存（public/samples/index.json、public/samples-vision/index.json）
 *      经迁移后**语义不变**（幂等），证明把迁移收进 loadCorpusIndex 不会改动现有真实数据。
 *
 * 覆盖的真实缺陷：此前 `migrateMethod` 只在「从本机 IndexedDB 恢复记录」的 App 路径上被调用，
 * 而从语料文件加载（`loadCorpusIndex`）这条路径没有迁移 —— 同一份数据两条加载路径口径不一致。
 * 本脚本是该修复的独立回归，不修改 tests/core.test.ts（该文件归核心 A）。
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUILD = join(ROOT, '.build');
await mkdir(BUILD, { recursive: true });

const esbuildBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
const bundle = (entry, name) => {
  const out = join(BUILD, `${name}.${process.pid}.mjs`);
  const r = spawnSync(
    esbuildBin,
    [join(ROOT, entry), '--bundle', '--format=esm', '--platform=node', '--target=node20', '--outfile=' + out],
    { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' },
  );
  if (r.status !== 0) {
    console.error('[中止] esbuild 打包失败：' + entry);
    process.exit(1);
  }
  return pathToFileURL(out).href;
};

const cacheMod = await import(bundle('src/core/cache.ts', 'verify-cache'));
const typesMod = await import(bundle('src/core/types.ts', 'verify-types'));
const { normalizeCorpusIndex, CACHE_VERSION } = cacheMod;
const { CONDITION_DIMENSIONS } = typesMod;

const FIELD_STATUSES = ['verified', 'unverified', 'no_evidence', 'missing'];

let pass = 0;
let fail = 0;
const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? ` 〔${extra}〕` : ''}`);
  } else {
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

/** 键序无关的稳定序列化，用于「语义是否变化」的比较 */
const stable = (v) => {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
};

/* -------------------- 1. 旧格式缓存迁移 -------------------- */
console.log('=== 1. 旧格式缓存索引迁移（字段两态 + 缺条件维度 + 已废弃 assertedBy） ===');

/** 拼一份「第一阶段」风格的最小旧缓存：刻意缺 conditions、缺 overrides、关系用 assertedBy */
const legacyIndex = {
  cacheVersion: 1,
  generatedBy: 'legacy-v1',
  notLive: true,
  notice: '旧格式缓存',
  meta: { generatedAt: '2024-01-01T00:00:00Z', model: 'legacy', promptVersion: 'v1' },
  papers: [
    { id: 'p_arxiv_0000.00001', title: '旧论文', authors: [], source: { kind: 'arxiv' }, parseStatus: 'ok', pages: [], rawText: '', charCount: 0, createdAt: 0 },
  ],
  methods: [
    {
      id: 'm_old_1',
      paperId: 'p_arxiv_0000.00001',
      fields: {
        researchTask: { status: 'ok', value: '图像分类' },
        methodName: { status: 'partial', value: '残差网络' },
        coreIdea: { status: 'unverified' },
        inputsConditions: { status: 'no_evidence', value: 'ImageNet' },
        datasets: { status: 'missing' },
        // 正例：旧标签 ok **且引文已定位** —— 必须仍然可核验（门槛不能变成一律降级）
        metrics: {
          status: 'ok',
          value: 'top-1 accuracy',
          evidence: { paperId: 'p_arxiv_0000.00001', quote: 'top-1 accuracy', page: 2, locator: 'page', verified: true },
        },
      },
      // 旧格式的条件结构：只有部分维度，且用早期的 extraTrainingData 键名
      conditions: {
        datasets: { values: ['ImageNet'], status: 'verified' },
        extraTrainingData: { values: ['JFT-300M'], status: 'verified', note: '旧字段' },
      },
      // 旧格式没有 overrides
    },
    // 关系迁移要能校验「引文是否足以支撑该关系」，必须有方法名可用
    { id: 'm_old_2', paperId: 'p_arxiv_0000.00001', fields: { methodName: { status: 'ok', value: 'ResNet' } } },
    { id: 'm_old_3', paperId: 'p_arxiv_0000.00001', fields: { methodName: { status: 'ok', value: 'ViT' } } },
  ],
  relations: [
    {
      id: 'r_old_1',
      fromMethodId: 'm_old_1',
      toMethodId: 'm_old_2',
      type: 'extends',
      evidence: { paperId: 'p_arxiv_0000.00001', quote: 'we build upon', page: 3, locator: 'page', verified: true },
      assertedBy: 'explicit',
    },
    {
      id: 'r_old_2',
      fromMethodId: 'm_old_2',
      toMethodId: 'm_old_3',
      type: 'similar',
      evidence: { paperId: 'p_arxiv_0000.00001', quote: 'x', locator: 'none', verified: false },
      // 既没有 evidenceState 也没有 assertedBy，且引文未定位
    },
    {
      // 正例：引文已定位 **且** 指名了被继承方法、含继承措辞 —— 必须仍保留 explicit
      id: 'r_old_3',
      fromMethodId: 'm_old_2',
      toMethodId: 'm_old_3',
      type: 'extends',
      evidence: { paperId: 'p_arxiv_0000.00001', quote: 'Our ViT is based on ResNet.', page: 2, locator: 'page', verified: true },
      assertedBy: 'explicit',
    },
  ],
  verification: { fieldsWithValue: 0, fieldsEvidenceVerified: 0, fieldsEvidenceFailed: 0, fieldsNoEvidence: 0, fieldsMissing: 0, totalFields: 0 },
};

const norm = normalizeCorpusIndex(legacyIndex);
const m0 = norm.methods[0];

check('迁移不改变 cacheVersion 等元信息（只迁移结构，不改身份）', norm.cacheVersion === legacyIndex.cacheVersion && norm.notLive === true);
check(
  '成果：旧标签 ok 但**没有引文**的字段不标「可核验」→ 待人工核对',
  FIELD_STATUSES.includes(m0.fields.researchTask.status) && m0.fields.researchTask.status === 'unverified',
  `researchTask: ok（无引文）→ ${m0.fields.researchTask.status}`,
);
check(
  '成果：旧标签 ok 但**引文已定位**的字段仍可核验（门槛没有过度收紧）',
  m0.fields.metrics.status === 'verified',
  `metrics: ok（引文已定位）→ ${m0.fields.metrics.status}`,
);
check(
  '成果：因缺证据而降级的字段写明原因（可追溯）',
  (m0.fields.researchTask.note || '').includes('没有可核验的原文引文'),
  m0.fields.researchTask.note || '',
);
check('成果：partial 有值 → unverified', m0.fields.methodName.status === 'unverified', `methodName: partial → ${m0.fields.methodName.status}`);
check('成果：unverified 无值 → missing（不把空值当已核验）', m0.fields.coreIdea.status === 'missing', `coreIdea: unverified(空) → ${m0.fields.coreIdea.status}`);
check('成果：no_evidence 保持不变', m0.fields.inputsConditions.status === 'no_evidence');
check('成果：missing 保持不变', m0.fields.datasets.status === 'missing');
const allCurrent = m0 && Object.values(m0.fields).every((f) => FIELD_STATUSES.includes(f.status));
check('成果：所有字段状态都是当前四态之一（没有残留 ok/partial/unverified 旧标签）', allCurrent);

const dims = CONDITION_DIMENSIONS;
const condKeys = m0.conditions ? Object.keys(m0.conditions) : [];
check('成果：补齐条件结构，覆盖全部条件维度', dims.every((d) => condKeys.includes(d)), `${new Set([...dims, ...condKeys]).size - condKeys.filter((k) => !dims.includes(k)).length}/${dims.length} 维，键=${condKeys.length}`);
check('成果：旧键 extraTrainingData → downstreamExtraData，并标记 structureMigrated', Boolean(m0.conditions.downstreamExtraData) && m0.conditions.downstreamExtraData.structureMigrated === true, 'extraTrainingData → downstreamExtraData');
check('成果：未涉及的维度标为 not_extracted（不猜内容）', m0.conditions.metrics && m0.conditions.metrics.status === 'not_extracted' && Array.isArray(m0.conditions.metrics.values), `metrics: ${m0.conditions.metrics && m0.conditions.metrics.status}`);
check('成果：原有维度的取值不丢失', (m0.conditions.datasets.values || []).includes('ImageNet'));

const rel1 = norm.relations.find((r) => r.id === 'r_old_1');
const rel2 = norm.relations.find((r) => r.id === 'r_old_2');
check(
  '成果：assertedBy=explicit 但引文不足以支撑（未指名被继承方法）→ 降为待核查',
  rel1.evidenceState === 'candidate',
  `r_old_1: assertedBy=explicit → ${rel1.evidenceState}`,
);
check(
  '成果：降级关系留下可读原因（stateAdjusted）',
  (rel1.stateAdjusted ?? []).some((x) => String(x.reason).includes('迁移后按「待核查」处理')),
  JSON.stringify((rel1.stateAdjusted ?? []).map((x) => x.reason)).slice(0, 90),
);
const rel3 = norm.relations.find((r) => r.id === 'r_old_3');
check(
  '成果：引文已定位且通过充分性判定时仍保留 explicit（门槛没有变成一律降级）',
  rel3.evidenceState === 'explicit',
  `r_old_3 → ${rel3.evidenceState}`,
);
check('成果：迁移出的关系带非空来源理由（不允许空 rationale）', typeof rel1.rationale === 'string' && rel1.rationale.length > 0, (rel1.rationale || '').slice(0, 40));
check(
  '成果：既无状态标签、引文又未定位的关系 → 待核查（不冒充任何正向结论）',
  rel2.evidenceState === 'candidate',
  `r_old_2 → ${rel2.evidenceState}`,
);
check('成果：关系 evidenceState 全部是当前三档之一', norm.relations.every((r) => ['explicit', 'inferred', 'candidate'].includes(r.evidenceState)));

/* -------------------- 2. 当前格式缓存的幂等性 -------------------- */
console.log('');
console.log('=== 2. 当前格式缓存：迁移必须语义幂等（不改变任何真实数据） ===');
for (const rel of ['public/samples/index.json', 'public/samples-vision/index.json']) {
  const raw = JSON.parse(await readFile(join(ROOT, rel), 'utf8'));
  const idem = normalizeCorpusIndex(raw);
  const methodsSame = stable(raw.methods) === stable(idem.methods);
  const relsSame = stable(raw.relations) === stable(idem.relations);
  check(`${rel}：cacheVersion=${raw.cacheVersion}（=当前 ${CACHE_VERSION}）`, raw.cacheVersion === CACHE_VERSION, `当前缓存格式版本 ${CACHE_VERSION}`);
  check(`${rel}：方法迁移前后语义一致`, methodsSame, `${raw.methods.length} 个方法`);
  check(`${rel}：关系迁移前后语义一致`, relsSame, `${(raw.relations || []).length} 条关系`);
}

console.log('');
console.log(`结果：通过 ${pass}，失败 ${fail}`);
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
