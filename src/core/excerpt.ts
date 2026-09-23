/**
 * 输入摘录策略：论文全文可能远超上下文预算，需按章节优先级裁剪。
 * 只做「截取」，不做改写，确保送给模型的仍是原文，引用才能回到原文。
 */

const SECTION_PATTERNS: { name: string; re: RegExp; weight: number }[] = [
  { name: 'abstract', re: /^\s*(?:\d+\.?\s*)?abstract\b/i, weight: 100 },
  { name: 'introduction', re: /^\s*(?:\d+\.?\s*)?introduction\b/i, weight: 70 },
  { name: 'related work', re: /^\s*(?:\d+\.?\s*)?(related work|background)\b/i, weight: 45 },
  { name: 'method', re: /^\s*(?:\d+\.?\s*)?(method|methods|methodology|approach|model|architecture|proposed)\b/i, weight: 95 },
  { name: 'experiments', re: /^\s*(?:\d+\.?\s*)?(experiments?|experimental setup|evaluation|results?|analysis|ablation)\b/i, weight: 90 },
  { name: 'discussion', re: /^\s*(?:\d+\.?\s*)?(discussion|limitations?|conclusion|future work)\b/i, weight: 80 },
];

interface Block {
  name: string;
  weight: number;
  text: string;
  start: number;
}

/** 按「看起来像章节标题」的短行切分全文 */
export function splitSections(rawText: string): Block[] {
  const lines = rawText.split('\n');
  const heads: { idx: number; name: string; weight: number; charPos: number }[] = [];
  let pos = 0;
  lines.forEach((line, i) => {
    const charPos = pos;
    pos += line.length + 1;
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > 60) return;
    for (const sp of SECTION_PATTERNS) {
      if (sp.re.test(trimmed)) {
        heads.push({ idx: i, name: sp.name, weight: sp.weight, charPos });
        break;
      }
    }
  });

  if (heads.length === 0) {
    return [{ name: 'full', weight: 50, text: rawText, start: 0 }];
  }

  const blocks: Block[] = [];
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].charPos : rawText.length;
    blocks.push({ name: h.name, weight: h.weight, text: rawText.slice(h.charPos, end), start: h.charPos });
  });
  return blocks;
}

export interface ExcerptResult {
  text: string;
  usedSections: string[];
  /** true = 只送了部分片段（不是全文），用于让模型区分「未提取到」与「论文未报告」 */
  excerpted: boolean;
  /** 送入模型的原文字符数 */
  chars: number;
  /** 原文总字符数 */
  totalChars: number;
}

/** 在片段中的页码边界插入 [[p.N]] 标记，使模型能报告页码，且该页码可被程序校验 */
function injectPageMarkers(text: string, startOffset: number, pages: { page: number; offset: number }[]): string {
  const marks = pages.filter((p) => p.offset > startOffset && p.offset < startOffset + text.length);
  if (!marks.length) return text;
  let out = '';
  let cursor = 0;
  for (const m of marks) {
    const rel = m.offset - startOffset;
    out += text.slice(cursor, rel) + `\n[[p.${m.page}]]\n`;
    cursor = rel;
  }
  out += text.slice(cursor);
  return out;
}

/**
 * 在字符预算内挑选最相关的原文片段。
 * 若提供 pages，会在页码边界插入 [[p.N]] 标记，便于模型给出可校验的页码。
 */
export function selectExcerpt(
  rawText: string,
  budget = 24000,
  pages?: { page: number; offset: number }[],
): ExcerptResult {
  const blocks = splitSections(rawText);
  if (blocks.length === 1 && blocks[0].text.length <= budget) {
    const head = blocks[0].start;
    return {
      text: pages ? injectPageMarkers(blocks[0].text, head, pages) : blocks[0].text,
      usedSections: ['full'],
      excerpted: false,
      chars: blocks[0].text.length,
      totalChars: rawText.length,
    };
  }

  // 每个区块留出配额：按权重排序后依次填充，单块不超过 40% 预算
  const perBlockCap = Math.max(3000, Math.floor(budget * 0.4));
  const ordered = [...blocks].sort((a, b) => b.weight - a.weight);
  const picked: Block[] = [];
  let used = 0;
  for (const b of ordered) {
    if (used >= budget) break;
    const room = Math.min(perBlockCap, budget - used);
    if (room < 800) break;
    picked.push({ ...b, text: b.text.slice(0, room) });
    used += Math.min(b.text.length, room);
  }

  // 按原文顺序拼接，保持可读
  picked.sort((a, b) => a.start - b.start);
  const text = picked
    .map((b) => `\n===== [${b.name}] =====\n${pages ? injectPageMarkers(b.text, b.start, pages) : b.text}`)
    .join('\n');
  return {
    text,
    usedSections: picked.map((b) => b.name),
    excerpted: text.length < rawText.length,
    chars: text.length,
    totalChars: rawText.length,
  };
}
