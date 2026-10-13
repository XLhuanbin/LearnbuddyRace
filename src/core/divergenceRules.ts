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
import { optionalArrayField, requireArrayOfObjects, requireStringArray } from './model/client';

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

/**
 * 只接受字符串字段。模型把标量写成数字/对象时，旧实现会在 `(raw.topic || '').trim()`、
 * `(raw.commonScope || '').trim()` 这类地方直接抛 TypeError；这里统一降级为「没有该内容」。
 * 注意：不做 String(v) 兜底 —— 那会把对象变成 "[object Object]" 之类的假内容。
 */
const asStr = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

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
  // 模型返回的内层数组字段一律先过结构校验：不是数组 → 明确失败（ModelError），
  // 而不是在下面直接 .filter 抛 TypeError（旧实现的实测表现：paperIds/sides/conditionDifferences
  // 传字符串时都会抛 "(raw.xxx || []).filter is not a function"）。
  // 校验放在本函数内而不是调用方：本模块同时被实时分析与 scripts/revalidate.mjs 复用。
  const rawObj = raw as unknown as Record<string, unknown>;
  const validPaperIds = new Set(methods.map((m) => m.paperId));
  const paperIds = requireStringArray(optionalArrayField(rawObj, 'paperIds', '分歧分析结果.findings') ?? [], '分歧分析结果.findings.paperIds').filter(
    (id) => validPaperIds.has(id),
  );
  const ruleNotes: string[] = [];

  const rawKind = (VALID_KINDS as readonly string[]).includes(raw.kind ?? '') ? (raw.kind as DivergenceFinding['kind']) : 'none_found';
  // 旧枚举名映射到更准确的表述：条件不一致 ≠ 「只能由条件差异解释」
  let finalKind: DivergenceFinding['kind'] = (rawKind as string) === 'condition_explained' ? 'condition_confounded' : rawKind;

  let explanation = asStr(raw.explanation);
  const claimType: 'numeric' | 'qualitative' | undefined =
    raw.claimType === 'numeric' || raw.claimType === 'qualitative' ? raw.claimType : undefined;
  const commonScope = asStr(raw.commonScope).trim() || undefined;

  let conditionDifferences: DivergenceFinding['conditionDifferences'] = requireArrayOfObjects(
    optionalArrayField(rawObj, 'conditionDifferences', '分歧分析结果.findings') ?? [],
    '分歧分析结果.findings.conditionDifferences',
  )
    .filter((d) => d.label || d.detail)
    .map((d) => ({
      dimension: asStr(d.dimension, 'experimentalSettings') as ConditionDimension,
      label: asStr(d.label) || asStr(d.dimension) || '条件',
      detail: asStr(d.detail),
    }));

  // 可比性一律由程序按论文对重算，**不采信模型自报值**。
  // 旧实现只在「论文对 >= 2」时才覆盖，于是 0/1 篇的发现会把模型自评的 comparable 原样透传给界面
  // （已复现）；而单篇论文根本不存在「论文对可比性」。现在默认就是「未知」，只有能组成论文对时才给结论。
  let comparabilityLevel: DivergenceFinding['comparabilityLevel'] = 'unknown';

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

  /**
   * 双方主张（sides）在这里就构建好，因为下面的结论分歧判定要用它。
   *
   * 每条主张都要过定位校验：引文的页码一律来自定位结果，不采信模型自称的页码；
   * 定位不通过时保留模型原引文并标 `verified: false`（供人工核对），绝不冒充已核验。
   */
  const builtSides = requireArrayOfObjects(
    optionalArrayField(rawObj, 'sides', '分歧分析结果.findings') ?? [],
    '分歧分析结果.findings.sides',
  )
    .filter((s) => typeof s.paperId === 'string' && validPaperIds.has(s.paperId))
    .map((s) => {
      const paperId = s.paperId as string;
      const claim = asStr(s.claim);
      const rawQuote = asStr(s.quote).trim();
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
    });

  if (finalKind === 'conclusion_divergence') {
    /**
     * === 结论分歧的成立条件（P1，已复现）===
     *
     * 旧实现只检查「论文数 ≥ 2」与「commonScope 非空」，于是
     * `sides=[]`、`claimType` 缺失时，只要 commonScope 有值就保留 `conclusion_divergence` ——
     * 一条**没有任何双方主张、没有证据、也不知道是数值还是定性**的发现，
     * 会被页面渲染成「存在结论分歧」。这是在替用户下研究结论，风险最高的一类错误。
     *
     * 现在要求**同时**满足：
     * ① 至少涉及两篇**不同**的论文；
     * ② 双方各自给出**明确主张**（claim 非空）；
     * ③ 各自的主张有**通过定位校验的证据**（引文能在原文中定位到）；
     * ④ 有可核对的共同范围（commonScope）；
     * ⑤ 明确主张类型（numeric / qualitative）。
     * 缺任意一条即不认定为「结论分歧」，并在 ruleNotes 里写明缺的是哪一条。
     */
    const sidePapers = new Set(builtSides.map((s) => s.paperId));
    const strongSides = builtSides.filter((s) => (s.claim ?? '').trim().length > 0 && s.quoteEvidence?.verified === true);
    const weakSides = builtSides.filter((s) => !((s.claim ?? '').trim().length > 0 && s.quoteEvidence?.verified === true));

    if (paperIds.length < 2 || sidePapers.size < 2) {
      finalKind = 'none_found';
      ruleNotes.push('缺少双方主张：结论分歧需要至少两篇**不同**论文各自的主张，当前不满足。');
      explanation = `缺少双方主张（或双方主张落在同一篇论文上），未认定为结论分歧。${explanation ? `模型说明：${explanation}` : ''}`;
    } else if (!commonScope) {
      finalKind = 'none_found';
      ruleNotes.push('缺少双方主张的共同对象/范围，无法确认两者在比较同一件事，因此不认定为分歧。');
      explanation = `缺少共同比较范围，未认定为分歧。${explanation ? `模型说明：${explanation}` : ''}`;
    } else if (!claimType) {
      finalKind = 'none_found';
      ruleNotes.push(
        '缺少主张类型（claimType）：未说明这是数值结果层面的差异还是定性主张层面的分歧，无法用对应规则核实，因此不认定为结论分歧。',
      );
      explanation = `缺少主张类型（数值 / 定性），未认定为结论分歧。${explanation ? `模型说明：${explanation}` : ''}`;
    } else if (strongSides.length < 2 || weakSides.length > 0) {
      finalKind = 'none_found';
      ruleNotes.push(
        `结论分歧要求双方各自的主张都有能在原文中定位到的证据；当前 ${builtSides.length} 条主张中只有 ${strongSides.length} 条满足（主张文字与引文定位都需要通过）。`,
      );
      explanation = `双方主张的证据不足，未认定为结论分歧。${explanation ? `模型说明：${explanation}` : ''}`;
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
    topic: asStr(raw.topic) || '未命名主题',
    paperIds,
    // 双方主张在上面的结论分歧判定之前就已构建（含引文定位校验）
    sides: builtSides,
    claimType,
    commonScope,
    conditionDifferences: conditionDifferences.length ? conditionDifferences : undefined,
    explanation,
    nextAction: asStr(raw.nextAction) || '回到原文核对相关结论与实验条件。',
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
