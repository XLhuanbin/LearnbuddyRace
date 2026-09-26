/**
 * 规则层：版本号 + 可复用的判定工具。
 *
 * 说明：本项目里凡是「由程序判定」的结论（可比性、关系可信度、条件范围、证据是否支持主张）
 * 都集中在这里实现，并带一个统一版本号。
 * 缓存结果必须记录生成时的规则版本；版本不一致时该结果要标为过期，不能继续作为当前结论展示。
 */

import type { ConditionDimension, ExperimentConditions, RelationType } from './types';
import { CONDITION_DIMENSIONS } from './types';

/** 规则版本：可比性、关系校验、条件范围、证据支持判定。任何影响结论的改动都要升版本。 */
export const RULES_VERSION = 'r3.0.0';

/** 提示词版本在 prompts.ts 中单独维护，缓存同时记录两者。 */
export type StalenessReason =
  | 'rules_version_changed'
  | 'prompt_version_changed'
  | 'inputs_changed'
  | 'cache_format_changed';

export interface StalenessReport {
  stale: boolean;
  reasons: StalenessReason[];
  notes: string[];
}

export function describeStaleness(r: StalenessReport): string {
  const map: Record<StalenessReason, string> = {
    rules_version_changed: '判定规则已更新',
    prompt_version_changed: '提示词模板已更新',
    inputs_changed: '输入论文集合已变化',
    cache_format_changed: '缓存文件结构已变化',
  };
  return r.reasons.map((x) => map[x]).join('；');
}

/* ============================ 方法名别名 ============================ */

/**
 * 真正泛化的词：单独出现不能证明某个具体方法。
 * 注意：方法专名（如 Transformer / BERT / GPT）**不属于**泛化词 —— 它们就是方法名本身；
 * 把它们当泛化词会导致「引文里明明写了 BERT 却被判定为没有指名」的错误结论。
 */
const GENERIC_TERMS = new Set([
  'model',
  'models',
  'network',
  'networks',
  'architecture',
  'architectures',
  'framework',
  'approach',
  'method',
  'methodology',
  'language model',
  'language models',
  'the model',
  'encoder',
  'decoder',
  'attention mechanism',
  'baseline',
]);

/**
 * 从方法名词条中提取别名集合。
 *
 * 处理场景：
 * - "BERT (Bidirectional Encoder Representations from Transformers)" → ["BERT", "Bidirectional Encoder Representations from Transformers"]
 * - "Bidirectional Encoder Representations from Transformers (BERT)" → 同上
 * - "Transformer" → ["Transformer"]
 */
export function methodAliases(rawName?: string): string[] {
  const v = (rawName ?? '').trim();
  if (!v) return [];
  const out = new Set<string>();

  const add = (s: string) => {
    const t = s.replace(/^[\s,;:。-]+|[\s,;:。]+$/g, '').trim();
    if (t.length >= 2) out.add(t);
  };

  // 去掉结尾的版本/规模后缀，保留主体
  const cleaned = v.replace(/\s*[-–—]\s*(base|large|small|xl|xxl|\d+b|\d+m)\s*$/i, '');

  add(cleaned);
  // 括号内的内容（中英文括号）作为整体别名，例如 BERT 的全称展开
  for (const m of cleaned.matchAll(/[（(]([^）)]{2,80})[）)]/g)) add(m[1]);
  // 括号外的部分（即主名称）
  const mainName = cleaned.replace(/[（(][^）)]*[）)]/g, ' ').trim();
  add(mainName);

  /**
   * 只在**主名称**中提取「全大写缩写」作为别名。
   *
   * 关键修复：不能从括号内容里逐个抽大写词 —— 实测
   * "RoBERTa (Robustly Optimized BERT Pretraining Approach)" 会把括号里的独立 token「BERT」
   * 也当成 RoBERTa 的别名，导致「引文提到 BERT」被误判为「提到了 RoBERTa」，
   * 甚至反过来给 BERT→RoBERTa 这种关系提供错误的端点证据。
   * 同时对全大写的判定收紧（纯大写字母/数字/连字符），避免把 "Robustly" 这类普通词当缩写。
   */
  for (const m of mainName.matchAll(/(^|[^A-Za-z0-9])([A-Z][A-Z0-9-]{2,15})(?![A-Za-z0-9])/g)) {
    add(m[2]);
  }

  return [...out];
}

