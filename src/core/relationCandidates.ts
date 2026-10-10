/**
 * 关系证据候选检索（确定性，不调用模型）。
 *
 * 背景：实测发现论文原文里存在可直接认证关系的句子（例如 DeiT 论文
 * "our work builds upon the ViT model [15]"、ConvNeXt 论文
 * "Our starting point is a ResNet-50 model"），但旧版检索三个问题导致它们根本没进模型上下文：
 *   1. 只取「最短别名」：ViT 的最短别名 "ViT" 又被长度 <4 的门槛整条丢弃 ⇒ ViT→DeiT / ViT→Swin 零候选；
 *   2. 别名派生漏掉驼峰专名（"DeiT" 不是全大写）⇒ DeiT 相关句子检索不到；
 *   3. 候选只按出现顺序取前 N 条，Related Work 里的引用句与正文里的性能对比句同权 ⇒ 好句子被挤掉。
 *
 * 因此这里做三件事：
 * 1. 用**全部**可用别名检索（不再只取最短），并按「引用句 / Related Work 章节 / 措辞强度」打分排序；
 * 2. 候选带上章节名与引用标记，让模型能看出这句话出自 related work；
 * 3. 为评估提供覆盖度信息（候选句是否都进了模型上下文）。
 *
 * 注意：候选句只是「值得看的句子」，不构成认证；认证仍由 assessRelationEvidence 判定。
 */

import type { Paper } from './types';
import { isGenericAlias, methodAliases, findCitationMarker } from './rules';
import { escapeRe, guessSection, pageAt } from './text';

export interface RelationCandidate {
  paperId: string;
  paperTitle: string;
  page?: number;
  text: string;
  /** 命中的关系措辞（仅作为检索线索） */
  claimHint: string;
  /** 命中该候选的方法别名（可能有多个别名命中同一句，取最长的那个） */
  alias?: string;
  /** 句子所在章节（引自 guessSection，可能为空） */
  section?: string;
  /** 句子是否带引用标记，例如 [15] / (Devlin et al., 2019) */
  citation?: string;
  /** 排序得分，越大越可能是「直接陈述关系」的句子 */
  score?: number;
}

/**
 * 关系措辞线索（检索用；认证另有更严格的标准，见 rules.ts#CLAIM_PATTERNS）。
 * 分两档：强措辞（直接说出关系）/ 弱措辞（只是比较或提及）。
 */
const STRONG_CLAIMS: RegExp[] = [
  /based on/i,
  /builds? (?:up)?on/i,
  /built (?:up)?on/i,
  /extend(?:s|ed|ing)?/i,
  /extension of/i,
  /start(?:ing)? point/i,
  /go(?:es|ing)? from/i,
  /adapt(?:s|ed|ing)? (?:from|to)/i,
  /inspired by/i,
  /motivated by/i,
  /distilled version/i,
  /distill(?:s|ed|ing|ation)?/i,
  /moder?niz(?:e|es|ed|ing|ation)/i,
  /most related/i,
  /related to our work/i,
  /follow(?:s|ing)? the/i,
  /we (?:adopt|use|start from|begin|initialize)/i,
  /teacher model/i,
  /a version of/i,
  /modifications? to/i,
];

const WEAK_CLAIMS: RegExp[] = [
  /improv(?:e|es|ed|ement|ing)/i,
  /improves? upon/i,
  /outperform(?:s|ed|ing)?/i,
  /counterpart/i,
  /identical to/i,
  /unlike/i,
  /in contrast to/i,
  /compared to/i,
  /reference (?:vision )?transformer/i,
];

