/**
 * 领域候选的「方法关系线索」预检（确定性，只用 arXiv 摘要，不调用模型）。
 *
 * 目的：为正式领域候选提供**基于文本的证据线索**，说明该领域是否可能找到
 * 「指名被继承方法 + 关系措辞」的句子（本项目认证原文明示的必要条件），
 * 而不是凭印象断言。结果只是线索，不等于已认证。
 *
 * 用法：node scripts/domain-relation-probe.mjs
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const groups = {
  '候选一：三维点云语义分割': ['1612.00593', '1706.02413', '1801.07829', '1904.08889', '1911.11236', '2012.09164', '2206.04670', '2003.00492'],
  '候选二：低资源视觉表征与轻量模型': ['2002.05709', '1911.05722', '2110.02178', '1905.11946', '2010.11929'],
  '候选三：检索增强生成的长文档问答': ['2005.11401', '2007.01282', '2002.08909', '2112.04426', '2310.11511'],
};

/** 方法名别名（用于在摘要中检索；只做线索筛选） */
const alias = {
  '1612.00593': ['PointNet'],
  '1706.02413': ['PointNet', 'PointNet++'],
  '1801.07829': ['PointNet', 'DGCNN', 'EdgeConv'],
  '1904.08889': ['PointNet', 'PointNet++', 'DGCNN', 'KPConv'],
  '1911.11236': ['PointNet', 'PointNet++', 'RandLA-Net'],
  '2012.09164': ['PointNet', 'PointNet++', 'Point Transformer'],
  '2206.04670': ['PointNet', 'PointNet++', 'PointNeXt'],
  '2003.00492': ['PointNet', 'PointNet++', 'PointASNL'],
  '2002.05709': ['SimCLR', 'contrastive learning'],
  '1911.05722': ['MoCo', 'contrastive learning'],
  '2110.02178': ['MobileViT', 'ViT', 'MobileNet'],
  '1905.11946': ['EfficientNet', 'compound scaling'],
  '2010.11929': ['ViT', 'Transformer'],
  '2005.11401': ['RAG', 'retrieval-augmented'],
  '2007.01282': ['FiD', 'Fusion-in-Decoder', 'retrieval'],
  '2002.08909': ['REALM', 'retrieval'],
  '2112.04426': ['RETRO', 'retrieval'],
  '2310.11511': ['Self-RAG', 'RAG', 'retrieval'],
};

const CLAIM = [
  /based on/i,
  /builds? (?:up)?on/i,
  /built (?:up)?on/i,
  /extend(?:s|ed|ing)?/i,
  /improv(?:e|es|ed|ement)/i,
  /outperform(?:s|ed)?/i,
  /better than/i,
  /follow(?:s|ing)? the/i,
  /inspired by/i,
  /unlike/i,
  /in contrast to/i,
  /variant of/i,
  /a version of/i,
];

const all = [...new Set(Object.values(groups).flat())];
const url = `http://export.arxiv.org/api/query?id_list=${all.join(',')}&max_results=${all.length}`;
console.log(`读取 ${all.length} 篇论文的摘要 …`);
const xml = await (await fetch(url, { headers: { 'User-Agent': 'ResearchPilot-dev-probe/1.0' } })).text();
const meta = new Map();
for (const e of [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1])) {
  const id = (/([\d.]+v?\d*)$/.exec((/<id>([\s\S]*?)<\/id>/.exec(e) || [])[1] ?? '') || [])[1]?.replace(/v\d+$/, '') ?? '';
  const title = ((/<title>([\s\S]*?)<\/title>/.exec(e) || [])[1] ?? '').replace(/\s+/g, ' ').trim();
  const summary = ((/<summary>([\s\S]*?)<\/summary>/.exec(e) || [])[1] ?? '').replace(/\s+/g, ' ').trim();
  meta.set(id, { title, summary });
}

const lines = [
  '# 领域候选：方法关系线索预检（只用摘要，确定性）',
  '',
  `- 生成时间：${new Date().toLocaleString('zh-CN')}`,
  '- 方法：在每篇论文的 arXiv 摘要中检索「同领域其它方法名 + 关系措辞」的同现。',
  '- 说明：**这只是线索**。本项目认证「原文明示」还要求句子指名被继承方法、具备对应关系措辞、并指向关系两端，',
  '  且必须用全文（不是摘要）定位。因此下列结果只说明「值得进一步核实」，不代表已认证。',
  '',
];

for (const [group, ids] of Object.entries(groups)) {
  lines.push(`## ${group}`, '');
  let totalHits = 0;
  for (const id of ids) {
    const m = meta.get(id);
    if (!m) {
      lines.push(`- arXiv:${id}：⚠️ 未取到摘要`);
      continue;
    }
    const self = alias[id] ?? [];
    const others = [...new Set(ids.filter((x) => x !== id).flatMap((x) => alias[x] ?? []))].filter(
      (a) => !self.some((s) => s.toLowerCase() === a.toLowerCase()),
    );
    const hits = [];
    for (const other of others) {
      const re = new RegExp(`(^|[^A-Za-z0-9])${other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i');
      if (!re.test(m.summary)) continue;
      const claim = CLAIM.map((r) => r.exec(m.summary)?.[0]).find(Boolean);
      if (!claim) continue;
      const idx = m.summary.search(re);
      hits.push({ other, claim, snippet: m.summary.slice(Math.max(0, idx - 110), idx + other.length + 110) });
    }
    totalHits += hits.length;
    lines.push(`### arXiv:${id}　${m.title.slice(0, 70)}`);
    if (!hits.length) {
      lines.push('- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）');
    } else {
      for (const h of hits.slice(0, 4)) {
        lines.push("- 提到「" + h.other + "」，命中措辞 [" + h.claim + "]：");
        lines.push(`  > …${h.snippet.replace(/\s+/g, ' ')}…`);
      }
    }
    lines.push('');
  }
  lines.push(`小结：本组摘要中命中 ${totalHits} 处「方法名 + 关系措辞」同现。`);
  lines.push('');
}

lines.push('---', '');
lines.push('## 判定边界');
lines.push('');
lines.push('- 摘要同现只是「线索」：摘要通常只有一两句，真正的继承关系陈述往往在方法或实验章节。');
lines.push('- 是否成立要看全文，并由项目的 `assessRelationEvidence` 逐条判定（第三方主语、是否指名、是否指向关系两端）。');
lines.push('- 本文件不构成任何「论文关系已确认」的结论。');

await writeFile(join(ROOT, 'docs', 'DOMAIN-RELATION-PROBE.md'), lines.join('\n'), 'utf8');
console.log('已写出 docs/DOMAIN-RELATION-PROBE.md');
for (const [group, ids] of Object.entries(groups)) {
  console.log('');
  console.log(group);
  for (const id of ids) {
    const m = meta.get(id);
    const self = alias[id] ?? [];
    const others = [...new Set(ids.filter((x) => x !== id).flatMap((x) => alias[x] ?? []))].filter(
      (a) => !self.some((s) => s.toLowerCase() === a.toLowerCase()),
    );
    let n = 0;
    for (const other of others) {
      const re = new RegExp(`(^|[^A-Za-z0-9])${other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i');
      if (re.test(m?.summary ?? '') && CLAIM.some((r) => r.test(m?.summary ?? ''))) n++;
    }
    console.log(`  ${id} ${m ? '✓' : '⚠️'} 线索命中 ${n}`);
  }
}
