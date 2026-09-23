/**
 * 文本归一化与证据定位。
 *
 * 这是本项目可信度的关键环节：模型给出的引文必须能在论文全文中真实定位到，
 * 定位不到就标记为「证据未通过校验」，绝不保留看似准确的假引文。
 *
 * 两级匹配：
 *  - strict: 小写 + 空白归一 + 破折号/引号统一（保留连字符）
 *  - loose : 进一步去掉所有非字母数字字符（保留 CJK），用于兜底定位
 * 两级都通过 norm -> raw 的索引映射数组回到原文位置，从而得到页码与上下文。
 */

export interface NormalizedText {
  out: string;
  /** map[i] = 归一化串第 i 个字符在原文中的下标 */
  map: number[];
}

const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/;
const QUOTES = /[\u2018\u2019\u201A\u201C\u201D\u201E\u0060\u00B4]/;

function isCJK(ch: string): boolean {
  const c = ch.codePointAt(0) || 0;
  return (
    (c >= 0x3040 && c <= 0x30ff) || // 日文假名
    (c >= 0x3400 && c <= 0x4dbf) || // 扩展A
    (c >= 0x4e00 && c <= 0x9fff) || // 基本汉字
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xac00 && c <= 0xd7af) // 韩文
  );
}

function isAlnum(ch: string): boolean {
  return /[0-9a-z]/.test(ch) || isCJK(ch);
}

/**
 * 归一化文本，同时维护到原文的字符映射。
 * @param loose 是否去掉所有非字母数字字符
 */
export function normalize(text: string, loose: boolean): NormalizedText {
  const out: string[] = [];
  const map: number[] = [];
  const lower = text.toLowerCase();
  let i = 0;
  const n = lower.length;

  while (i < n) {
    const ch = lower[i];

    // 换行处连字符断词： "architec-\nture" -> "architecture"
    if (!loose && ch === '-' && i + 1 < n) {
      let j = i + 1;
      while (j < n && (lower[j] === ' ' || lower[j] === '\t')) j++;
      if (j < n && (lower[j] === '\n' || lower[j] === '\r')) {
        // 丢弃连字符、行尾空白与换行本身，让前后词直接相连
        while (j < n && /\s/.test(lower[j])) j++;
        i = j;
        continue;
      }
    }

    // 空白折叠为一个空格（loose 模式直接丢弃）
    if (/\s/.test(ch)) {
      let j = i;
      while (j + 1 < n && /\s/.test(lower[j + 1])) j++;
      if (!loose) {
        if (out.length > 0 && out[out.length - 1] !== ' ') {
          out.push(' ');
          map.push(i);
        }
      }
      i = j + 1;
      continue;
    }

    let emit: string | null = null;
    if (DASHES.test(ch)) {
      emit = loose ? null : '-';
    } else if (QUOTES.test(ch)) {
      emit = loose ? null : "'";
    } else if (loose && !isAlnum(ch)) {
      emit = null;
    } else if (!loose && /[\u00a0\u2007\u202f]/.test(ch)) {
      emit = ' ';
    } else {
      emit = ch;
    }

    if (emit !== null) {
      out.push(emit);
      map.push(i);
    }
    i += 1;
  }

  // 去掉首尾空格，保持映射一致
  let s = 0;
  while (s < out.length && out[s] === ' ') s++;
  let e = out.length;
  while (e > s && out[e - 1] === ' ') e--;
  return { out: out.slice(s, e).join(''), map: map.slice(s, e) };
}

export interface LocateResult {
  start: number;
  end: number;
  /**
   * strict  = 归一化后原文精确匹配
   * loose   = 忽略标点/连字符后匹配（几乎全文覆盖）
   * partial = 只有引文前段能在原文中找到，尾部很可能被改写 —— 调用方必须当作「未通过校验」
   */
  matchType: 'strict' | 'loose' | 'partial';
  /** 归一化后匹配到的引文长度 */
  matchedLength: number;
  /** 匹配部分占整个引文的比例（partial 时用于说明） */
  coverage: number;
}

/** 允许的「尾部缺失」比例：低于该覆盖率即判定为 partial（不可信） */
const MIN_COVERAGE = 0.9;

/**
 * 在原文中定位引文。定位不到返回 null —— 调用方必须据此标记证据缺失。
 */