/** 判断某别名是否属于「泛化词」——单独出现不能证明具体方法 */
export function isGenericAlias(alias: string): boolean {
  return GENERIC_TERMS.has(alias.trim().toLowerCase());
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 在文本中查找别名（词边界匹配，大小写不敏感），返回实际命中的别名 */
export function findAliasInText(text: string, aliases: string[]): string | undefined {
  for (const a of aliases) {
    if (a.length < 3) continue;
    const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(a)}([^A-Za-z0-9]|$)`, 'i');
    if (re.test(text)) return a;
  }
  return undefined;
}

/* ============================ 继承/改进措辞与引用标记 ============================ */

/** 各关系类型下，能支撑该关系的措辞 */
const CLAIM_PATTERNS: Record<RelationType, RegExp[]> = {
  extends: [
    /\bbased on\b/i,
    /\bbuild(?:s|ing)?\s+(?:up)?on\b/i,
    /\bbuilt\s+(?:up)?on\b/i,
    /\bextend(?:s|ed|ing)?\b/i,
    /\bextension of\b/i,
    /\bfollow(?:s|ing)? the\b/i,
    /\bwe adopt\b/i,
    /\bwe use (?:the )?[A-Za-z0-9-]+ (?:architecture|model|encoder|decoder|backbone)\b/i,
    /\busing the\b/i,
    /\bpre-?trained (?:through|via|on)\b/i,
    // 派生关系：蒸馏/同架构/从某模型初始化（实测在 DistilBERT 论文中出现）
    /\bdistilled version of\b/i,
    /\bsame (?:general )?architecture as\b/i,
    /\b(?:initialized|trained|pre-?trained) (?:from|with|using)\b/i,
  ],
  improves: [
    /\bimprov(?:e|es|ed|ement|ing)\b/i,
    /\bbetter than\b/i,
    /\boutperform(?:s|ed|ing)?\b/i,
    /\benhanc(?:e|es|ed|ing)\b/i,
    /\bwe (?:find|show|show that|demonstrate)\b[^.]{0,80}\b(?:undertrained|suboptimal|insufficient|not optimal)\b/i,
    /\breplace(?:s|d)?\b/i,
    /\bwe (?:change|modify|remove|drop)\b/i,
    /\bstronger than\b/i,
  ],
  combines: [/\bcombin(?:e|es|ed|ing)\b/i, /\bjointly\b/i, /\btogether with\b/i, /\bensemble\b/i, /\bwe integrate\b/i],
  similar: [/\bunlike\b/i, /\bin contrast to\b/i, /\bsimilar to\b/i, /\bcomparable to\b/i],
  unclear: [],
};

/** 引用标记：[Vaswani et al., 2017] / [VSP+17] / (Devlin et al., 2019) */
const CITATION_RE =
  /\[[A-Za-z][A-Za-z0-9+&.,\s-]{1,24}\]|\[\d+(?:,\s*\d+)*\]|\(\s*[A-Z][A-Za-z-]+(?:\s+et\s+al\.?)?\s*,\s*(?:19|20)\d{2}[a-z]?\s*\)/;

/**
 * 第三方主语：句子在描述「其它系统 / 先前工作」而不是本论文的方法时，
 * 不能用来认证这一对论文之间的关系。
 * 例：「Most of the top systems build upon either BERT …」讲的是上榜系统，不是本论文。
 */
const THIRD_PARTY_SUBJECT =
  /\b(most|some|many|other|several|a number of|these|those|top)\s+(?:of\s+the\s+)?(systems|methods|models|approaches|works|papers|submissions)\b|\b(prior|previous|earlier) work\b/i;

export function hasThirdPartySubject(text: string): boolean {
  return THIRD_PARTY_SUBJECT.test(text);
}

export interface RelationEvidenceAssessment {
  mentionsFrom?: string;
  mentionsTo?: string;
  claimWord?: string;
  citation?: string;
  /** 是否具备「原文明示」所需的条件 */
  sufficient: boolean;
  /** 面向用户的准确理由（说明查到了什么、缺什么） */
  reason: string;
}

/**
 * 判断一段原文引文是否足以支撑「原文明示」。
 *
 * 判定标准（必须同时满足）：
 * 1. 引文必须提到**被继承一方**（from）的方法名或其别名 —— 泛化词（如单独出现的 Transformer）不算；
 * 2. 关系类型需要有对应的支持：
 *    - extends / combines：出现继承/组合措辞，或「提到 from 方法名 + 引用标记」；
 *    - improves：必须出现改进类措辞（改进比较不能被引用标记替代）；
 *    - similar：必须同时提到两端；
 * 3. 仅出现引用标记、或只出现更泛的技术祖先（如 Vaswani et al.），不能认证具体端点。
 */
export function assessRelationEvidence(
  quote: string,
  fromName: string | undefined,
  toName: string | undefined,
  type: RelationType,
): RelationEvidenceAssessment {
  const text = quote ?? '';
  const fromAliases = methodAliases(fromName).filter((a) => !isGenericAlias(a));
  const toAliases = methodAliases(toName).filter((a) => !isGenericAlias(a));
  const allFromAliases = methodAliases(fromName);

  const mentionsFrom = findAliasInText(text, fromAliases);
  const mentionsTo = findAliasInText(text, toAliases);
  const thirdParty = hasThirdPartySubject(text);
  // 「our / we / this work」这类自指也算指向关系另一端（本论文自己）
  const selfReferential = /\b(we|our|this paper|this work|in this paper)\b/i.test(text);
  // 单独出现的泛化词（如 Transformer）只作为「更泛关系」的提示，不作为端点证据
  const genericHit = !mentionsFrom ? findAliasInText(text, allFromAliases.filter(isGenericAlias)) : undefined;
  const citation = CITATION_RE.exec(text)?.[0];
  const claimWord = CLAIM_PATTERNS[type]?.map((re) => re.exec(text)?.[0]).find(Boolean);

  const parts: string[] = [];
  if (mentionsFrom) parts.push(`引文提到了被继承方法「${mentionsFrom}」`);
  else if (genericHit) parts.push(`引文只提到泛化词「${genericHit}」，未指名被继承方法`);
  else parts.push(`引文没有提到被继承方法（已按简称/全称/括号别名匹配）`);
  if (mentionsTo) parts.push(`提到了关系另一端「${mentionsTo}」`);
  if (thirdParty) parts.push('句子的主语是「其它系统/先前工作」，不是在陈述本论文的方法');
  if (claimWord) parts.push(`含${type === 'improves' ? '改进' : '继承/组合'}措辞「${claimWord.trim()}」`);
  if (citation) parts.push(`含引用标记「${citation}」`);

  let sufficient = false;
  let missing = '';

  if (thirdParty) {
    missing = '句子描述的是其它系统/先前工作，不能用来认证本论文对之间的关系';
  } else if (!mentionsTo && !selfReferential) {
    missing = '句子没有指向关系另一端（既未提到对方方法名，也不是本论文的自指表述）';
  } else if (type === 'improves') {
    if (!mentionsFrom) {
      missing = '缺少「被改进方法名称」这一必需条件';
    } else if (!claimWord) {
      missing = '缺少能说明「改进」的措辞（如 improve / outperform / 指出原方法不足）';
    } else {
      sufficient = true;
    }
  } else if (type === 'similar') {
    if (!mentionsFrom || !mentionsTo) {
      missing = '「相似」关系需要同时提到关系两端的方法名称';
    } else {
      sufficient = true;
    }
  } else {
    // extends / combines / unclear
    if (!mentionsFrom) {
      missing = '缺少「被继承方法名称」这一必需条件，仅凭引用标记或更泛的技术名称不能认证该端点';
    } else if (!claimWord && !citation) {
      missing = '缺少继承/组合措辞或引用标记';
    } else {
      sufficient = true;
    }
  }

  const reason = sufficient ? `${parts.join('；')}，足以支撑「${type}」关系。` : `${parts.join('；')}。${missing}。`;
  return { mentionsFrom, mentionsTo, claimWord: claimWord?.trim(), citation, sufficient, reason };
}

/**
 * 判断一段文本是否「像论文标题」。
 *
 * 用途：论文 PDF 首页排版千差万别，启发式可能抓到摘要句子；模型也可能回显同一句
 * （因为它确实出现在原文中，能通过「引文可定位」校验）。标题不可靠时必须标出来，
 * 不能让一个句子冒充标题继续往下传播。
 */
export function looksLikeTitle(s: string | undefined): boolean {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 6 || t.length > 160) return false;
  // 句末标点后还有内容 → 更像句子而不是标题
  if (/[.?!;]\s+[A-Za-z(]/.test(t)) return false;
  // 以逗号或小写词开头且很长 → 更像从句/摘要
  if (/^[a-z]/.test(t) && t.length > 60) return false;
  // 词数过多
  if (t.split(/\s+/).length > 22) return false;
  // 常见的摘要/正文起始词
  if (/^(we |this |in this |our |the last |however|abstract)/i.test(t) && t.length > 40) return false;
  return true;
}

/**
 * 这条标题是否需要标注「标题待确认」。
 *
 * 判据：既不是模型在原文里核验过的、也不是用户自己填的，且本身不像标题
 * （PDF 首页排版多变，实测会把摘要句抓成标题）。界面必须据此给出提示，
 * 不能把摘要句当作已确认标题展示。
 */
export function titleNeedsConfirm(paper: { title?: string; titleFrom?: string } | undefined): boolean {
  if (!paper) return false;
  if (paper.titleFrom === 'model-verified' || paper.titleFrom === 'user') return false;
  return !looksLikeTitle(paper.title);
}

/* ============================ 条件条目的适用范围 ============================ */

/** 论文级 vs 局部实验级的表述标记（注意转义斜杠） */
const EXPERIMENT_SCOPE_MARKERS =
  /\b(on dev|on the dev|dev set|dev sets|dev and test|dev\/test|test set|test settings?|single model|single models|w\/o |without (?:data )?augmentation|no (?:data )?augmentation|our (?:single )?model|table \d|in table|per task|for (?:this|each) task|on (?:this|that|the same) (?:task|benchmark|dataset)|provided (?:data|dataset|SQuAD|training data)|in both dev)\b/i;

/** 否定式「没有额外数据」的表述 */
const NEGATION_RE = /\b(none|no additional|no extra|not use|does not use|without additional|no further)\b/i;
/** 数据增强相关表述 */
const AUGMENT_RE = /\baugment|\bback-?translat|paraphras|\bdata augment/i;
/** 预训练语料相关表述 */
const PRETRAIN_CORPUS_RE = /\bcorpus|corpora|pre-?training data|pre-?training corpus|unlabeled text|web text|common crawl|bookscorpus|wikipedia\b/i;

export type ClaimScope = 'paper' | 'experiment' | 'unknown';

export interface ScopeAssessment {
  scope: ClaimScope;
  scopeDetail?: string;
  /** 引文是否支持「论文级」的该主张 */
  supportsPaperLevelClaim: boolean;
  reason: string;
}

/**
 * 判断一条条件证据的适用范围。
 *
 * 关键用途：把「某张表里的局部否定描述」与「整篇论文的结论」区分开。
 * 例：RoBERTa 论文某表格写 "Single models on dev, w/o data augmentation"，
 * 只能说明那一个实验没有做数据增强，不能支持「整篇论文没有额外训练数据」。
 */
export function assessClaimScope(quote: string, claimIsNegative: boolean): ScopeAssessment {
  const text = quote ?? '';
  const experimentMarker = EXPERIMENT_SCOPE_MARKERS.exec(text)?.[0];
  const detail = experimentMarker?.trim();

  if (experimentMarker) {
    return {
      scope: 'experiment',
      scopeDetail: detail,
      supportsPaperLevelClaim: !claimIsNegative,
      reason: claimIsNegative
        ? `引文是局部实验描述（出现「${detail}」这类限定），只说明该实验的情况，不能支持「整篇论文均无」的否定结论。`
        : `引文属于局部实验描述（出现「${detail}」），该条目应绑定到具体实验而非整篇论文。`,
    };
  }
  return {
    scope: 'paper',
    supportsPaperLevelClaim: true,
    reason: '引文未出现局部实验限定，按论文级表述处理。',
  };
}

export function looksLikeNegation(values: string[]): boolean {
  return values.some((v) => NEGATION_RE.test(v) || v.trim().toLowerCase() === 'none');
}

export function looksLikeAugmentation(values: string[]): boolean {
  return values.some((v) => AUGMENT_RE.test(v));
}

export function looksLikePretrainingCorpus(values: string[]): boolean {
  return values.some((v) => PRETRAIN_CORPUS_RE.test(v));
}

/**
 * 条件范围归一化（纯函数，抽取时与离线重算时共用同一套规则）。
 *
 * 作用：把「用局部实验描述支撑整篇论文级否定结论」的情况降级为「待人工核对 + 仅限某实验」，
 * 使该条件不再参与一致性判断。抽取阶段与 scripts/revalidate.mjs 都调用这个函数，
 * 避免「离线缓存按旧口径、实时抽取按新口径」的不一致。
 */
export function normalizeConditions(conditions: ExperimentConditions): ExperimentConditions {
  const out = { ...conditions };
  for (const dim of CONDITION_DIMENSIONS) {
    const c = out[dim];
    if (!c) continue;
    if (c.status !== 'verified' || !c.evidence?.verified) continue;
    if (!looksLikeNegation(c.values)) continue;

    const scopeCheck = assessClaimScope(c.evidence.quote, true);
    if (!scopeCheck.supportsPaperLevelClaim) {
      out[dim] = {
        ...c,
        status: 'unverified',
        scope: 'experiment',
        scopeDetail: scopeCheck.scopeDetail ?? c.scopeDetail,
        note: `${scopeCheck.reason}该条件不作为「一致」的依据。`,
      };
    } else if (!c.scope) {
      out[dim] = { ...c, scope: 'paper' };
    }
  }
  return out;
}

/**
 * 数据划分条目按数据集解析："GLUE: train/dev/private test" → { GLUE: "train/dev/private test" }
 * 无法解析出数据集名的条目标记为键 __unscoped__，用于说明「未绑定具体实验」。
 */
export function parseSplitsByDataset(values: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const m = /^([^:：]{2,40})[:：]\s*(.+)$/.exec(v);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim();
      out.set(key, out.has(key) ? `${out.get(key)}；${val}` : val);
    } else {
      const key = '__unscoped__';
      out.set(key, out.has(key) ? `${out.get(key)}；${v}` : v);
    }
  }
  return out;
}
