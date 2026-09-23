/**
 * 页面文本装配与元信息启发式识别（浏览器与 Node 脚本共用，纯函数）。
 */

import type { PageText } from '../types';

export interface AssembleResult {
  pages: PageText[];
  rawText: string;
  charCount: number;
}

/** 清洗单页文本：统一换行、压缩多余空行，但保留换行结构用于定位与展示 */
export function cleanPageText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function assemblePages(pageTexts: string[]): AssembleResult {
  const pages: PageText[] = [];
  let raw = '';
  pageTexts.forEach((t, i) => {
    const text = cleanPageText(t || '');
    pages.push({ page: i + 1, text, offset: raw.length });
    raw += text;
    // 页间用换行分隔，避免相邻页末尾词与下一页首词粘连
    if (i < pageTexts.length - 1) raw += '\n';
  });
  return { pages, rawText: raw, charCount: raw.length };
}

export interface PdfMetaGuess {
  title?: string;
  authors: string[];
  year?: number;
  arxivId?: string;
}

const ARXIV_RE = /arxiv[:\s]*([0-9]{4}\.[0-9]{4,5})(v\d+)?/i;
const ARXIV_OLD_RE = /arxiv[:\s]*([a-z-]+(?:\.[A-Z]{2})?\/[0-9]{7})(v\d+)?/i;
/** arXiv 页脚的 "Preprint. Under review." 等噪声行 */
const NOISE_RE =
  /^(preprint|under review|published as|accepted at|conference paper|workshop|doi:|copyright|all rights reserved|provided proper attribution)/i;
/** 标题续行的常见起始词：只有以这些词或小写字母开头的行才可能是标题的延续 */
const CONTINUATION_START_RE =
  /^(a|an|the|of|for|with|without|and|or|in|on|at|to|from|by|toward|towards|is|are|via|using|based|machine|deep|neural)\b/i;

/** 由 arXiv 编号推导年份：新式 YYMM.NNNNN，旧式 archive/NNNNNNN 需另判 */
function yearFromArxivId(id?: string): number | undefined {
  if (!id) return undefined;
  const m = /^(\d{2})(\d{2})\./.exec(id);
  if (m) {
    const yy = Number(m[1]);
    const mm = Number(m[2]);
    if (mm < 1 || mm > 12) return undefined;
    // arXiv 编号从 2007 年 4 月起启用新式；YY>=91 视为 1900 年代
    return yy >= 91 ? 1900 + yy : 2000 + yy;
  }
  return undefined;
}


function looksLikeAuthorLine(line: string): boolean {
  if (line.length < 5 || line.length > 200) return false;
  if (/@/.test(line)) return false;
  if (/^https?:/i.test(line)) return false;
  // 常见作者行特征：多个逗号分隔的人名，或 "A, B and C"
  const parts = line.split(/,|\band\b|&/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const nameLike = parts.filter((p) => /^[A-Z][A-Za-z.'\-]+(\s+[A-Z][A-Za-z.'\-]+){0,3}$/.test(p));
  return nameLike.length >= 2 && nameLike.length >= parts.length - 1;
}

/**
 * 从首页文本启发式猜测标题/作者/年份/arXiv ID。
 * 只做「有把握的直接读取」，不确定就留空，不猜测。
 */
export function guessPdfMeta(firstPageText: string): PdfMetaGuess {
  const out: PdfMetaGuess = { authors: [] };
  if (!firstPageText) return out;

  const m = ARXIV_RE.exec(firstPageText) || ARXIV_OLD_RE.exec(firstPageText);
  if (m) out.arxivId = m[1];
  const yd = yearFromArxivId(out.arxivId);
  if (yd) out.year = yd;

  // 年份兜底：仅在首页顶部前 1200 字符内出现、且形如 "Month Year" 或 "2020." 时采用，
  // 避免把参考文献中的年份误当作论文年份。
  if (!out.year) {
    const head = firstPageText.slice(0, 1200).replace(/\s+/g, ' ');
    const my =
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(19[89]\d|20[0-4]\d)\b/i.exec(head) ||
      /(19[89]\d|20[0-4]\d)\s*\.\s*(?:preprint|arxiv|submitted|published)/i.exec(head);
    if (my) out.year = Number(my[1]);
  }

  const lines = firstPageText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // 标题：从顶部开始找，跳过噪声行；标题通常是前若干行中被大写/位数达标的长行
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const line = lines[i];
    if (NOISE_RE.test(line)) continue;
    if (line.length < 12 || line.length > 250) continue;
    if (/^arxiv/i.test(line)) continue;
    if (/^[0-9\s.]+$/.test(line)) continue;
    if (/@/.test(line)) continue;
    // arXiv 页边竖排水印会把标题切成单字符行，跳过过短行
    const words = line.split(/\s+/);
    if (words.length < 3) continue;
    const capsRatio = line.replace(/[^A-Za-z]/g, '').length
      ? (line.match(/[A-Z]/g) || []).length / line.replace(/[^A-Za-z]/g, '').length
      : 0;
    const titleLike =
      capsRatio > 0.25 ||
      /^(toward|towards|a |an |the |on |learning|deep|attention|bert|exploring|scaling|efficient|improving|rethinking|understanding|language|neural)/i.test(line);
    if (!titleLike) continue;
    if (looksLikeAuthorLine(line)) continue;
    // 标题可能跨行延续：仅当下一行以小写字母或功能词开头、且不像作者行时才拼接，
    // 避免把 "Attention Is All You Need" 后面的 "Ashish Vaswani" 误并进标题。
    let title = line;
    for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
      const next = lines[j];
      if (next.length < 4) break;
      if (NOISE_RE.test(next) || /@/.test(next) || looksLikeAuthorLine(next)) break;
      if (/^abstract/i.test(next)) break;
      const continuation = /^[a-z]/.test(next) || CONTINUATION_START_RE.test(next);
      if (!continuation) break;
      title += ' ' + next;
    }
    out.title = title.replace(/\s+/g, ' ').slice(0, 250);
    break;
  }

  // 作者：找标题后第一条疑似作者行
  const titleIdx = out.title ? lines.findIndex((l) => out.title!.startsWith(l.slice(0, 30))) : -1;
  for (let i = Math.max(0, titleIdx + 1); i < Math.min(lines.length, (titleIdx > 0 ? titleIdx : 0) + 14); i++) {
    const line = lines[i];
    if (NOISE_RE.test(line) || /^abstract/i.test(line)) continue;
    if (looksLikeAuthorLine(line)) {
      out.authors = line
        .replace(/\s*and\s*/gi, ', ')
        .split(',')
        .map((x) => x.replace(/[*\u2020\u2021\d]+$/g, '').trim())
        .filter((x) => x.length > 2 && x.length < 60);
      break;
    }
  }

  return out;
}

/** 从抽取正文中识别数据集/指标常见名词（仅用于界面提示，不作为抽取结果） */
export const KNOWN_DATASETS = [
  'MNIST', 'CIFAR-10', 'CIFAR-100', 'ImageNet', 'COCO', 'GLUE', 'SQuAD', 'WMT',
  'MS MARCO', 'Common Crawl', 'BooksCorpus', 'Wikipedia', 'PTB', 'WikiText',
];
