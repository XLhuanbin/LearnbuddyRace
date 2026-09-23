/**
 * 关系证据候选检索（确定性，不调用模型）。
 *
 * 背景：实测发现有论文原文里存在可直接认证关系的句子（例如 RoBERTa 论文
 * "our improved training procedure improves upon the published BERT results"），
 * 但模型在「以方法名出现位置为中心的窗口片段」中挑了更弱的句子，
 * 还有一些候选句根本没被送进模型。
 *
 * 因此这里做两件事：
 * 1. 按句子粒度检索「含被继承方法名 + 含关系措辞」的候选，供模型在其中选择；
 * 2. 为评估提供覆盖度信息（候选句是否都进了模型上下文）。
 *
 * 注意：候选句只是「值得看的句子」，不构成认证；认证仍由 assessRelationEvidence 判定。
 */

import type { Paper } from './types';
import { methodAliases } from './rules';

export interface RelationCandidate {
  paperId: string;
  paperTitle: string;
  page?: number;
  text: string;
  /** 命中的关系措辞（仅作为检索线索） */
  claimHint: string;
}

/** 关系措辞线索（检索用；认证另有更严格的标准） */
const CLAIM_HINTS: RegExp[] = [
  /based on/i,
  /builds? (?:up)?on/i,
  /built (?:up)?on/i,
  /extend(?:s|ed|ing)?/i,
  /extension of/i,
  /distill(?:s|ed|ing|ation)?/i,
  /distilled version/i,
  /improve(?:s|d|ment)?/i,
  /improves? upon/i,
  /outperform(?:s|ed|ing)?/i,
  /follow(?:s|ing)? the/i,
  /we (?:adopt|use|start from|initialize)/i,
  /a version of/i,
  /teacher model/i,
  /modifications? to/i,
  /unlike/i,
  /in contrast to/i,
];

/** 把全文压成单行并保留「归一化位置 → 原文位置」的映射（PDF 抽取的换行会切断句子） */
function normalizeWithMap(rawText: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i];
    if (/\s/.test(ch)) {
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

export function pageAt(pages: Paper['pages'], pos: number): number | undefined {
  let found: number | undefined;
  for (const p of pages) if (pos >= p.offset) found = p.page;
  return found;
}

/** 论文中最专名的别名（例如从 "BERT (Bidirectional …)" 取 "BERT"） */
export function primaryAlias(methodName?: string): string {
  const aliases = methodAliases(methodName);
  if (!aliases.length) return '';
  return [...aliases].sort((a, b) => a.length - b.length)[0];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 在论文全文中检索关系候选句。
 * @param alias 被继承方法的别名（不区分大小写、按词边界匹配）
 */
export interface SentenceCandidate {
  paperId: string;
  paperTitle: string;
  page?: number;
  text: string;
}

/**
 * 通用句子候选检索（确定性，不调用模型）。
 * @param filter 只保留匹配该正则的句子
 */
export function findSentenceCandidates(paper: Paper, filter: RegExp, limit = 200): SentenceCandidate[] {
  if (!paper.rawText) return [];
  const { norm, map } = normalizeWithMap(paper.rawText);
  const out: SentenceCandidate[] = [];
  const re = /[^.]{30,700}?\./g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const text = m[0].trim().replace(/\s+/g, ' ');
    if (text.length < 50) continue;
    if (!filter.test(text)) continue;
    out.push({ paperId: paper.id, paperTitle: paper.title, page: pageAt(paper.pages, map[m.index] ?? 0), text });
    if (out.length >= limit) break;
  }
  return out;
}

export function findRelationCandidates(paper: Paper, alias: string, limit = 12): RelationCandidate[] {
  if (!alias || alias.length < 3) return [];
  const aliasRe = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(alias)}([^A-Za-z0-9]|$)`, 'i');
  const out: RelationCandidate[] = [];
  for (const c of findSentenceCandidates(paper, aliasRe, 400)) {
    const claimHint = CLAIM_HINTS.map((r) => r.exec(c.text)?.[0]).find(Boolean);
    if (!claimHint) continue;
    out.push({ ...c, claimHint });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 为「A 的方法关系」构造提示用的候选片段文本。
 * 优先给出候选句子（含页码），再附上方法名附近的原文窗口，供模型对照上下文。
 */
export function buildRelationHints(
  papers: Paper[],
  methods: { id: string; paperId: string; methodName?: string }[],
  budget = 12000,
): { text: string; candidateCount: number } {
  const paperById = new Map(papers.map((p) => [p.id, p]));
  const blocks: string[] = [];
  let used = 0;
  let candidateCount = 0;

  const push = (s: string) => {
    if (used + s.length > budget) return false;
    used += s.length;
    blocks.push(s);
    return true;
  };

  for (const target of methods) {
    const targetPaper = paperById.get(target.paperId);
    if (!targetPaper) continue;
    for (const other of methods) {
      if (other.id === target.id) continue;
      const alias = primaryAlias(other.methodName);
      if (!alias || alias.length < 4) continue;

      // 关系陈述通常写在「新方法」的论文里，因此优先检索 target 的论文
      const primary = findRelationCandidates(targetPaper, alias, 8);
      const secondary = findRelationCandidates(paperById.get(other.paperId)!, alias, 3).filter(
        (c) => c.paperId !== targetPaper.id,
      );
      const cands = [...primary, ...secondary];
      if (!cands.length) continue;

      const header =
        `\n=== 关系候选：${other.methodName ?? other.id} → ${targetPaper.title} ===\n` +
        `下面是从论文全文中检索到的「同时含被继承方法「${alias}」与关系措辞」的句子。\n` +
        `如果你要声明 evidenceState=explicit，请**优先从这些句子中挑选**（可逐字复制整句或其中连续片段），并给出页码。\n` +
        `注意：句子中出现方法名并不等于它就在陈述你要判断的那个关系，请按语义判断；找不到合适的句子就如实说明。\n`;
      if (!push(header)) continue;

      candidateCount += cands.length;
      for (const c of cands) {
        push(`[PAPER: "${c.paperTitle}" | paperId=${c.paperId} | p.${c.page ?? '?'}]\n${c.text}\n`);
      }

      // 附一段方法名附近的窗口，便于模型看到上下文（保持与旧版行为一致的可追溯性）
      const lower = targetPaper.rawText.toLowerCase();
      const idx = lower.indexOf(alias.toLowerCase());
      if (idx >= 0) {
        const s = Math.max(0, idx - 400);
        const e = Math.min(targetPaper.rawText.length, idx + alias.length + 400);
        push(`[上下文窗口 | "${targetPaper.title}" | p.${pageAt(targetPaper.pages, idx) ?? '?'}]\n...${targetPaper.rawText.slice(s, e).replace(/\s+/g, ' ')}...\n`);
      }
    }
  }

  return { text: blocks.join('\n'), candidateCount };
}
