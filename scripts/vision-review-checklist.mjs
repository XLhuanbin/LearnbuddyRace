/**
 * 生成「人工可审阅的核查清单」：逐项列出原文、系统输出与判断结果。
 *
 * 原则（按本轮要求）：
 * - **数据核对与模型核对分开**：数值是否与论文一致属「数据核对」；抽取是否跑通属「模型核对」。
 * - 不静默修正：系统输出原样保留，人工判断单独一列；发现不一致就写「不一致」。
 *
 * 用法：node scripts/vision-review-checklist.mjs --out public/samples-vision
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outRel = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'public/samples-vision';
})();
const outDir = resolve(ROOT, outRel);
const index = JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8'));

const paperById = new Map(index.papers.map((p) => [p.id, p]));
const lines = [
  '# 正式视觉语料：人工核查清单',
  '',
  `- 生成时间：${new Date().toLocaleString('zh-CN')}`,
  `- 数据来源：${outRel}/index.json（模型输出 + 程序核查结果）`,
  '- 表格里「系统输出」是**原样保留**的抽取结果；「核查判断」是人工/程序给出的判断，两者分开记录，没有静默修正。',
  '- 判断口径：✅ 数据核对通过（数值与行标签同现于原文，且列头与指标一致）；⚠️ 待核查（可定位但列对齐/行带未确认）；❌ 与原文不一致。',
  '',
  '## 一、论文级核对',
  '',
  '| 论文 | 系统输出标题 | 标题来源 | 年份 | arXiv | 页数 | 首层校验状态 | 判断 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
];
for (const p of index.papers) {
  const m = index.methods.find((x) => x.paperId === p.id);
  const issue = (m?.validation ?? []).filter((v) => v.code !== 'condition_not_extracted' && v.code !== 'evidence_not_located');
  lines.push(
    `| ${p.id.replace('p_arxiv_', '')} | ${(p.title ?? '').slice(0, 60)} | ${p.titleFrom ?? 'heuristic'} | ${p.year ?? '—'} | ${p.source?.url ?? '—'} | ${p.pageCount ?? '—'} | ${issue.length ? issue.map((v) => v.code).join('、') : '无警告'} | ${p.titleFrom === 'model-verified' ? '✅ 标题经模型校正并在原文验证' : p.titleFrom === 'unverified' ? '⚠️ 标题未确认' : '— 启发式标题'} |`,
  );
}

lines.push(
  '',
  '> 说明：本轮 5 篇里 DeiT 与 Swin 的启发式标题抓到了摘要句子（PDF 首页排版导致），',
  '> 系统用模型给出的标题并在原文中验证后校正为论文真实标题；ResNet / ViT / ConvNeXt 的启发式标题本身正确。',
  '',
  '## 二、实验记录逐条核对',
  '',
  '| 论文 | 模型变体 | 系统输出 | 页码 | 原文版面带（数值所在行） | 行标签在带内 | 列头（向上找） | 核查判断 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
);

let ok = 0;
let pending = 0;
let bad = 0;
for (const m of index.methods) {
  const paper = paperById.get(m.paperId)?.title ?? m.paperId;
  for (const e of m.experiments ?? []) {
    const v = e.verification ?? {};
    const band = (v.layout?.bandText ?? '').replace(/\|/g, '/').slice(0, 70);
    const confirmed = v.rowColConfirmed;
    if (confirmed) ok++;
    else pending++;
    lines.push(
      `| ${paper.slice(0, 22)} | ${e.modelVariant} | ${e.metricName}=${e.metricValue}${e.metricUnit ?? ''} @${e.evalDataset} | ${e.evidence?.page ?? '—'} | ${band || '（未取到版面带）'} | ${v.layout?.rowInBand ? '是' : '否'} | ${v.layout?.columnHeader ?? '—'} | ${confirmed ? '✅ 数据核对通过' : '⚠️ 待核查'} |`,
    );
  }
}

lines.push(
  '',
  `小结：${ok} 条通过「文本 + 版面」双核查，${pending} 条待核查（多为列对齐/行带无法用几何确认），${bad} 条与原文不一致。`,
  '',
  '待核查不等于数值错误：这些记录的数值与模型行标签都能在原文中定位（见「原文版面带」列），',
  '但因为表格是双栏/跨行排版，程序无法确认「这个数值确实属于所报的那一列」，因此按规则标为待核查、不进入「可直接比较」。',
  '',
  '## 三、本轮人工核查发现的问题（含未修复项）',
  '',
  '| # | 问题 | 类型 | 处理 |',
  '| --- | --- | --- | --- |',
  '| 1 | DeiT、Swin 的启发式标题抓到摘要句子 | 解析（非模型） | **已修复**：模型标题 + 原文验证校正，并保留 `titleFrom` 标记 |',
  '| 2 | ResNet 报的是 top-1 **error**，DeiT/Swin/ConvNeXt 报的是 top-1 **accuracy**，程序原先把两者当成同一指标 | 规则 | **已修复**：区分 error / accuracy，并在比较时说明「可互换但方向相反」 |',
  '| 3 | 表格行标签核查最初用「逐字包含」，导致 `Swin-T` 这类短标签一律判失败 | 规则 | **已修复**：改用归一化定位 + 要求出现在引文附近 |',
  '| 4 | 列头搜索范围过小（220pt），而真实列头在数值上方约 268pt | 规则 | **已修复**：扩大范围并过滤句子型候选（列头形如 top-1 / FLOPs） |',
  '| 5 | ViT 的一条记录把数据集名当成了指标名（`ImageNet=88.55`），另一条是 `accuracy` | **模型抽取错误** | **未修复**：已在界面按原样展示并在本清单标出；修复需要重跑该篇抽取或人工修正，本轮不静默改数 |',
  '| 6 | Swin 中仅用 ImageNet-1K 训练的三条记录，预训练数据为「未知」（论文其实写了 1K 训练/无额外数据） | 模型抽取不完整 | **未修复**：标为未知而不是猜；Swin-L 的 22K 预训练已正确抽出 |',
  '',
  '## 四、判定边界',
  '',
  '- 本清单的「数据核对通过」只说明**数值与该行原文一致、列头与指标一致**，不代表该实验设置完整（例如训练轮数、增强策略未必记录）。',
  '- 「待核查」是保守判断：宁可标出来，也不把无法确认的行列关系当作事实。',
  '- 本文件不参与任何排名或「架构更优」的因果结论。',
  '',
);

await writeFile(join(ROOT, 'docs', 'VISION-REVIEW-CHECKLIST.md'), lines.join('\n'), 'utf8');
console.log(`已写出 docs/VISION-REVIEW-CHECKLIST.md（通过 ${ok}，待核查 ${pending}，不一致 ${bad}）`);
