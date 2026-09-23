/**
 * 证据构建与校验。
 *
 * 交接文档 §5 要求：「只把模型返回 JSON 当作成功不够，还要验证引用片段确实存在于对应论文中」。
 * 本模块是这条要求的唯一实现入口：所有来自模型的引文都必须过这里。
 */

import type { Evidence, Paper } from './types';
import { guessSection, locateQuote, pageAt } from './text';

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

  // 只匹配到前段：说明引文尾部很可能被改写，必须判为未通过校验
  if (hit.matchType === 'partial') {
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
      verifyNote: `只有引文前 ${Math.round(hit.coverage * 100)}% 能在原文中定位到，尾部疑似被模型改写，因此不视为有效证据（下方展示的是实际匹配到的原文位置）。`,
    };
  }

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
