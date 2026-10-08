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
 *   A. 自称提供：we/our/this paper + release/open-source + 产物名词（主语与动词之间不得夹带
 *      「使用 / 比较 / 基于」类动词，见 CONSUME_VERBS）
 *   B. 产物 + 系动词：models/code/… is|are|will be (publicly) available
 *   C. 可用措辞 + 仓库链接：available/released + https:// | github.com | huggingface
 *
 * 明确排除的假阳性（实测出现过）：
 *   「several recently released pretrained language models」（说的是别的模型）
 *   「surpasses all previously published models」（比较，不是提供）
 *   「our implementation is based on the open-sourced PyTorch implementation」（在说别人的产物）
 *   「results are reported on the test set when publicly available」（说的是测试集）
 *   「we will release the synthetic datasets」（发布的是数据集，不是模型/权重/代码）
 * 以及任何否定表述（not available / unavailable / 尚未公开）。
 *
 * 另外还有一条**局部兜底**（见 ARTIFACT_THEN_REPO / findCompactDeclaration）：
 * 句子级检索落空时，再找「产物名词 + 冒号 + 仓库链接」的紧凑写法。原因是共用的分句器
 * 以句点切分并要求候选句 ≥50 字符，`Code: https://github.` 这类被切出来只有 20 字符、
 * 会被整句丢掉（ConvNeXt 摘要就是这么漏掉的）。
 */
const AVAIL_WORDS = /\b(available|released?|releasing|open-?sourced?)\b|made [a-z]+ available|make [a-z]+ available|已?(?:发布|开源|公开)|可(?:获取|下载)/i;
const ARTIFACT = /\b(models?|checkpoints?|weights?|codebase|code|implementations?|libraries|library)\b|模型|权重|检查点|代码|实现|库/i;
const URL_RE = /(https?:\/\/|github\.com|huggingface)/i;
const NEGATION = /\b(?:not|never|un)\s*(?:publicly\s*)?available\b|\bunavailable\b|尚未?公开|不(?:会|能|予)?(?:发布|开源|公开)/i;

/**
 * 「使用 / 比较 / 基于」类动词。
 *
 * 为什么必须有这道守卫：把 `\b` 补回词边界后，`released` / `open-sourced` 当**形容词**用的句子
 * 也会命中「自称提供」分支，实测在参赛语料里就能复现（ViT 附录）：
 *   "Our implementation is based on the open-sourced PyTorch implementation in https://github.com/…"
 *   "our implementation, similar to the open-source implementation, is very slow on TPUs"
 * 这两句都**不是** ViT 在发布自己的产物。因此要求「自称提供」的主语与发布动词之间
 * 不能夹带下列动词；命中即视为「在说别人的产物」，不认。
 */
const CONSUME_VERBS =
  /\b(?:use[sd]?|using|employ\w*|adopt\w*|follow\w*|base[ds]?|build[s]?|built|compare[sd]?|comparing|similar|rely|relies|relying|leverage\w*|evaluate[sd]?|adapt\w*|initiali[sz]\w*|warm[- ]?start\w*|borrow\w*|reproduc\w*)\b/i;

/**
 * 「产物名词 + 冒号 + 仓库链接」的紧凑写法（ConvNeXt 摘要：`Code: https://github.com/facebookresearch/ConvNeXt`）。
 *
 * 只认**紧邻**形式：产物名词与链接之间除空格/冒号外不允许有别的内容。这一条限制同时挡掉了
 * 参考文献里的写法（实测语料里都有）：
 *   「[80] Ross Wightman. GitHub repository: Pytorch image models. https://github.com/…」
 *   「[3] GitHub repository: Swin transformer for object detection. https://github.com/…」
 *   「[2] GitHub repository: Swin transformer. https://github.com/…」
 * 它们与链接之间都隔着句号等字符；同理 `Code is not available at https://…` 也不会命中
 *（"is not available at" 破坏了紧邻），因此这里不需要额外的否定判断。
 *
 * 刻意**要求冒号**：参考文献条目里偶尔会出现「Pytorch image models https://github.com/…」
 * 这种省略句点的写法，有冒号能把它们排除在外。代价是 `Code https://…`（无冒号）不会被识别，
 * 宁可漏报也不误报。
 *
 * 这里**故意不加**额外的否定判断：
 * - 紧邻要求已经挡掉了 `Code is not available at https://…` 这类写法（中间的
 *   "is not available at" 破坏了紧邻）；
 * - 反过来，若按窗口做否定检查，「本文没有在 PyPI 上提供。Code: https://github.com/…」
 *   这种同段里出现无关否定的真声明会被误杀。
 * 残余风险只剩「同一短语里既否定又给出仓库链接」这种自相矛盾的写法，可忽略。
 */
