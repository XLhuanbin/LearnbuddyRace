/**
 * 浏览器端 PDF 文本层解析（pdf.js）。
 *
 * 只处理「带文本层的 PDF」。若提取到的文本过少，判定为扫描件/无文本层并明确报错，
 * 不静默返回空结果（交接文档 §4 P0-1）。
 *
 * 资源边界（本轮补齐）：
 * - **字节预算**：先看 `file.size`，超限直接给出可操作的错误，而不是把整个文件读进内存再失败；
 * - **文件头校验**：`%PDF-` 缺失时明确报「不是 PDF」，避免把任意文件丢给 pdf.js 得到一句看不懂的报错；
 * - **页数与字符数上限**：在解析循环里尽早中止（不是解析完全文再回头数页数）；
 * - **资源释放**：`PDFDocument` 在 `finally` 里 `destroy()`，页面对象用完 `cleanup()`；
 * - **可取消**：传入 `signal` 后，页循环每页检查一次，abort 时同时调用 pdf.js 的 task.cancel()。
 *
 * 说明：这里做的是「资源硬化」，不是宣称存在某个已复现的压缩炸弹漏洞 ——
 * 单文件字节上限只是把「超大文件把浏览器拖垮」变成一条明确、可操作的失败信息。
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
/**
 * 单文件字节上限（40MB）。
 * 为什么是现在这个数：预置样例与研究论文 PDF 一般远小于此；超过之后浏览器端一次性
 * `arrayBuffer()` + pdf.js 解析会把主线程与内存顶住，而用户看到的是「转圈直到标签页卡住」。
 * 与其那样，不如先量一下大小并给出可操作的提示（换粘贴文本入口 / 先压缩文件）。
 */
export const MAX_PDF_BYTES = 40 * 1024 * 1024;
/**
 * 全文字符数上限（40 万字符）。
 * 全文会被拼进提示词与证据定位：超过之后不仅成本高，证据定位也会变得不可靠。
 * 触发时**如实截断并在 warnings 里写明**，绝不假装"已解析完整篇论文"。
 */
export const MAX_TEXT_CHARS = 400_000;
/** 文件头扫描范围：允许 PDF 前面有少量前导字节，因此只在前 1KB 内查找 `%PDF-` */
const HEADER_SCAN_BYTES = 1024;

/**
 * 解析失败的原因分类。
 * `canceled` 与其它原因分开：界面要能区分「用户主动停止」与「这个文件解析不了」。
 */
export class PdfParseError extends Error {
  constructor(
    message: string,
    readonly kind: 'canceled' | 'too_large' | 'not_pdf' | 'parse',
  ) {
    super(message);
    this.name = 'PdfParseError';
  }
}

export interface ParseOutcome {
  ok: boolean;
  paper?: Paper;
  error?: string;
  warnings: string[];
}

