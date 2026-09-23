/**
 * 关系证据候选检索（确定性，不调用模型）。
 *
 * 目的：在论文全文中找出「可能直接陈述两篇论文方法之间关系」的句子，
 * 展示完整候选上下文，用于人工判断：
 *   1) 是否真的存在可直接认证关系的句子；
 *   2) 若存在而流水线没有选中，是候选片段检索的问题（应改进检索），而不是放宽认证标准。
 *
 * 用法：
 *   node scripts/relation-candidates.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'RELATION-CANDIDATES.md');

const index = JSON.parse(await readFile(join(ROOT, 'public/samples/index.json'), 'utf8'));

/**
 * 句子切分：先把全文压成单行（PDF 抽取的换行会把句子切断），
 * 记录归一化位置 → 原文位置 的映射，用于回查页码。
 */
function normalizeWithMap(rawText) {
  let norm = '';
  const map = [];
  let prevSpace = false;
  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i];
    const isSpace = /\s/.test(ch);
    if (isSpace) {
      if (!prevSpace) {
        norm += ' ';
        map.push(i);
      }
      prevSpace = true;
    } else {
      norm += ch;
      map.push(i);
      prevSpace = false;
    }
  }
  return { norm, map };
}

function sentences(rawText) {
  const { norm, map } = normalizeWithMap(rawText);
  const out = [];
  const re = /[^.]{30,700}?\./g;
  let m;
  while ((m = re.exec(norm)) !== null) {
    const text = m[0].trim();
    if (text.length < 50) continue;
    out.push({ text, start: map[m.index] ?? 0 });
  }
  return out;
}

function pageAt(pages, pos) {
  let found;
  for (const p of pages) if (pos >= p.offset) found = p.page;
  return found;
}

const papers = [];
const methods = [];
for (const meta of index.papers) {
  const t = JSON.parse(await readFile(join(ROOT, 'public/samples/text', `${meta.id}.json`), 'utf8'));
  papers.push({ ...meta, pages: t.pages, rawText: t.rawText });
}
for (const m of index.methods) methods.push(m);

const paperById = new Map(papers.map((p) => [p.id, p]));
const methodById = new Map(methods.map((m) => [m.id, m]));

/** 关系措辞（只作为候选筛选线索，不作认证依据） */
const CLAIM_HINTS = [
  /based on/i,
  /builds? (?:up)?on/i,
  /built (?:up)?on/i,
  /extends?/i,
  /extension of/i,
  /distill/i,
  /distilled version/i,
  /improves?|improvement over|improved/i,
  /outperform/i,
  /follow(?:s|ing) the/i,
  /we (?:use|adopt|start from|initialize)/i,
  /unlike|in contrast to/i,
  /a version of/i,
  /teacher model/i,
];

const lines = [
  '# 真实论文中的关系证据候选（确定性检索，未调用模型）',
  '',
  `- 生成时间：${new Date().toLocaleString('zh-CN')}`,
  '- 方法：在论文全文中按「句子含关系措辞」且「句子含被继承方法的方法名（含别名）」检索，展示完整句子与页码。',
  '- 用途：人工判断是否存在足以认证具体关系的句子；这些句子**不等于**已认证的原文明示。',
  '',
];

/** 现有流水线实际送入模型的候选片段（复刻 analyze.ts 的检索方式） */
const pipelineHintWindows = (paper, alias) => {
  const out = [];
  const lower = paper.rawText.toLowerCase();
  const needle = alias.toLowerCase();
  let from = 0;
  let n = 0;
  while (n < 2) {
    const idx = lower.indexOf(needle, from);
    if (idx < 0) break;
    out.push({ start: idx, snippet: paper.rawText.slice(Math.max(0, idx - 420), idx + alias.length + 420).replace(/\s+/g, ' ') });
    from = idx + needle.length;
    n++;
  }
  return out;
};

const pairs = [
  ['BERT: Pre-training', 'RoBERTa'],
  ['BERT: Pre-training', 'DistilBERT'],
  ['Attention Is All You Need', 'BERT: Pre-training'],
  ['BERT: Pre-training', 'Language Models'],
];

