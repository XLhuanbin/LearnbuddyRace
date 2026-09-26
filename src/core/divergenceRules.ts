/**
 * 分歧发现的规则复核（程序执行，模型只提供文字与候选结论）。
 *
 * 这个模块被两处复用：
 * 1. `findDivergences`（实时分析）—— 模型输出后立刻复核；
 * 2. `scripts/revalidate.mjs`（规则重算）—— 不调用模型，直接把新规则应用到已有缓存。
 *
 * 一致性因此由代码保证：比较页、分歧页、离线缓存走的是同一套判定。
 */

import type { ConditionDimension, DivergenceFinding, Evidence, Method, Paper } from './types';
import { LEVEL_LABELS, comparePair, differingDimensions, pairLevel } from './comparability';
import { buildEvidence } from './evidence';

export interface RawDivergenceFinding {
  kind?: string;
  topic?: string;
  paperIds?: string[];
  sides?: { paperId?: string; claim?: string; quote?: string; page?: number }[];
  claimType?: string;
  commonScope?: string;
  conditionDifferences?: { dimension?: string; label?: string; detail?: string }[];
  explanation?: string;
  nextAction?: string;
  comparabilityLevel?: string;
}

const VALID_KINDS = [
  'conclusion_divergence',
  'condition_confounded',
  'condition_explained',
  'shared_limitation',
  'individual_limitations',
  'none_found',
] as const;

