/**
 * 推理可行性的前置问题：「这篇论文的权重/检查点能不能拿到」。
 *
 * 背景：预置样例的「使用现有权重推理」一行原先恒为「尚未验证」，但实测全文里
 * BERT / RoBERTa / DistilBERT 都有 8~16 处「released / publicly available / GitHub」之类表述，
 * 只是我们的抽取维度里没有这一项。
 *
 * 因此这里做**确定性的全文检索**（不调用模型）：找到论文里关于权重/代码可获取性的原句，
 * 连同页码一起交给界面。检索到「有发布声明」**不等于**「能在用户设备上跑通」——
 * 后者还需要推理成本与硬件信息，界面上必须把这两件事分开写。
 */

import type { Evidence, Paper } from './types';
import { findSentenceCandidates } from './relationCandidates';
import { buildEvidence } from './evidence';

/**
 * 判断一句话是否在说「**本论文提供了**模型/权重/代码」。
 *
 * 必须同时满足：有产物名词 + 有可用/发布措辞，并且落在下面三种句式之一：
 *   A. 自称提供：we/our/this paper + available/released/open-sourced…
 *   B. 产物 + 系动词：models/code/… is|are|will be (publicly) available
 *   C. 可用措辞 + 仓库链接：available/released + https:// | github.com | huggingface
 *
 * 明确排除的假阳性（实测出现过）：
 *   「several recently released pretrained language models」（说的是别的模型）
 *   「surpasses all previously published models」（比较，不是提供）
 *   「results are reported on the test set when publicly available」（说的是测试集）
 *   「we will release the synthetic datasets」（发布的是数据集，不是模型/权重/代码）
 * 以及任何否定表述（not available / unavailable / 尚未公开）。
 */
const AVAIL_WORDS = /\b(available|released?|releasing|open-?sourced?)\b|made [a-z]+ available|make [a-z]+ available|已?(?:发布|开源|公开)|可(?:获取|下载)/i;
const ARTIFACT = /\b(models?|checkpoints?|weights?|codebase|code|implementations?|libraries|library)\b|模型|权重|检查点|代码|实现|库/i;
const SELF = /\b(we|our|this (?:paper|work))\b/i;
const URL_RE = /(https?:\/\/|github\.com|huggingface)/i;
const NEGATION = /\b(?:not|never|un)\s*(?:publicly\s*)?available\b|\bunavailable\b|尚未?公开|不(?:会|能|予)?(?:发布|开源|公开)/i;

function looksLikeAvailability(text: string): boolean {
  if (NEGATION.test(text)) return false;
  if (!ARTIFACT.test(text)) return false;
  // A：自称提供，且产物必须是「发布/提供」的宾语（避免我们把别人的模型或数据集当成自己的产物）
  if (
    /(we|our|this (?:paper|work))[^.]{0,80}?(?:release|releasing|open-?source)w*[^.]{0,60}?(models?|checkpoints?|weights?|code|implementations?|libraries?|library)/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /(?:make|made|makes|making)[^.]{0,40}?(models?|checkpoints?|weights?|code|implementations?|libraries?|library)[^.]{0,20}?available/i.test(
      text,
    )
  ) {
    return true;
  }
  if (SELF.test(text) && AVAIL_WORDS.test(text) && /(available|released?|open-?sourced?)/i.test(text) && URL_RE.test(text)) return true;
  // B：产物 + 系动词 available
  if (
    /\b(models?|checkpoints?|weights?|code|implementations?|libraries|library)\b[^.]{0,60}\b(?:is|are|will be|have been|has been)\s+(?:publicly\s+)?available/i.test(
      text,
    )
  ) {
    return true;
  }
  // C：可用措辞 + 仓库链接
  if (AVAIL_WORDS.test(text) && URL_RE.test(text)) return true;
  return false;
}

export interface AvailabilityResult {
  /** 找到的原文句（已通过定位校验） */
  evidence?: Evidence;
  /** 是否找到「论文声明权重/代码可获取」的句子 */
  found: boolean;
}

/**
 * 在论文全文中检索权重/代码可获取性的句子。
 * @param paper 论文（需含 rawText 与 pages）
 */
export function findWeightsAvailability(paper: Paper): AvailabilityResult {
  if (!paper.rawText) return { found: false };
  const sentences = findSentenceCandidates(paper, /.*/, 4000);
  for (const cand of sentences) {
    if (!looksLikeAvailability(cand.text)) continue;
    // 与其它证据同一套口径：必须能在全文中定位（buildEvidence 会校验并算页码）
    const evidence = buildEvidence(paper, { quote: cand.text.slice(0, 300) });
    if (evidence?.verified) return { evidence, found: true };
  }
  return { found: false };
}