export function locateQuote(rawText: string, quote: string): LocateResult | null {
  const q = quote.trim();
  if (!q || !rawText) return null;

  // 1) strict
  const rawStrict = normalize(rawText, false);
  const qStrict = normalize(q, false);
  if (qStrict.out.length >= 8) {
    const idx = rawStrict.out.indexOf(qStrict.out);
    if (idx >= 0) {
      const start = rawStrict.map[idx];
      const end = rawStrict.map[idx + qStrict.out.length - 1] + 1;
      return { start, end, matchType: 'strict', matchedLength: qStrict.out.length, coverage: 1 };
    }
  }

  // 2) loose 兜底
  const rawLoose = normalize(rawText, true);
  const qLoose = normalize(q, true);
  if (qLoose.out.length >= 8) {
    const idx = rawLoose.out.indexOf(qLoose.out);
    if (idx >= 0) {
      const start = rawLoose.map[idx];
      const end = rawLoose.map[idx + qLoose.out.length - 1] + 1;
      return { start, end, matchType: 'loose', matchedLength: qLoose.out.length, coverage: 1 };
    }

    // 2b) 引文含省略号或被截断时，取前 60 个字符再试。
    // 覆盖率不足 90% 时只返回 partial —— 意味着引文尾部很可能是模型改写的内容，
    // 这种情况必须被上层判定为「未通过校验」，不能当作有效证据。
    const head = qLoose.out.slice(0, 60);
    if (head.length >= 20) {
      const idx2 = rawLoose.out.indexOf(head);
      if (idx2 >= 0) {
        const start = rawLoose.map[idx2];
        const end = rawLoose.map[idx2 + head.length - 1] + 1;
        const coverage = head.length / qLoose.out.length;
        return {
          start,
          end,
          matchType: coverage >= MIN_COVERAGE ? 'loose' : 'partial',
          matchedLength: head.length,
          coverage,
        };
      }
    }
  }

  return null;
}

/** 在原文中抽取一段上下文，用于「点击证据查看上下文」 */
export function contextAround(rawText: string, start: number, end: number, pad = 420) {
  const s = Math.max(0, start - pad);
  const e = Math.min(rawText.length, end + pad);
  return {
    before: rawText.slice(s, start),
    quote: rawText.slice(start, end),
    after: rawText.slice(end, e),
  };
}

/** 章节启发式识别：在引文之前最近的、形如标题的行 */
const HEADING_RE =
  /^\s*(?:\d+(?:\.\d+)*\.?\s+)?(abstract|introduction|related work|background|method(?:s|ology)?|approach|model(?: architecture)?|experiments?|results?|discussion|conclusion|limitations?|future work|appendix|摘要|引言|相关工作|方法|实验|结果|讨论|结论|局限)\b/i;

export function guessSection(rawText: string, pos: number): string | undefined {
  const window = rawText.slice(Math.max(0, pos - 6000), pos);
  const lines = window.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.length === 0 || line.length > 60) continue;
    const m = HEADING_RE.exec(line);
    if (m) return line.replace(/\s+/g, ' ').slice(0, 60);
  }
  return undefined;
}

/** 由 rawText 中的位置反查页码 */
export function pageAt(pages: { page: number; offset: number; text: string }[], pos: number): number | undefined {
  let found: number | undefined;
  for (const p of pages) {
    if (pos >= p.offset) found = p.page;
    else break;
  }
  return found;
}

/**
 * 在 rawText 中查找 needle，且要求至少有一次出现落在 aroundPos 附近（±radius）。
 *
 * 用途：核查表格语境 —— 表格的「行标签 / 表题」通常就在被引用数值附近。
 * 与 locateQuote 的区别：允许较短的字符串（如 "Swin-T"），但要求位置接近，
 * 避免「整篇论文里随便出现过一次」就当作表格语境成立。
 */
export function locateNear(
  rawText: string,
  needle: string,
  aroundPos: number,
  radius = 1500,
): { found: boolean; near: boolean; distance?: number; matchType: 'strict' | 'loose' | 'none' } {
  const q = (needle ?? '').trim();
  if (!q || q.length < 2) return { found: false, near: false, matchType: 'none' };

  for (const loose of [false, true]) {
    const raw = normalize(rawText, loose);
    const nq = normalize(q, loose);
    if (!nq.out) continue;
    let idx = raw.out.indexOf(nq.out);
    if (idx < 0) continue;
    let best = Number.POSITIVE_INFINITY;
    while (idx >= 0) {
      const pos = raw.map[idx];
      best = Math.min(best, Math.abs(pos - aroundPos));
      idx = raw.out.indexOf(nq.out, idx + 1);
    }
    return { found: true, near: best <= radius, distance: best, matchType: loose ? 'loose' : 'strict' };
  }
  return { found: false, near: false, matchType: 'none' };
}