export function applyDivergenceRules(
  papers: Paper[],
  methods: Method[],
  raw: RawDivergenceFinding,
  index: number,
): DivergenceFinding {
  const validPaperIds = new Set(methods.map((m) => m.paperId));
  const paperIds = (raw.paperIds || []).filter((id) => validPaperIds.has(id));
  const ruleNotes: string[] = [];

  const rawKind = (VALID_KINDS as readonly string[]).includes(raw.kind ?? '') ? (raw.kind as DivergenceFinding['kind']) : 'none_found';
  // 旧枚举名映射到更准确的表述：条件不一致 ≠ 「只能由条件差异解释」
  let finalKind: DivergenceFinding['kind'] = (rawKind as string) === 'condition_explained' ? 'condition_confounded' : rawKind;

  let explanation = raw.explanation || '';
  const claimType: 'numeric' | 'qualitative' | undefined =
    raw.claimType === 'numeric' || raw.claimType === 'qualitative' ? raw.claimType : undefined;
  const commonScope = (raw.commonScope || '').trim() || undefined;

  let conditionDifferences: DivergenceFinding['conditionDifferences'] = (raw.conditionDifferences || [])
    .filter((d) => d.label || d.detail)
    .map((d) => ({
      dimension: (d.dimension || 'experimentalSettings') as ConditionDimension,
      label: d.label || d.dimension || '条件',
      detail: d.detail || '',
    }));

  // 用程序按论文对重算可比性，覆盖模型自报值
  let comparabilityLevel: DivergenceFinding['comparabilityLevel'] =
    raw.comparabilityLevel === 'comparable' ||
    raw.comparabilityLevel === 'limited' ||
    raw.comparabilityLevel === 'not_comparable'
      ? raw.comparabilityLevel
      : 'unknown';

  if (paperIds.length >= 2) {
    const levels: DivergenceFinding['comparabilityLevel'][] = [];
    for (let x = 0; x < paperIds.length; x++) {
      for (let y = x + 1; y < paperIds.length; y++) {
        levels.push(pairLevel(papers, methods, paperIds[x], paperIds[y]));
      }
    }
    const rank: Record<DivergenceFinding['comparabilityLevel'], number> = {
      not_comparable: 3,
      limited: 2,
      unknown: 1,
      comparable: 0,
    };
    comparabilityLevel = levels.reduce(
      (w, l) => (rank[l] > rank[w] ? l : w),
      'comparable' as DivergenceFinding['comparabilityLevel'],
    );
  }

  if (finalKind === 'conclusion_divergence') {
    if (paperIds.length < 2) {
      finalKind = 'none_found';
      ruleNotes.push('涉及论文不足两篇，无法构成跨论文分歧。');
    } else if (!commonScope) {
      finalKind = 'none_found';
      ruleNotes.push('缺少双方主张的共同对象/范围，无法确认两者在比较同一件事，因此不认定为分歧。');
      explanation = `缺少共同比较范围，未认定为分歧。${explanation ? `模型说明：${explanation}` : ''}`;
    } else if (claimType === 'numeric') {
      if (comparabilityLevel !== 'comparable') {
        const diffs: DivergenceFinding['conditionDifferences'] = [];
        for (let x = 0; x < paperIds.length; x++) {
          for (let y = x + 1; y < paperIds.length; y++) {
            for (const d of differingDimensions(papers, methods, paperIds[x], paperIds[y])) {
              if (!diffs.some((z) => z.dimension === d.dimension)) diffs.push(d);
            }
          }
        }
        // 若没有任何「不一致」的维度，说明是「信息不足」导致无法判断，把原因写清而不是留空
        if (!diffs.length) {
          const rep = comparePair(papers, methods, paperIds[0], paperIds[1]);
          for (const d of rep.dimensions) {
            if (d.dimension === 'computeResources') continue;
            if (d.level !== 'unknown') continue;
            diffs.push({
              dimension: d.dimension,
              label: `${d.label}（信息不足）`,
              detail: d.basis.find((b) => b.kind === 'missing')?.text ?? '该维度信息不足，无法判断是否一致。',
            });
          }
        }
        conditionDifferences = diffs.length ? diffs : conditionDifferences;
        finalKind = 'condition_confounded';
        ruleNotes.push(
          `这是数值结果层面的差异，但涉及论文的实验条件可比性为「${LEVEL_LABELS[comparabilityLevel]}」。` +
            (comparabilityLevel === 'unknown'
              ? '条件信息不足，无法判断是否可比，因此不能称为分歧。'
              : '条件不一致时无法排除条件差异的影响，也不能归因于方法本身。'),
        );
        explanation = `系统复核：数值结果差异需要实验可比才能讨论，当前可比性为「${LEVEL_LABELS[comparabilityLevel]}」，因此不认定为结论分歧。${
          explanation ? `模型说明：${explanation}` : ''
        }`;
      } else {
        ruleNotes.push('数值结果差异，且涉及论文对在已检查条件上一致，可进一步核对具体数值与报告方式。');
      }
    } else if (claimType === 'qualitative') {
      ruleNotes.push(
        '这是定性主张层面的分歧，按具体陈述范围核查；该判断不涉及数值结果，因此不因论文整体不可比而禁止，但两边报告的数值仍不可直接比较。',
      );
    }
  }

  if (finalKind === 'shared_limitation' && !commonScope) {
    finalKind = 'individual_limitations';
    ruleNotes.push('各论文的局限没有给出共同对象/任务/约束，因此分别展示，不聚合为同一条共同局限。');
    explanation = `未发现共同对象，按各自局限分别展示。${explanation ? `模型说明：${explanation}` : ''}`;
  }

  // 幂等说明：即使输入已经是 individual_limitations（离线重算会重复执行），
  // 也保留「为什么分别展示」的解释，避免复核记录在重复处理中丢失。
  if (finalKind === 'individual_limitations' && !commonScope && !ruleNotes.length) {
    ruleNotes.push('未给出共同的局限对象/任务/约束，因此按各自局限分别展示；没有共同对象时不聚合为共同局限。');
  }

  if (finalKind === 'condition_confounded' && !conditionDifferences.length) {
    // 既列不出「不一致」的维度，也没有「信息不足」的维度可说明：无法核实，降为未发现
    finalKind = 'none_found';
    ruleNotes.push('声称受条件差异影响，但既给不出具体条件差异，也无法说明哪些条件信息不足，无法核实。');
    explanation = `缺少可核实的条件差异，未认定为分歧。${explanation ? `原说明：${explanation}` : ''}`;
  }

  const disclaimer =
    finalKind === 'conclusion_divergence'
      ? claimType === 'qualitative'
        ? '这是定性主张层面的差异，已按具体陈述范围核查；两边报告的数值结果仍不可直接比较。'
        : '该发现涉及的论文在已检查条件上一致，但仍建议回到原文核对具体数值与报告方式。'
      : finalKind === 'condition_confounded'
        ? '条件不一致时无法排除条件差异的影响，也不能把结果差异归因于方法本身；要判断方法优劣需要先对齐实验条件。'
        : finalKind === 'shared_limitation'
          ? '这表示当前材料中针对同一对象存在待调查的问题，不代表整个领域存在研究空白，也不保证相关方向具有创新性。'
          : finalKind === 'individual_limitations'
            ? '这些局限针对的对象不同，分别列出仅供参考，不构成共同结论。'
            : '这是基于当前已导入材料与已抽取条件的判断，不代表完整文献综述结论。';

  return {
    id: `dv_${index}`,
    kind: finalKind,
    topic: raw.topic || '未命名主题',
    paperIds,
    sides: (raw.sides || [])
      .filter((s) => s.paperId && validPaperIds.has(s.paperId))
      .map((s) => {
        const paperId = s.paperId as string;
        const claim = s.claim || '';
        const rawQuote = (s.quote || '').trim();
        if (!rawQuote) {
          return { paperId, claim, quote: undefined };
        }
        const paper = papers.find((p) => p.id === paperId);
        // 分歧引文同样必须过定位校验：页码一律来自定位结果，绝不采用模型自称的页码
        if (!paper || !paper.rawText) {
          const note = '尚未取回该论文全文，无法做定位校验；这里展示的是模型给出的引文片段，按「待核查」对待。';
          const ev: Evidence = {
            paperId,
            quote: rawQuote.slice(0, 500),
            locator: 'none',
            verified: false,
            verifyNote: note,
          };
          return { paperId, claim, quote: rawQuote, quoteEvidence: ev, quoteNote: note };
        }
        const ev = buildEvidence(paper, { quote: rawQuote });
        if (!ev) return { paperId, claim, quote: undefined };
        return {
          paperId,
          claim,
          // 定位成功时用原文切片（而不是模型给的字符串），失败时保留原字符串供人工核对
          quote: ev.verified ? ev.quote : rawQuote,
          page: ev.verified ? ev.page : undefined,
          quoteEvidence: ev,
          quoteNote: ev.verified ? undefined : (ev.verifyNote ?? '该引文未能在论文全文中定位。'),
        };
      }),
    claimType,
    commonScope,
    conditionDifferences: conditionDifferences.length ? conditionDifferences : undefined,
    explanation,
    nextAction: raw.nextAction || '回到原文核对相关结论与实验条件。',
    comparabilityLevel,
    ruleNotes: ruleNotes.length ? ruleNotes : undefined,
    disclaimer,
  };
}

/** 按当前论文集合重算「已检查的论文对」（比较页与分歧页共用） */
export function buildCheckedPairs(
  papers: Paper[],
  methods: Method[],
  titleOf: (paperId: string) => string,
): { pair: string; result: string }[] {
  const out: { pair: string; result: string }[] = [];
  for (let i = 0; i < methods.length; i++) {
    for (let j = i + 1; j < methods.length; j++) {
      const a = methods[i].paperId;
      const b = methods[j].paperId;
      const level = pairLevel(papers, methods, a, b);
      const diffs = differingDimensions(papers, methods, a, b);
      out.push({
        pair: `${titleOf(a)} ↔ ${titleOf(b)}`,
        result: `可比性=${LEVEL_LABELS[level]}${diffs.length ? `；条件差异：${diffs.map((d) => d.label).join('、')}` : ''}`,
      });
    }
  }
  return out;
}