/** `%PDF-` 的字节形式（不依赖 Node 的 Buffer，浏览器端直接比字节） */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** 只看前若干字节判断是不是 PDF：避免为了验头把整个文件读进来 */
function looksLikePdf(head: Uint8Array): boolean {
  const n = Math.min(head.length, HEADER_SCAN_BYTES) - PDF_SIGNATURE.length;
  for (let i = 0; i <= n; i++) {
    let matched = true;
    for (let j = 0; j < PDF_SIGNATURE.length; j++) {
      if (head[i + j] !== PDF_SIGNATURE[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

export async function parsePdfFile(
  file: File,
  opts: { contentHash?: string; sample?: SampleTag; sourceUrl?: string; signal?: AbortSignal } = {},
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

  /** 统一的失败出口：保证 paper 一定带 parseStatus/parseError，界面不会停在「解析中」 */
  const fail = (error: string): ParseOutcome => ({
    ok: false,
    paper: { ...base, parseStatus: 'failed', parseError: error },
    error,
    warnings,
  });

  // ---- 资源边界 1：字节预算（先看 size，绝不先读文件） ----
  if (file.size > MAX_PDF_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return fail(
      `文件过大（${mb}MB，上限 ${MAX_PDF_BYTES / 1024 / 1024}MB）：浏览器端一次性解析会占满内存。` +
        `请先压缩该 PDF（或只保留正文页），或改用「粘贴论文文本」入口。`,
    );
  }
  if (file.size === 0) {
    return fail('文件为空（0 字节），无法解析。请重新选择文件。');
  }
  if (opts.signal?.aborted) {
    return fail('已停止等待（用户取消）。本次解析未完成。');
  }

  // ---- 资源边界 2：文件头校验 ----
  let headBytes: Uint8Array;
  try {
    headBytes = new Uint8Array(await file.slice(0, HEADER_SCAN_BYTES).arrayBuffer());
  } catch (e) {
    return fail(`无法读取文件：${(e as Error).message}`);
  }
  if (!looksLikePdf(headBytes)) {
    return fail(
      '该文件不是 PDF（开头 1KB 内找不到 %PDF- 文件头）。请确认文件没有损坏或被改名；' +
        '若是扫描件或纯文本，请改用「粘贴论文文本」入口。',
    );
  }

  let pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']> | undefined;
  let task: ReturnType<typeof pdfjsLib.getDocument> | undefined;
  try {
    const buf = await file.arrayBuffer();
    if (opts.signal?.aborted) {
      return fail('已停止等待（用户取消）。本次解析未完成。');
    }
    task = pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false });
    // pdf.js 的 loadingTask 支持 cancel()：用户取消时同时停掉 worker 侧的工作，
    // 而不是让它在后台把整份文档解析完
    const onAbort = () => {
      try {
        (task as { cancel?: () => void } | undefined)?.cancel?.();
      } catch {
        /* cancel 抛错不影响本地的取消结果 */
      }
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      pdf = await task.promise;
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
    }
  } catch (e) {
    // task 被 cancel 时 pdf.js 会抛，这里统一按「取消」处理
    if (opts.signal?.aborted) {
      return fail('已停止等待（用户取消）。本次解析未完成。');
    }
    return fail(`PDF 无法打开：${(e as Error).message}`);
  }

  try {
    const total = pdf.numPages;
    if (total > MAX_PAGES) {
      warnings.push(`文件共 ${total} 页，超过单篇上限 ${MAX_PAGES} 页，仅解析前 ${MAX_PAGES} 页。`);
    }
    // 页数上限在这里就生效：只循环到 limit，不会先把整份文档翻一遍再数页数
    const limit = Math.min(total, MAX_PAGES);
    const pageTexts: string[] = [];
    let accChars = 0;
    let truncated = false;

    for (let i = 1; i <= limit; i++) {
      // 每页检查一次取消信号：长文档解析要能在中途停下
      if (opts.signal?.aborted) {
        throw new PdfParseError('已停止等待（用户取消）。本次解析未完成。', 'canceled');
      }
      const page = await pdf.getPage(i);
      let text = '';
      try {
        const content = await page.getTextContent();
        let lastY: number | null = null;
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
      } finally {
        // 页面对象用完立刻释放，避免整份文档的页面资源一直挂着
        (page as { cleanup?: () => void }).cleanup?.();
      }

      // 字符预算：超了就停止取后续页，并如实记录截断（不假装已覆盖全文）
      if (accChars + text.length > MAX_TEXT_CHARS) {
        truncated = true;
        break;
      }
      pageTexts.push(text);
      accChars += text.length;
    }

    if (truncated) {
      warnings.push(
        `全文超过 ${MAX_TEXT_CHARS} 字符，已截断（只取回前 ${accChars} 字符），后续证据定位只覆盖已取回部分。`,
      );
    }

    const assembled = assemblePages(pageTexts);
    const parsedPages = Math.max(pageTexts.length, 1);
    const avg = limit > 0 ? assembled.charCount / parsedPages : 0;

    if (avg < MIN_CHARS_PER_PAGE) {
      const msg = `该 PDF 疑似扫描件或不含文本层（${parsedPages} 页仅提取到 ${assembled.charCount} 个字符，平均 ${avg.toFixed(0)} 字/页）。本版本不支持 OCR，请改用「粘贴论文文本」入口。`;
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
    if (e instanceof PdfParseError && e.kind === 'canceled') {
      return fail(e.message);
    }
    return fail(`解析过程出错：${(e as Error).message}`);
  } finally {
    // 无论成功失败都销毁文档对象：pdf.js 会在 worker 侧保留解析产物，不 destroy 就会一直占内存
    try {
      pdf?.destroy();
    } catch {
      /* destroy 失败不影响本次解析结果 */
    }
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
