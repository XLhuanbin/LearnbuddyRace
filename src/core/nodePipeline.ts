/**
 * Node 侧离线分析流水线。
 *
 * 用途：为「预置样例语料」生成真实的模型分析结果缓存。
 * 与浏览器端复用完全相同的核心逻辑（提示词、证据校验、字段状态），
 * 因此缓存结果与实时分析同源，不存在两套实现造成的偏差。
 *
 * 该脚本在本地运行，密钥只从环境变量读取，不会进入前端产物或仓库。
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Method, Paper, Relation, ValidationIssue } from './types';
import { CONDITION_DIMENSIONS } from './types';
import { assemblePages, guessPdfMeta } from './parse/assemble';
import { extractMethod, applyTitleCorrection, findDivergences, generateDecision, inferRelations, type RunConfig } from './model/analyze';
import { validateMethod as validateMethodLocal } from './validate';
import { FIELD_KEYS_ORDER, methodToCache } from './cache';

// 供离线脚本复用的导出（保证缓存与浏览器端共用同一套常量与提示词版本）
export { FIELD_KEYS_ORDER, buildVerificationStat, methodToCache, migrateMethod, migrateRelation, CACHE_VERSION } from './cache';
export { PROMPT_VERSION } from './model/prompts';
export { findDivergences, generateDecision, extractMethod, applyTitleCorrection };
export { compareConditions, comparePair, pairLevel, differingDimensions, LEVEL_LABELS, SCREENING_NOTICE } from './comparability';
export { applyDivergenceRules, buildCheckedPairs } from './divergenceRules';
export { validateMethod, validateRelation, summarizeIssues } from './validate';
export { buildEvidence } from './evidence';
export { assessRelationEvidence, assessClaimScope, normalizeConditions, RULES_VERSION } from './rules';
export type { RunConfig } from './model/analyze';

/** 用 pdfjs legacy 构建在 Node 中提取文本层 */
export async function extractPdfText(path: string): Promise<{ pages: string[]; numPages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const require = createRequire(import.meta.url);
  // 指向随包安装的标准字体目录，消除字体缺失告警（不影响文本层提取）
  const fontDir = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';
  const data = new Uint8Array(await readFile(path));
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: fontDir,
  } as never).promise;

  const pages: string[] = [];
  const numPages = doc.numPages;
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let text = '';
    for (const item of content.items as { str?: string; transform?: number[]; hasEOL?: boolean }[]) {
      const str = item.str ?? '';
      if (!str) continue;
      const y = item.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) text += '\n';
      text += str;
      if (item.hasEOL) text += '\n';
      lastY = y ?? lastY;
    }
    pages.push(text);
    page.cleanup();
  }
  await doc.destroy();
  return { pages, numPages };
}

export interface OfflinePaperSpec {
  file: string;
  /** arXiv 编号；用户直接导入的文件可能没有，此时用文件名派生一个稳定 id */
  arxivId?: string;
  /** 样例用途标注，必须如实写入缓存 */
  purpose: string;
}

/** 由 arXiv 编号或文件名派生稳定的论文 id */
export function derivePaperId(spec: { arxivId?: string; file: string }): string {
  const base = spec.arxivId || spec.file.split(/[\\/]/).pop()?.replace(/\.pdf$/i, '') || 'imported';
  return `p_arxiv_${base.replace(/[^\w.-]/g, '')}`;
}

export interface OfflineResult {
  paper: Paper;
  method: Method;
}

export async function buildPaperFromPdf(spec: OfflinePaperSpec): Promise<Paper> {
  const { pages, numPages } = await extractPdfText(spec.file);
  const assembled = assemblePages(pages);
  const meta = guessPdfMeta(assembled.pages[0]?.text || '');
  const avg = numPages ? assembled.charCount / numPages : 0;
  if (avg < 120) {
    throw new Error(`${spec.file} 平均每页仅 ${avg.toFixed(0)} 字符，疑似无文本层，已停止（不生成空结果）。`);
  }
  const paperId = derivePaperId(spec);
  return {
    id: paperId,
    title: meta.title || spec.arxivId || spec.file,
    authors: meta.authors,
    year: meta.year,
    source: spec.arxivId
      ? { kind: 'arxiv', url: `https://arxiv.org/abs/${spec.arxivId}` }
      : { kind: 'upload', url: spec.file },
    parseStatus: 'ok',
    pages: assembled.pages,
    pageCount: assembled.pages.length,
    rawText: assembled.rawText,
    charCount: assembled.charCount,
    sample: {
      purpose: spec.purpose,
      license: 'arXiv 公开预印本，示例用途，版权归原作者所有。',
    },
    cached: true,
    createdAt: Date.now(),
  };
}

/** 对一批样例执行真实模型抽取，返回缓存结构 */
export async function runOfflineExtraction(
  specs: OfflinePaperSpec[],
  cfg: RunConfig,
  log: (msg: string) => void,
): Promise<{
  papers: Paper[];
  methods: Method[];
  relations: Relation[];
  relationIssues: ValidationIssue[];
}> {
  const papers: Paper[] = [];
  const methods: Method[] = [];

  for (const spec of specs) {
    log(`[解析] ${spec.file}`);
    let paper = await buildPaperFromPdf(spec);
    log(`      标题=${paper.title} | 年份=${paper.year ?? '未识别'} | 页数=${paper.pages.length} | 字符=${paper.charCount}`);
    log(`[抽取] 调用模型 ${cfg.model} ...`);
    const method = await extractMethod(paper, cfg, (t) => {
      log(`      ${t.label} attempt=${t.attempt} ${t.ms}ms prompt=${t.promptChars} out=${t.completionChars}${t.error ? ' ERROR=' + t.error : ''}`);
    });
    const before = paper.title;
    paper = applyTitleCorrection(paper, method);
    // 标题校正后必须重算字段校验：否则会同时出现「标题未确认」与「已模型校正」
    method.validation = validateMethodLocal(paper, method);
    if (paper.title !== before) log(`      标题校正（模型给出且已在原文中验证）：${paper.title}`);
    papers.push(paper);
    methods.push(method);

    const cnt = (s: string) => FIELD_KEYS_ORDER.filter((k) => method.fields[k].status === s).length;
    log(
      `      字段：可核验 ${cnt('verified')} / 待人工核对 ${cnt('unverified')} / 未找到证据 ${cnt('no_evidence')} / 缺失 ${cnt('missing')}`,
    );
    const condOk = CONDITION_DIMENSIONS.filter((d) => method.conditions?.[d].status === 'verified').length;
    log(`      实验条件可核验 ${condOk}/${CONDITION_DIMENSIONS.length}`);
    log(`      程序校验问题 ${method.validation?.length ?? 0} 条`);
  }

  log('[关系] 推断跨论文关系 ...');
  const { relations, issues: relationIssues } = await inferRelations(papers, methods, cfg, (t) => {
    log(`      ${t.label} attempt=${t.attempt} ${t.ms}ms${t.error ? ' ERROR=' + t.error : ''}`);
  });
  const byState = (s: string) => relations.filter((r) => r.evidenceState === s).length;
  log(
    `      关系数=${relations.length}（原文明示 ${byState('explicit')}，系统推断 ${byState('inferred')}，待核查 ${byState('candidate')}）`,
  );
  if (relationIssues.length) log(`      关系校验问题 ${relationIssues.length} 条`);

  return { papers, methods, relations, relationIssues };
}
export { assemblePages, guessPdfMeta } from './parse/assemble';
export { locateQuote, locateNear, pageAt } from './text';
