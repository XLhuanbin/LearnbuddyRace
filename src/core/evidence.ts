/**
 * 证据构建与校验。
 *
 * 交接文档 §5 要求：「只把模型返回 JSON 当作成功不够，还要验证引用片段确实存在于对应论文中」。
 * 本模块是这条要求的唯一实现入口：所有来自模型的引文都必须过这里。
 */

import type { Evidence, Paper } from './types';
import { guessSection, locateQuote, pageAt, tailHasRiskyTokens } from './text';

export interface RawEvidenceInput {
  quote?: string | null;
  /** 模型自称的页码，仅作为提示，最终页码由定位结果决定 */
  page?: number | null;
}

/**
 * 校验并构建 Evidence。
 * - 定位成功：verified = true，附带页码/偏移/章节。
 * - 定位失败：verified = false，保留 quote 供人工核对，locator = 'none'，并写明失败原因。
 *   绝不用模型自称的页码冒充真实定位。
 */
export function buildEvidence(paper: Paper, input: RawEvidenceInput): Evidence | undefined {
  const quote = (input?.quote ?? '').toString().trim();
  if (!quote) return undefined;

  const hit = locateQuote(paper.rawText, quote);
  if (!hit) {
    return {
      paperId: paper.id,
      quote: quote.slice(0, 500),
      locator: 'none',
      verified: false,
      verifyNote: '该引文未能在论文全文中定位到（模型可能改写了原文或凭记忆生成），已标记为不可核验。',
    };
  }

  const page = pageAt(paper.pages, hit.start);

  /**
   * **部分覆盖**：只有引文前段能在原文中定位到，尾部很可能被模型改写。
   *
   * 硬约束（P1，已复现）：
   * - `verified` 一律 false —— 部分命中**不得**升级为完整核验；
   * - 保留**真实覆盖率**（不是 1）；
   * - 保留**模型原引文**（不替换成原文切片），并把「实际匹配到的原文位置」另存，
   *   这样用户能看出「哪一段对不上」，而不是被一段看起来完全正确的引文误导。
   */
  if (hit.matchType === 'partial') {
    const risky = tailHasRiskyTokens(hit.unmatchedTail);
    const riskNote = risky.digits
      ? '未命中的尾部含**数字**，这类内容最可能改变结论（例如阈值、提升幅度），务必回原文逐字核对。'
      : risky.negation
        ? '未命中的尾部含**否定词**（not / no / without / 未 等），这类内容会让结论完全反转，务必回原文逐字核对。'
        : '';
    return {
      paperId: paper.id,
      quote: quote.slice(0, 500),
      page,
      start: hit.start,
      end: hit.end,
      section: guessSection(paper.rawText, hit.start),
      locator: page !== undefined ? 'page' : 'none',
      verified: false,
      matchType: 'partial',
      coverage: hit.coverage,
      verifyNote:
        `只有引文前 ${Math.round(hit.coverage * 100)}% 能在原文中定位到，尾部疑似被模型改写，因此不视为有效证据` +
        `（下方引文是模型给出的原文，另附实际匹配到的位置）。${riskNote}`,
    };
  }

  /**
   * 完整匹配（strict / loose）才允许 verified = true 与 coverage = 1。
   * 注意：`quote` 取自**原文切片**（而不是模型给的字符串），
   * 因为 loose 匹配会忽略标点差异，用原文切片才能保证展示的就是原文。
   */
  return {
    paperId: paper.id,
    quote: paper.rawText.slice(hit.start, hit.end),
    page,
    start: hit.start,
    end: hit.end,
    section: guessSection(paper.rawText, hit.start),
    locator: page !== undefined ? 'page+offset' : 'none',
    verified: true,
    matchType: hit.matchType,
    coverage: 1,
  };
}

/** 统计一批证据的校验情况，用于界面展示与验证记录 */
export function summarizeEvidence(evidences: (Evidence | undefined)[]) {
  const total = evidences.filter(Boolean).length;
  const verified = evidences.filter((e) => e?.verified).length;
  return { total, verified, failed: total - verified };
}