const ALL_CLAIMS: { re: RegExp; weight: number }[] = [
  ...STRONG_CLAIMS.map((re) => ({ re, weight: 3 })),
  ...WEAK_CLAIMS.map((re) => ({ re, weight: 1 })),
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

// pageAt 统一在 text.ts（此前这里有一份行为相同的副本）

/**
 * 检索用的可用别名集合。
 *
 * 与旧版「只取最短别名」的区别：全部别名都要用。实测 "Vision Transformer (ViT)" 若只用
 * "ViT"，会漏掉论文里大量写全 "Vision Transformer" 的句子；而只取最短再叠加长度门槛，
 * 又会因为 "ViT" 只有 3 个字符被整条丢掉。
 *
 * 过滤条件与认证侧保持一致：非泛化词、长度 ≥ 3（rules.ts#findAliasInText 的下限）。
 * 长别名排在前面：匹配时优先用更专的写法，避免 "Transformer" 这类短别名抢命中。
 */
export function usableAliases(rawName?: string): string[] {
  return [...new Set(methodAliases(rawName).filter((a) => !isGenericAlias(a) && a.length >= 3))].sort(
    (a, b) => b.length - a.length,
  );
}

/** 论文中最专名的别名（例如从 "BERT (Bidirectional …)" 取 "BERT"）—— 仅用于展示 */
export function primaryAlias(methodName?: string): string {
  const aliases = usableAliases(methodName);
  if (!aliases.length) return '';
  return aliases[aliases.length - 1];
}

// escapeRe 统一在 text.ts（此前这里与 rules.ts 各有一份相同副本）

/**
 * 在论文全文中检索关系候选句。
 * @param alias 被继承方法的别名（不区分大小写、按词边界匹配）
 */
export interface SentenceCandidate {
  paperId: string;
  paperTitle: string;
  page?: number;
  text: string;
  /** 归一化前的位置，用于反查章节 */
  start?: number;
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
    const start = map[m.index] ?? 0;
    out.push({
      paperId: paper.id,
      paperTitle: paper.title,
      page: pageAt(paper.pages, start),
      text,
      start,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** 章节加权：关系表述集中在 related work / 引言，其次方法章节 */
function sectionWeight(section?: string): number {
  if (!section) return 0;
  if (/related|相关|prior work|以前的工作/i.test(section)) return 3;
  if (/introduction|引言|简介|背景/i.test(section)) return 2;
  if (/method|approach|方法|model|architect/i.test(section)) return 1;
  return 0;
}

/**
 * 在论文全文中检索关系候选句，并按「是否直接陈述关系」排序。
 * @param aliasOrAliases 被继承方法的一个或多个别名
 */
export function findRelationCandidates(
  paper: Paper,
  aliasOrAliases: string | string[],
  limit = 12,
): RelationCandidate[] {
  const aliases = (Array.isArray(aliasOrAliases) ? aliasOrAliases : [aliasOrAliases])
    .filter((a) => typeof a === 'string' && a.length >= 3)
    .sort((a, b) => b.length - a.length);
  if (!aliases.length) return [];

  const byText = new Map<string, RelationCandidate>();
  for (const alias of aliases) {
    const aliasRe = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(alias)}([^A-Za-z0-9]|$)`, 'i');
    for (const c of findSentenceCandidates(paper, aliasRe, 400)) {
      const hit = ALL_CLAIMS.map(({ re, weight }) => {
        const m = re.exec(c.text);
        return m ? { claimHint: m[0], weight } : undefined;
      })
        .filter(Boolean)
        .sort((a, b) => b!.weight - a!.weight)[0];
      if (!hit) continue;

      const section = guessSection(paper.rawText, c.start ?? 0);
      const citation = findCitationMarker(c.text);
      const score = hit.weight + sectionWeight(section) + (citation ? 3 : 0);

      const prev = byText.get(c.text);
      // 同一句可能被多个别名命中：保留得分最高的那次（别名取更长的，便于阅读）
      if (!prev || (prev.score ?? 0) < score) {
        byText.set(c.text, {
          paperId: paper.id,
          paperTitle: paper.title,
          page: c.page,
          text: c.text,
          claimHint: hit.claimHint,
          alias,
          section,
          citation,
          score,
        });
      }
    }
  }

  return [...byText.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
}

/**
 * 为「A 的方法关系」构造提示用的候选片段文本。
 *
 * 与旧版的关键区别：**先全局打分、再按预算填充**。
 * 旧版是「逐对顺序输出、超出预算就截断」，排在后面的方法对可能一条候选都拿不到；
 * 现在把所有候选按分数排序后统一分配预算，保证「最像关系陈述的句子」一定进上下文。
 */
export function buildRelationHints(
  papers: Paper[],
  methods: { id: string; paperId: string; methodName?: string }[],
  budget = 16000,
): { text: string; candidateCount: number } {
  const paperById = new Map(papers.map((p) => [p.id, p]));

  /** 先收集全部候选，按 pair 分组 */
  const groups: {
    targetLabel: string;
    aliasLabel: string;
    header: string;
    cands: RelationCandidate[];
  }[] = [];

  for (const target of methods) {
    const targetPaper = paperById.get(target.paperId);
    if (!targetPaper) continue;
    for (const other of methods) {
      if (other.id === target.id) continue;
      const aliases = usableAliases(other.methodName);
      if (!aliases.length) continue;

      // 关系陈述通常写在「新方法」的论文里，因此优先检索 target 的论文
      const primary = findRelationCandidates(targetPaper, aliases, 8);
      const otherPaper = paperById.get(other.paperId);
      const secondary = otherPaper ? findRelationCandidates(otherPaper, aliases, 3) : [];
      const merged = new Map<string, RelationCandidate>();
      for (const c of [...primary, ...secondary]) {
        const prev = merged.get(c.text);
        if (!prev || (prev.score ?? 0) < (c.score ?? 0)) merged.set(c.text, c);
      }
      const cands = [...merged.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      if (!cands.length) continue;

      groups.push({
        targetLabel: `${other.methodName ?? other.id} → ${targetPaper.title}`,
        aliasLabel: aliases.join(' / '),
        header:
          `\n=== 关系候选：${other.methodName ?? other.id} → ${targetPaper.title} ===\n` +
          `下面是按「直接陈述关系」的可能性排序的原文句子（检索别名：${aliases.join(' / ')}）。\n` +
          `如果你要声明 evidenceState=explicit，请**优先从这些句子中挑选**（可逐字复制整句或其中连续片段），并给出页码。\n` +
          `注意：句子中出现方法名并不等于它就在陈述你要判断的那个关系，请按语义判断；找不到合适的句子就如实说明。\n`,
        cands,
      });
    }
  }

  // 按每组最高分降序，保证强候选优先占用预算
  groups.sort((a, b) => (b.cands[0]?.score ?? 0) - (a.cands[0]?.score ?? 0));

  const blocks: string[] = [];
  let used = 0;
  let candidateCount = 0;
  const push = (s: string) => {
    if (used + s.length > budget) return false;
    used += s.length;
    blocks.push(s);
    return true;
  };

  for (const g of groups) {
    // 只在真的写出了至少一条候选时才输出表头，避免占预算却无内容
    const before = blocks.length;
    if (!push(g.header)) continue;
    let wrote = 0;
    for (const c of g.cands) {
      const meta = [
        `p.${c.page ?? '?'}`,
        c.section ? `章节：${c.section}` : undefined,
        c.citation ? `含引用标记 ${c.citation}` : undefined,
        `命中措辞：${c.claimHint}`,
      ]
        .filter(Boolean)
        .join(' | ');
      if (!push(`[PAPER: "${c.paperTitle}" | paperId=${c.paperId} | ${meta}]\n${c.text}\n`)) break;
      wrote++;
      candidateCount++;
    }
    if (!wrote) {
      // 预算不够写任何一条：把表头也撤掉，别留空标题
      if (blocks.length > before) blocks.length = before;
      continue;
    }
    // 附一段候选句在原文中的前后窗口，便于模型对照上下文（预算不足时静默跳过）
    const top = g.cands[0];
    const tp = paperById.get(top.paperId);
    if (tp?.rawText) {
      const idx = tp.rawText.indexOf(top.text.slice(0, 60));
      if (idx >= 0) {
        const s = Math.max(0, idx - 300);
        const e = Math.min(tp.rawText.length, idx + top.text.length + 300);
        push(
          `[上下文窗口 | "${tp.title}" | p.${pageAt(tp.pages, idx) ?? '?'}]\n...${tp.rawText.slice(s, e).replace(/\s+/g, ' ')}...\n`,
        );
      }
    }
  }

  return { text: blocks.join('\n'), candidateCount };
}
