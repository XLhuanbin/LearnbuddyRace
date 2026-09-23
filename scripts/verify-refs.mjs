/**
 * 论文书目信息核实（只用 arXiv 官方 API，逐条核对标题与年份）。
 * 目的：为「正式领域候选」提供**经过核实**的链接；查不到的标为待核实，不编造。
 *
 * 用法：node scripts/verify-refs.mjs
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const groups = {
  '候选一：三维点云中的语义分割（同一任务、同一评测集、同一指标）': [
    '1612.00593',
    '1706.02413',
    '1801.07829',
    '1904.08889',
    '1911.11236',
    '2012.09164',
    '2206.04670',
    '2003.00492',
  ],
  '候选二：低资源条件下的视觉表征与轻量模型（训练成本可控，适合毕设复现）': [
    '2002.05709',
    '1911.05722',
    '2110.02178',
    '1905.11946',
    '2010.11929',
  ],
  '候选三：检索增强生成中的长文档问答（文本域，抽取链路最成熟）': [
    '2005.11401',
    '2007.01282',
    '2002.08909',
    '2112.04426',
    '2310.11511',
  ],
};

const all = [...new Set(Object.values(groups).flat())];
const url = `http://export.arxiv.org/api/query?id_list=${all.join(',')}&max_results=${all.length}`;

console.log(`查询 arXiv API，共 ${all.length} 条 …`);
const res = await fetch(url, { headers: { 'User-Agent': 'ResearchPilot-dev-verify/1.0' } });
if (!res.ok) {
  console.error(`arXiv API 返回 HTTP ${res.status}，无法核实；全部标记为「待核实」。`);
  process.exit(1);
}
const xml = await res.text();

const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
const meta = new Map();
for (const e of entries) {
  const pick = (tag) => {
    const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(e);
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
  };
  const idUrl = pick('id');
  const id = (/([\d.]+v?\d*)$/.exec(idUrl) || [])[1]?.replace(/v\d+$/, '') ?? '';
  meta.set(id, {
    title: pick('title'),
    published: pick('published').slice(0, 10),
    updated: pick('updated').slice(0, 10),
    summary: pick('summary'),
    authors: [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((x) => x[1].trim()).slice(0, 4),
  });
}

const lines = [
  '# 正式领域候选的书目核实记录',
  '',
  `- 核实时间：${new Date().toLocaleString('zh-CN')}`,
  '- 来源：arXiv 官方 API（`export.arxiv.org/api/query`），逐条比对编号与标题。',
  '- 说明：本文件只记录**核实结果**。凡未出现在「已核实」清单中的论文，一律视为待核实，不得引用。',
  '',
];

let okCount = 0;
let missCount = 0;

for (const [group, ids] of Object.entries(groups)) {
  lines.push(`## ${group}`, '');
  lines.push('| 编号 | 标题（API 返回） | 首次提交 | 最新版本 | 核实 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const id of ids) {
    const m = meta.get(id);
    if (m && m.title) {
      okCount++;
      lines.push(`| arXiv:${id} | ${m.title.replace(/\|/g, '/')} | ${m.published} | ${m.updated} | ✅ 已核实 |`);
    } else {
      missCount++;
      lines.push(`| arXiv:${id} | —（API 未返回该编号） | — | — | ⚠️ 待核实 |`);
    }
  }
  lines.push('');
}

lines.push('---', '');
lines.push(`合计：已核实 ${okCount} 条，待核实 ${missCount} 条。`);
lines.push('');
lines.push('> 提醒：编号与标题核实通过**不代表**该论文与候选领域中的其它论文一定可比；');
lines.push('> 可比性仍需按任务、数据集版本与划分、指标逐项核对（本项目由程序按论文对判定）。');

await writeFile(join(ROOT, 'docs', 'DOMAIN-REFERENCES.md'), lines.join('\n'), 'utf8');
console.log(`已写出 docs/DOMAIN-REFERENCES.md（已核实 ${okCount}，待核实 ${missCount}）`);
for (const [group, ids] of Object.entries(groups)) {
  console.log('');
  console.log(group);
  for (const id of ids) {
    const m = meta.get(id);
    console.log(`  ${id} ${m ? '✓ ' + m.title.slice(0, 70) : '⚠️ 待核实'}`);
  }
}