for (const [aKw, bKw] of pairs) {
  const ma = methods.find((m) => (paperById.get(m.paperId)?.title ?? '').includes(aKw));
  const mb = methods.find((m) => (paperById.get(m.paperId)?.title ?? '').includes(bKw));
  if (!ma || !mb) continue;
  const pa = paperById.get(ma.paperId);
  const pb = paperById.get(mb.paperId);
  const fromName = ma.fields.methodName.value ?? '';
  // 只要方法名里最“专名”的一段做检索（例如 BERT / Transformer）
  const aliasPool = [fromName, fromName.replace(/[（(].*?[）)]/g, '').trim()].filter(Boolean);
  const shortAlias = aliasPool.sort((x, y) => x.length - y.length)[0] ?? '';

  lines.push(`## ${pa.title.slice(0, 46)} → ${pb.title.slice(0, 46)}`);
  lines.push('');
  lines.push(`- 被继承方法名（抽取值）：${fromName}`);
  lines.push(`- 检索用别名：${shortAlias}`);
  lines.push('');

  const hits = [];
  for (const paper of [pb, pa]) {
    for (const s of sentences(paper.rawText)) {
      const hasAlias = shortAlias && new RegExp(`(^|[^A-Za-z0-9])${shortAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i').test(s.text);
      if (!hasAlias) continue;
      const claim = CLAIM_HINTS.map((re) => re.exec(s.text)?.[0]).find(Boolean);
      if (!claim) continue;
      hits.push({ paperTitle: paper.title, page: pageAt(paper.pages, s.start), text: s.text, claim });
    }
  }

  if (!hits.length) {
    lines.push('**未检索到「含方法名 + 含关系措辞」的句子。**');
  } else {
    lines.push(`### 候选句子（共 ${hits.length} 条；含方法名 + 关系措辞）`);
    lines.push('');
    for (const h of hits.slice(0, 12)) {
      lines.push(`- **【${h.paperTitle.slice(0, 30)} · p.${h.page ?? '?'}】** 命中措辞：\`${h.claim}\``);
      lines.push(`  > ${h.text.slice(0, 420)}`);
    }
  }
  lines.push('');

  // 与现有流水线送入模型的片段对比：候选句子是否落在片段窗口内
  const windows = [];
  for (const paper of [pb, pa]) {
    for (const w of pipelineHintWindows(paper, shortAlias)) windows.push({ paper: paper.title, ...w });
  }
  lines.push('### 与现有流水线候选片段的关系');
  lines.push('');
  const covered = hits.filter((h) => {
    const paper = papers.find((p) => p.title === h.paperTitle);
    if (!paper) return false;
    const pos = paper.rawText.indexOf(h.text.slice(0, 60));
    return windows.some((w) => w.paper === h.paperTitle && pos >= w.start - 420 && pos <= w.start + 460);
  });
  lines.push(`- 现有流水线送入模型的片段：${windows.length} 个窗口（每篇论文在被继承方法名附近取 2 段，前后各 420 字符）。`);
  lines.push(`- 上述候选句子中，落在这些窗口内的：**${covered.length} / ${hits.length}**。`);
  if (hits.length > 0 && covered.length < hits.length) {
    lines.push('- 说明：**有候选句子没有被送入模型**，属于候选片段检索问题，应改进检索（不是放宽认证标准）。');
  }
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('## 判定边界（重要）');
lines.push('');
lines.push('- 本文件的候选句子只说明「原文里有这样的句子」，**不代表**该关系已被认证为原文明示。');
lines.push('- 认证仍要求：句子必须指名被继承方法，并具备对应关系类型的措辞；仅有关键词或引用标记不足以认证。');
lines.push('- 关系类型（继承/改进/组合/相似）必须与句子表达的语义一致，程序不作语义推断。');

await writeFile(OUT, lines.join('\n'), 'utf8');
console.log(`已写出：${OUT}`);
console.log(lines.filter((l) => l.startsWith('- 上述候选') || l.startsWith('**未检索到') || l.startsWith('### 候选句子')).join('\n'));
