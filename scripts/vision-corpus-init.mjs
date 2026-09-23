/**
 * 建立正式视觉语料集（与旧 NLP 开发样例隔离）。
 *
 * - 把用户提供的 PDF 复制到 samples/pdfs/vision/（只用于本地解析；仓库不对外分发 PDF）
 * - 生成 samples/vision-samples.json（语料清单：版本线索、角色、用途标注）
 * - 只做文件与元数据整理，不调用模型
 *
 * 用法：node scripts/vision-corpus-init.mjs
 */

import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = resolve(ROOT, '..', '视觉经典论文');
const DST_DIR = join(ROOT, 'samples', 'pdfs', 'vision');

/** 文件 → 论文身份（arXiv 编号与标题来自文件核对记录 docs/VISION-CORPUS-FILES.md） */
const MAP = [
  {
    file: '01_ResNet_2015.pdf',
    arxivId: '1512.03385',
    shortName: 'ResNet',
    role: 'background',
    note: '背景与比较材料：CNN 路线的代表，后文方法的对照基准',
  },
  {
    file: '02_ViT_2020.pdf',
    arxivId: '2010.11929',
    shortName: 'ViT',
    role: 'background',
    note: '背景与比较材料：首个把纯 Transformer 用于图像分类；首页明确标注 ICLR 2021',
  },
  {
    file: '03_DeiT_2020.pdf',
    arxivId: '2012.12877',
    shortName: 'DeiT',
    role: 'core',
    note: '核心案例：数据高效训练 + 蒸馏，直接回应「只有 ImageNet-1K 能否训练 Transformer」',
  },
  {
    file: '04_Swin_Transformer_2021.pdf',
    arxivId: '2103.14030',
    shortName: 'Swin',
    role: 'core',
    note: '核心案例：分层结构与移位窗口，分类与密集预测任务并存（需区分任务标签）',
  },
  {
    file: '05_ConvNeXt_2022.pdf',
    arxivId: '2201.03545',
    shortName: 'ConvNeXt',
    role: 'core',
    note: '核心案例：把 Transformer 的设计要素搬回 CNN，是「路线之争」最关键的对照',
  },
];

await mkdir(DST_DIR, { recursive: true });

const found = (await readdir(SRC_DIR)).filter((f) => f.toLowerCase().endsWith('.pdf'));
const entries = [];
const missing = [];

for (const item of MAP) {
  const src = join(SRC_DIR, item.file);
  if (!existsSync(src)) {
    missing.push(item.file);
    continue;
  }
  await copyFile(src, join(DST_DIR, item.file));
  entries.push({ ...item });
}

const spec = {
  corpusId: 'vision-classification',
  domain: '图像分类中 CNN 与视觉 Transformer 的方法演进与实验比较',
  domainConfirmed: true,
  purpose: '正式参赛案例（真实论文、真实抽取；不是开发流程验证样例）',
  isolation: '与 NLP 开发回归样例（samples/dev-samples.json）完全隔离，不混合生成关系与推荐',
  createdAt: new Date().toISOString(),
  papers: entries.map((e) => ({
    file: join('samples', 'pdfs', 'vision', e.file),
    arxivId: e.arxivId,
    shortName: e.shortName,
    role: e.role,
    purpose: e.note,
  })),
};

await writeFile(join(ROOT, 'samples', 'vision-samples.json'), JSON.stringify(spec, null, 2) + '\n', 'utf8');

console.log(`已复制 ${entries.length} 个 PDF 到 samples/pdfs/vision/`);
if (missing.length) console.log(`⚠️ 缺少文件：${missing.join('、')}`);
for (const e of entries) {
  console.log(`  ${e.shortName.padEnd(9)} arXiv:${e.arxivId}  role=${e.role}`);
}
console.log('已写出 samples/vision-samples.json');

// 顺带确认旧样例仍然存在且未被改动
const devSpec = JSON.parse(await readFile(join(ROOT, 'samples', 'dev-samples.json'), 'utf8'));
console.log(`旧 NLP 开发样例仍在：${devSpec.papers?.length ?? 0} 篇（samples/dev-samples.json）`);