const ARTIFACT_THEN_REPO =
  /\b(codebase|code|models?|checkpoints?|weights?|implementations?|libraries?)\b\s*[:：]\s*(?:https?:\/\/)?(?:www\.)?(?:github\.com|gitlab\.com|huggingface\.co)(?:\/[^\s"'()\[\]{}<>,;]*)?/i;

/**
 * 句子级检索落空后的局部兜底：在全文中找「产物名词 + 冒号 + 仓库链接」。
 *
 * 为什么不改共用的 sentence splitter（relationCandidates.findSentenceCandidates）：
 * 它同时服务关系候选抽取，放开长度下限或切分规则会波及其它判定，风险远大于收益。
 * 兜底结果同样必须过 buildEvidence 的定位校验，定位不到就不算（与其它证据同一套口径）。
 */
function findCompactDeclaration(paper: Paper): AvailabilityResult {
  const re = new RegExp(ARTIFACT_THEN_REPO.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(paper.rawText)) !== null) {
    const evidence = buildEvidence(paper, { quote: m[0].trim() });
    if (evidence?.verified) return { evidence, found: true };
  }
  return { found: false };
}

function looksLikeAvailability(text: string): boolean {
  if (NEGATION.test(text)) return false;
  if (!ARTIFACT.test(text)) return false;
  // A：自称提供，且产物必须是「发布/提供」的宾语（避免我们把别人的模型或数据集当成自己的产物）。
  //
  // 这里的「反斜杠 + b」必须是两个字符。历史上这三个分支的词边界曾被写成单个 0x08 退格字节，
  // 导致「自称提供 / make…available / 可用措辞+链接」三个分支全部变成死代码（该模块又零测试，久未被发现）。
  // 复现：修复前 "We release our pretrained models..." 返回 false。
  //
  // 另外 released / open-sourced 当形容词用时（"based on the open-sourced PyTorch implementation"、
  // "similar to the open-source implementation"、"we use the released models"）不是本论文在发布产物，
  // 因此要求主语与发布动词之间不能夹带 CONSUME_VERBS。
  {
    const m = /\b(we|our|this (?:paper|work))\b([^.]{0,80}?)\b(?:release|releasing|open-?source)\w*[^.]{0,60}?\b(models?|checkpoints?|weights?|code|implementations?|libraries?|library)\b/i.exec(
      text,
    );
    if (m && !CONSUME_VERBS.test(m[2])) return true;
  }
  {
    const m = /\b(?:make|made|makes|making)\b([^.]{0,40}?)\b(models?|checkpoints?|weights?|code|implementations?|libraries?|library)\b[^.]{0,20}?\bavailable\b/i.exec(
      text,
    );
    if (m && !CONSUME_VERBS.test(m[1])) return true;
  }
  // 历史上的第三条分支「自称 + 可用措辞 + 仓库链接」已删除：它的条件被下面的 C 完全覆盖，
  // 而它自己不带 CONSUME_VERBS 守卫，正是它把「基于别人的开源实现，仓库见 https://…」判成了发布声明。
  // B：产物 + 系动词 available
  if (
    /\b(models?|checkpoints?|weights?|code|implementations?|libraries|library)\b[^.]{0,60}\b(?:is|are|will be|have been|has been)\s+(?:publicly\s+)?available/i.test(
      text,
    )
  ) {
    return true;
  }
  // C：可用措辞 + 仓库链接。
  //    整句还要不含「使用 / 比较 / 基于」类动词，否则会把「基于别人的开源实现，仓库见 https://…」
  //    误当成本论文的发布声明（ViT 附录里就有一句，见上）。
  if (!CONSUME_VERBS.test(text) && AVAIL_WORDS.test(text) && URL_RE.test(text)) return true;
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
  // 句子级没命中，再看紧凑写法（分句器要求候选句 ≥50 字符，短声明会被整句丢掉）。
  // 顺序上句子级优先：能给出更完整的上下文时不用兜底结果。
  return findCompactDeclaration(paper);
}
