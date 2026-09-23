/**
 * 浏览器端 PDF 文本层解析（pdf.js）。
 *
 * 只处理「带文本层的 PDF」。若提取到的文本过少，判定为扫描件/无文本层并明确报错，
 * 不静默返回空结果（交接文档 §4 P0-1）。
 */

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Paper, SampleTag } from '../types';
import { assemblePages, guessPdfMeta } from './assemble';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** 判定为无文本层的阈值：平均每页字符数低于该值即视为扫描件 */
const MIN_CHARS_PER_PAGE = 120;
/** 单文件页数上限，防止超大文件拖垮浏览器 */
export const MAX_PAGES = 120;

export interface ParseOutcome {
  ok: boolean;
  paper?: Paper;
  error?: string;
  warnings: string[];
}

export async function parsePdfFile(
  file: File,
  opts: { contentHash?: string; sample?: SampleTag; sourceUrl?: string } = {},
): Promise<ParseOutcome> {
  const warnings: string[] = [];
  const base: Paper = {
    id: `p_${(opts.contentHash || file.name).slice(0, 12)}_${Math.random().toString(36).slice(2, 7)}`,
    title: file.name.replace(/\.pdf$/i, ''),
    authors: [],
    source: { kind: opts.sourceUrl ? 'arxiv' : 'upload', url: opts.sourceUrl },
    contentHash: opts.contentHash,
    parseStatus: 'parsing',
    pages: [],
    rawText: '',
    charCount: 0,
    sample: opts.sample,
    createdAt: Date.now(),
  };

  let pdf;
  try {
    const buf = await file.arrayBuffer();
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  } catch (e) {
    return {
      ok: false,
      paper: { ...base, parseStatus: 'failed', parseError: `PDF 无法打开：${(e as Error).message}` },
      error: `PDF 无法打开：${(e as Error).message}`,
      warnings,
    };
  }

  try {
    const total = pdf.numPages;
    if (total > MAX_PAGES) {
      warnings.push(`文件共 ${total} 页，超过单篇上限 ${MAX_PAGES} 页，仅解析前 ${MAX_PAGES} 页。`);
    }
    const limit = Math.min(total, MAX_PAGES);
    const pageTexts: string[] = [];

    for (let i = 1; i <= limit; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let lastY: number | null = null;
      let text = '';
      for (const item of content.items as { str?: string; transform?: number[]; hasEOL?: boolean }[]) {
        const str = item.str ?? '';
        if (!str) continue;
        const y = item.transform?.[5];
        if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
          text += '\n';
        }
        text += str;
        if (item.hasEOL) text += '\n';
        lastY = y ?? lastY;
      }
      pageTexts.push(text);
      page.cleanup();
    }

    const assembled = assemblePages(pageTexts);
    const avg = limit > 0 ? assembled.charCount / limit : 0;

    if (avg < MIN_CHARS_PER_PAGE) {
      const msg = `该 PDF 疑似扫描件或不含文本层（${limit} 页仅提取到 ${assembled.charCount} 个字符，平均 ${avg.toFixed(0)} 字/页）。本版本不支持 OCR，请改用「粘贴论文文本」入口。`;
      return {
        ok: false,
        paper: { ...base, parseStatus: 'failed', parseError: msg, pages: assembled.pages, pageCount: assembled.pages.length, rawText: assembled.rawText, charCount: assembled.charCount },
        error: msg,
        warnings,
      };
    }

    const meta = guessPdfMeta(assembled.pages[0]?.text || '');
    warnings.push(...meta.arxivId ? [] : ['未在首页识别到 arXiv 编号，年份与作者将以「未识别」显示，可在详情中人工修正。']);

    const paper: Paper = {
      ...base,
      title: meta.title || base.title,
      authors: meta.authors,
      year: meta.year,
      source: { ...base.source, url: opts.sourceUrl },
      parseStatus: 'ok',
      pages: assembled.pages,
      pageCount: assembled.pages.length,
      rawText: assembled.rawText,
      charCount: assembled.charCount,
    };
    return { ok: true, paper, warnings };
  } catch (e) {
    return {
      ok: false,
      paper: { ...base, parseStatus: 'failed', parseError: `解析过程出错：${(e as Error).message}` },
      error: `解析过程出错：${(e as Error).message}`,
      warnings,
    };
  }
}

/** 备用入口：直接粘贴论文文本 */
export function paperFromText(
  title: string,
  text: string,
  opts: { sample?: SampleTag; sourceUrl?: string } = {},
): Paper {
  const assembled = assemblePages([text]);
  const meta = guessPdfMeta(assembled.pages[0]?.text || '');
  return {
    id: `p_paste_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: title || meta.title || '（未命名，粘贴文本）',
    authors: meta.authors,
    year: meta.year,
    source: { kind: 'paste', url: opts.sourceUrl },
    parseStatus: 'ok',
    pages: assembled.pages,
    pageCount: assembled.pages.length,
    rawText: assembled.rawText,
    charCount: assembled.charCount,
    sample: opts.sample,
    createdAt: Date.now(),
  };
}
