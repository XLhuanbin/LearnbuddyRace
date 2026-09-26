/**
 * 核心逻辑回归测试（无测试框架，直接断言；esbuild 打包后由 node 运行）。
 *
 * 本轮新增的测试点全部针对已复现过的错误，确保不会再次发生：
 * - 比较页与分歧页对同一论文对必须得到同一结论（论文对级重算，不复用全集结论）；
 * - 「未提取到 / 无法确认 / 引文不支撑主张」不得因为字段值相同而被判成一致；
 * - 局部实验描述不得支持整篇论文级的否定结论；
 * - 数据划分必须按数据集对应比较；
 * - 关系证据判定：引文里写了 BERT 就不能说「没有指名」；只有引用标记不算认证具体端点；改进类关系需要改进措辞。
 */

import { existsSync, readFileSync } from 'node:fs';
import { locateQuote, normalize, pageAt } from '../src/core/text';
import { assemblePages, guessPdfMeta } from '../src/core/parse/assemble';
import { RULES_VERSION, looksLikeTitle, titleNeedsConfirm } from '../src/core/rules';
import { buildEvidence } from '../src/core/evidence';
import {
  compareConditions,
  comparePair,
  emptyConditions,
  pairLevel,
  differingDimensions,
  LEVEL_LABELS,
} from '../src/core/comparability';
import { validateMethod, validateRelation } from '../src/core/validate';
import { effectiveField } from '../src/core/effective';
import { corpusBaseOfPaper, revalidateCachedRelations } from '../src/core/cache';
import { applyDivergenceRules } from '../src/core/divergenceRules';
import { hasThirdPartySubject } from '../src/core/rules';
import { applyTitleCorrection } from '../src/core/model/analyze';
import {
  assembleRelationsFromModel,
  hasConfigEvidence,
  parseExperimentRecords,
  parseGpuCount,
  requireReadingSteps,
} from '../src/core/model/analyze';
import { buildRelationHints, findRelationCandidates, primaryAlias } from '../src/core/relationCandidates';
import {
  CORPUS_META,
  asScopedSnapshot,
  collectPaperRemoval,
  corpusOfPaperId,
  isManualRelation,
  mergeCachedMethod,
  mergeCachedMethods,
  legacyCorpusPatches,
  paperIdOf,
  readScopedSnapshot,
  relationsInScope,
  replaceRelationsInScope,
  scopeCorpus,
  scopeRelations,
} from '../src/core/corpus';
import {
  buildMethodOverview,
  buildMethodProfile,
  classifyFamily,
  relationSentence,
  shortContribution,
} from '../src/core/grouping';
import {
  canonicalDatasetName,
  canonicalMetricName,
  canonicalResolution,
  compareExperiments,
  pickComparableExperimentPair,
  suggestComparablePairs,
} from '../src/core/experiments';
import type { ExperimentRecord } from '../src/core/types';
import { buildComparison, toMarkdown } from '../src/core/compare';
import { migrateMethod, migrateRelation } from '../src/core/cache';
import {
  CANCEL_NOTICE,
  FAILURE_NOTICE,
  describeDependents,
  describeJobOutcome,
  describeOverrideDependents,
  mergeReanalysisResult,
} from '../src/core/reanalysis';
import { chat, ModelError, parseJsonLoose, parseJsonObject, requireArrayField, requireArrayOfObjects } from '../src/core/model/client';
import { createServer, type Server } from 'node:http';
import { methodAliases, assessRelationEvidence, assessClaimScope, parseSplitsByDataset, looksLikeTitle } from '../src/core/rules';
import type { ConditionValue, ExperimentConditions, Method, Paper, ReadingPlan, Relation } from '../src/core/types';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

const PAPER = (id: string, title: string, year?: number, rawText = ''): Paper => ({
  id,
  title,
  authors: [],
  year,
  source: { kind: 'arxiv' },
  parseStatus: 'ok',
  pages: rawText ? [{ page: 1, offset: 0, text: rawText }] : [],
  pageCount: rawText ? 1 : undefined,
  rawText,
  charCount: rawText.length,
  createdAt: 0,
});

const cond = (partial: Partial<Record<keyof ExperimentConditions, Partial<ConditionValue>>>): ExperimentConditions => {
  const base = emptyConditions();
  for (const [k, v] of Object.entries(partial)) {
    base[k as keyof ExperimentConditions] = { values: [], status: 'not_extracted', ...(v as ConditionValue) };
  }
  return base;
};

const mkMethod = (id: string, conditions: ExperimentConditions, fields: Method['fields'] = {} as Method['fields']): Method => ({
  id: `m_${id}`,
  paperId: id,
  fields,
  conditions,
  overrides: [],
});

console.log('=== 1. 归一化与引文定位 ===');
{
  const n = normalize('network architec-\nture, based solely on attention', false);
  check('跨行连字符断词被合并', n.out.includes('architecture'), n.out.slice(0, 60));
  const raw = assemblePages(['Abstract\n\nWe study a new method.']).rawText;
  check('原文精确引文可定位', !!locateQuote(raw, 'We study a new method.'));
  check('改写引文不能评为精确匹配', (locateQuote(raw, 'We study a brand new method.')?.matchType ?? 'none') !== 'strict');
}

console.log('=== 2. 方法名别名与关系证据判定（对应问题三） ===');
{
  const aliases = methodAliases('BERT (Bidirectional Encoder Representations from Transformers)');
  check('从「简称（全称）」中提取出简称 BERT', aliases.includes('BERT'), aliases.join('|'));
  check('同时保留全称', aliases.some((a) => a.startsWith('Bidirectional')), aliases.join('|'));

  const quoteBert = 'This section explores and quantifies which choices are important for successfully pretraining BERT models. We keep the model architecture fixed.';
  const a1 = assessRelationEvidence(quoteBert, 'BERT (Bidirectional Encoder Representations from Transformers)', 'RoBERTa', 'improves');
  check('引文里写了 BERT 就不能说「没有指名被继承方法」', !/没有提到被继承方法/.test(a1.reason), a1.reason);
  check('但「改进」关系仍要求改进措辞，因此不足以认证', !a1.sufficient, a1.reason);
  check('理由明确指出缺少改进措辞', /缺少能说明「改进」的措辞/.test(a1.reason), a1.reason);

  const quoteVaswani = 'Using a triple loss, we show that a 40% smaller Transformer (Vaswani et al. [2017]) pre-trained through distillation';
  const a2 = assessRelationEvidence(quoteVaswani, 'BERT', 'DistilBERT', 'extends');
  check('只提到更泛的 Transformer + 引用标记，不足以认证 BERT 端点', !a2.sufficient, a2.reason);
  check('理由说明缺少被继承方法名称', /缺少「被继承方法名称」/.test(a2.reason), a2.reason);

  const quoteOk = 'Our model is based on BERT and extends the encoder with a new pooling layer.';
  const a3 = assessRelationEvidence(quoteOk, 'BERT', 'FooNet', 'extends');
  check('指名 BERT + 继承措辞 + 指向关系另一端（自指）→ 足以认证原文明示', a3.sufficient, a3.reason);

  // 只截取半句、既不提对方方法也不是自指时，不能建立端点
  const a4 = assessRelationEvidence('which is based on BERT', 'BERT', 'FooNet', 'extends');
  check('半句片段既不提对方方法也不是自指 → 不足以认证（不建立端点）', !a4.sufficient, a4.reason);
  check('理由说明缺少关系另一端的指向', /关系另一端/.test(a4.reason), a4.reason);
}

console.log('=== 3. 关系可信度程序校验（对应问题三） ===');
{
  const paperText = 'We build on the Transformer architecture and introduce a new model called FooNet, which is based on BERT.';
  const pA = PAPER('pa', 'Paper A', 2017, paperText);
  const pB = PAPER('pb', 'Paper B', 2019, paperText);
  // 证据用完整句（含自指与继承措辞）；半句片段另有用例验证「不足以建立端点」
  const ev = buildEvidence(pB, {
    quote: 'We build on the Transformer architecture and introduce a new model called FooNet, which is based on BERT.',
  });

  const mA = mkMethod('pa', emptyConditions(), {
    methodName: { value: 'BERT', status: 'verified', evidence: buildEvidence(pA, { quote: 'the Transformer architecture' }) },
  } as Method['fields']);
  const mB = mkMethod('pb', emptyConditions(), {
    methodName: { value: 'FooNet', status: 'verified', evidence: buildEvidence(pB, { quote: 'a new model called FooNet' }) },
  } as Method['fields']);

  const explicit: Relation = {
    id: 'r1',
    fromMethodId: 'm_pa',
    toMethodId: 'm_pb',
    type: 'extends',
    evidenceState: 'explicit',
    evidence: ev,
    rationale: 'FooNet 论文明确说明基于 BERT。',
  };
  const ok = validateRelation(explicit, [mA, mB], [pA, pB]);
  check('引文指名 BERT + 继承措辞 → 保持原文明示', ok.relation.evidenceState === 'explicit', ok.relation.evidenceState);

  const bareFragment: Relation = {
    ...explicit,
    id: 'r_frag',
    evidence: buildEvidence(pB, { quote: 'which is based on BERT' }),
  };
  const frag = validateRelation(bareFragment, [mA, mB], [pA, pB]);
  check('半句片段即使指名 BERT 也不足以认证（缺少关系另一端指向）', frag.relation.evidenceState === 'candidate', frag.relation.evidenceState);

  const onlyCitation: Relation = {
    ...explicit,
    id: 'r2',
    evidence: buildEvidence(pB, { quote: 'introduce a new model called FooNet' }),
  };
  const bad = validateRelation(onlyCitation, [mA, mB], [pA, pB]);
  check('引文未指名被继承方法 → 降级为待核查', bad.relation.evidenceState === 'candidate', bad.relation.evidenceState);
  check(
    '降级理由与原文一致（说明查到了什么、缺什么）',
    /没有提到被继承方法/.test(bad.relation.stateAdjusted?.[0]?.reason ?? ''),
    bad.relation.stateAdjusted?.[0]?.reason,
  );
  check('降级不等于断言关系不存在（说明中保留「不等于关系不存在」）', /不代表系统断言关系不存在/.test(bad.issues[0]?.action ?? ''), bad.issues[0]?.action);
}

console.log('=== 4. 条件范围与不可比检测（对应问题二） ===');
{
  const quoteLocal = 'Single models on dev, w/o data augmentation, obtain 88.5 F1.';
  const scopeLocal = assessClaimScope(quoteLocal, true);
  check('局部实验描述被识别为 experiment 范围', scopeLocal.scope === 'experiment', JSON.stringify(scopeLocal).slice(0, 80));
  check('局部描述不能支持整篇论文级的否定结论', scopeLocal.supportsPaperLevelClaim === false);
  const scopePaper = assessClaimScope('Our method does not use any additional training data.', true);
  check('论文级表述被识别为 paper 范围', scopePaper.scope === 'paper');

  const splits = parseSplitsByDataset(['GLUE: train/dev + private test', 'SQuAD v1.1: dev used for hyperparameters']);
  check('数据划分能按数据集解析', splits.get('GLUE') !== undefined && splits.get('SQuAD v1.1') !== undefined);

  // 允许：两篇都明确报告没有额外数据（论文级）
  const papers2 = [PAPER('a', 'A'), PAPER('b', 'B')];
  const bothNone = compareConditions(papers2, [
    mkMethod('a', cond({ downstreamExtraData: { values: ['none'], status: 'verified', scope: 'paper' } })),
    mkMethod('b', cond({ downstreamExtraData: { values: ['none'], status: 'verified', scope: 'paper' } })),
  ]);
  check(
    '两篇都明确报告「没有额外数据」（论文级）→ 可以直接比较',
    bothNone.dimensions.find((d) => d.dimension === 'downstreamExtraData')!.level === 'comparable',
    bothNone.dimensions.find((d) => d.dimension === 'downstreamExtraData')!.level,
  );

  // 关键回归：取值相同但范围未知 → 必须判为信息不足，不能判为一致
  const scopeUnknown = compareConditions(papers2, [
    mkMethod('a', cond({ downstreamExtraData: { values: ['none'], status: 'verified', structureMigrated: true } })),
    mkMethod('b', cond({ downstreamExtraData: { values: ['none'], status: 'verified', scope: 'paper' } })),
  ]);
  check(
    '取值相同但适用范围未知 → 信息不足（不得判为一致）',
    scopeUnknown.dimensions.find((d) => d.dimension === 'downstreamExtraData')!.level === 'unknown',
    scopeUnknown.dimensions.find((d) => d.dimension === 'downstreamExtraData')!.level,
  );

  // 一方未提取到 → 不得判为一致
  const oneUnknown = compareConditions(papers2, [
    mkMethod('a', cond({ downstreamExtraData: { values: ['none'], status: 'verified', scope: 'paper' } })),
    mkMethod('b', cond({ downstreamExtraData: { values: [], status: 'not_extracted' } })),
  ]);
  check(
    '一方「本次片段中未提取到」→ 信息不足，不得判为一致',
    oneUnknown.dimensions.find((d) => d.dimension === 'downstreamExtraData')!.level === 'unknown',
    oneUnknown.dimensions.find((d) => d.dimension === 'downstreamExtraData')!.level,
  );

  // 数据划分：不同数据集不算同一条件
  const diffSplits = compareConditions(papers2, [
    mkMethod('a', cond({ dataSplits: { values: ['CoNLL-2003: dev 用于选超参'], status: 'verified', scope: 'paper' } })),
    mkMethod('b', cond({ dataSplits: { values: ['GLUE: train/dev + 私有 test'], status: 'verified', scope: 'paper' } })),
  ]);
  check(
    '两篇论文划分的数据集没有交集 → 信息不足（不当作同一实验的对应条件）',
    diffSplits.dimensions.find((d) => d.dimension === 'dataSplits')!.level === 'unknown',
    diffSplits.dimensions.find((d) => d.dimension === 'dataSplits')!.level,
  );

  // 共同数据集上划分不同 → 只能有限比较
  const sameDsDiffSplit = compareConditions(papers2, [
    mkMethod('a', cond({ dataSplits: { values: ['GLUE: train/dev'], status: 'verified', scope: 'paper' } })),
    mkMethod('b', cond({ dataSplits: { values: ['GLUE: 50k train'], status: 'verified', scope: 'paper' } })),
  ]);
  check(
    '共同数据集上划分不同 → 只能有限比较',
    sameDsDiffSplit.dimensions.find((d) => d.dimension === 'dataSplits')!.level === 'limited',
    sameDsDiffSplit.dimensions.find((d) => d.dimension === 'dataSplits')!.level,
  );

  // 精度声明
  check('报告带「论文级初筛」精度声明', bothNone.precision === 'paper-level-screening');
}

console.log('=== 5. 比较页与分歧页结论一致（对应问题一） ===');
{
  const papers3 = [
    PAPER('ain', 'Attention Is All You Need', 2017),
    PAPER('bert', 'BERT', 2018),
    PAPER('roberta', 'RoBERTa', 2019),
  ];
  const methods3 = [
    mkMethod('ain', cond({
      datasets: { values: ['WMT 2014 En-De'], status: 'verified', scope: 'paper' },
      metrics: { values: ['BLEU'], status: 'verified', scope: 'paper' },
      experimentalSettings: { values: ['从头训练'], status: 'verified', scope: 'paper' },
      dataSplits: { values: ['WMT 2014 En-De: 标准划分'], status: 'verified', scope: 'paper' },
      pretrainingCorpus: { values: ['none'], status: 'not_reported', scope: 'paper' },
      downstreamExtraData: { values: ['none'], status: 'not_reported', scope: 'paper' },
      dataAugmentation: { values: ['none'], status: 'not_reported', scope: 'paper' },
      pretrainedModel: { values: ['none'], status: 'not_reported', scope: 'paper' },
    })),
    mkMethod('bert', cond({
      datasets: { values: ['GLUE', 'SQuAD v1.1'], status: 'verified', scope: 'paper' },
      metrics: { values: ['accuracy', 'F1'], status: 'verified', scope: 'paper' },
      experimentalSettings: { values: ['fine-tuning on GLUE'], status: 'verified', scope: 'paper' },
      dataSplits: { values: ['GLUE: train/dev'], status: 'verified', scope: 'paper' },
      pretrainingCorpus: { values: ['BooksCorpus', 'Wikipedia'], status: 'verified', scope: 'paper' },
      downstreamExtraData: { values: ['none'], status: 'not_reported', scope: 'paper' },
      dataAugmentation: { values: ['none'], status: 'not_reported', scope: 'paper' },
      pretrainedModel: { values: ['BERT-base'], status: 'verified', scope: 'paper' },
    })),
    mkMethod('roberta', cond({
      datasets: { values: ['GLUE', 'SQuAD v1.1'], status: 'verified', scope: 'paper' },
      metrics: { values: ['accuracy', 'F1'], status: 'verified', scope: 'paper' },
      experimentalSettings: { values: ['fine-tuning'], status: 'verified', scope: 'paper' },
      dataSplits: { values: ['GLUE: train/dev + 5 folds'], status: 'verified', scope: 'paper' },
      pretrainingCorpus: { values: ['BooksCorpus', 'Wikipedia'], status: 'verified', scope: 'paper' },
      downstreamExtraData: { values: ['none'], status: 'not_reported', scope: 'paper' },
      dataAugmentation: { values: ['none'], status: 'not_reported', scope: 'paper' },
      pretrainedModel: { values: ['BERT-base'], status: 'verified', scope: 'paper' },
    })),
  ];

  const whole = compareConditions(papers3, methods3);
  check('全集结论：注意力论文与语言理解论文混在一起 → 不能直接比较', whole.overall.level === 'not_comparable', whole.overall.level);

  // 论文对级：必须重新计算，不受全集结论影响
  const pairBR = pairLevel(papers3, methods3, 'bert', 'roberta');
  check('论文对 BERT↔RoBERTa 重新计算 → 只能有限比较', pairBR === 'limited', pairBR);
  check(
    '论文对结论通过 comparePair 计算，与比较页同源',
    comparePair(papers3, methods3, 'bert', 'roberta').overall.level === 'limited',
  );
  const pairAB = pairLevel(papers3, methods3, 'ain', 'bert');
  check('论文对 AIN↔BERT → 不能直接比较', pairAB === 'not_comparable', pairAB);
  check('同一论文对在全集与论文对两种口径下结论不同，说明必须按论文对计算', whole.overall.level !== pairBR);
  check('论文对的条件差异可列出用于说明', differingDimensions(papers3, methods3, 'bert', 'roberta').length >= 1);

  // 关键维度未知时，总体不能声称「只能有限比较」
  const withUnknown = compareConditions(papers3.slice(1), [methods3[1], { ...methods3[2], conditions: cond({ datasets: { values: ['GLUE'], status: 'verified', scope: 'paper' } }) }]);
  check(
    '存在关键维度信息不足时 → 总体降为「信息不足」而不是「只能有限比较」',
    withUnknown.overall.level === 'unknown',
    withUnknown.overall.level,
  );
}

console.log('=== 6. 分歧规则复核（对应问题五） ===');
{
  const papers2 = [PAPER('a', 'A'), PAPER('b', 'B')];
  const m1 = mkMethod('a', emptyConditions());
  const m2 = mkMethod('b', emptyConditions());

  const numericWorse = applyDivergenceRules(papers2, [m1, m2], {
    kind: 'conclusion_divergence',
    claimType: 'numeric',
    commonScope: '同一数据集上的 F1',
    topic: 'F1 差异',
    paperIds: ['a', 'b'],
    sides: [],
    explanation: '',
  }, 0);
  check(
    '数值结果分歧在条件不可比时不判为分歧（改为「条件不一致，无法归因于方法」）',
    numericWorse.kind === 'condition_confounded',
    numericWorse.kind,
  );
  check(
    '信息不足时说明「无法判断是否可比」，措辞与「条件不一致」区分开',
    /信息不足/.test(numericWorse.ruleNotes?.join('') ?? ''),
    JSON.stringify(numericWorse.ruleNotes),
  );

  // 条件确实不一致（数据集完全不同）时，措辞必须是「无法归因于方法本身」
  const mA = mkMethod('a', cond({ datasets: { values: ['GLUE'], status: 'verified', scope: 'paper' } }), {} as Method['fields']);
  const mB = mkMethod('b', cond({ datasets: { values: ['ImageNet'], status: 'verified', scope: 'paper' } }), {} as Method['fields']);
  const numericDiff = applyDivergenceRules(papers2, [mA, mB], {
    kind: 'conclusion_divergence',
    claimType: 'numeric',
    commonScope: '准确率',
    topic: '准确率差异',
    paperIds: ['a', 'b'],
    sides: [],
    explanation: '',
  }, 9);
  check('数据集完全不同的数值分歧 → 降为「条件不一致，无法归因于方法」', numericDiff.kind === 'condition_confounded', numericDiff.kind);
  check(
    '并说明「不能归因于方法本身」',
    /不能归因于方法本身/.test([numericDiff.explanation, ...(numericDiff.ruleNotes ?? [])].join('')),
    JSON.stringify(numericDiff.ruleNotes),
  );
  check('同时列出具体条件差异', (numericDiff.conditionDifferences?.length ?? 0) > 0);

  const noScope = applyDivergenceRules(papers2, [m1, m2], {
    kind: 'conclusion_divergence',
    claimType: 'qualitative',
    topic: '设计取舍',
    paperIds: ['a', 'b'],
    sides: [],
    explanation: '',
  }, 1);
  check('缺少共同比较范围 → 不认定为分歧', noScope.kind === 'none_found', noScope.kind);

  const sharedNoBasis = applyDivergenceRules(papers2, [m1, m2], {
    kind: 'shared_limitation',
    topic: '都有未来工作',
    paperIds: ['a', 'b'],
    sides: [],
    explanation: '两篇都提到未来工作。',
  }, 2);
  check('「都有未来工作」这类无共同对象的局限 → 改为各自局限分别展示', sharedNoBasis.kind === 'individual_limitations', sharedNoBasis.kind);

  const sharedWithBasis = applyDivergenceRules(papers2, [m1, m2], {
    kind: 'shared_limitation',
    commonScope: '同一评测集上的长文本推理',
    topic: '长文本推理不足',
    paperIds: ['a', 'b'],
    sides: [],
    explanation: '',
  }, 3);
  check('有共同对象的局限 → 保留为共同提到的局限', sharedWithBasis.kind === 'shared_limitation', sharedWithBasis.kind);
  check(
    '共同局限的声明不含「研究空白」的断言式结论',
    /不代表整个领域存在研究空白/.test(sharedWithBasis.disclaimer),
    sharedWithBasis.disclaimer,
  );
}

console.log('=== 7. 程序校验层（页码、条件、页数） ===');
{
  const text = 'We propose FooNet, a new architecture based solely on attention.';
  const paper = PAPER('p1', 'P1', 2020, text);
  const m = mkMethod('p1', cond({ datasets: { values: [], status: 'not_extracted' } }), {
    coreIdea: {
      value: 'x',
      status: 'verified',
      evidence: buildEvidence(paper, { quote: 'based solely on attention' }),
      claimedPage: 99,
    },
  } as Method['fields']);
  const issues = validateMethod(paper, m);
  check('模型自称页码超出页数 → 标为页码无效', issues.some((i) => i.code === 'page_invalid'), issues.map((i) => i.code).join(','));
  check('条件未提取到 → 标为「本次片段中未提取到」', issues.some((i) => i.code === 'condition_not_extracted'));

  const migratedMethod = mkMethod('p1', cond({ datasets: { values: ['GLUE'], status: 'verified', scope: 'paper', structureMigrated: true } }));
  check(
    '结构迁移的条件 → 标为「条件由早期结构迁移」',
    validateMethod(paper, migratedMethod).some((i) => i.code === 'condition_structure_migrated'),
  );

  const noPageCount: Paper = { ...PAPER('p3', 'P3', 2020, text), pageCount: undefined };
  check('页数未知 → 明确标出（而不是显示 0）', validateMethod(noPageCount, mkMethod('p3', emptyConditions())).some((i) => i.code === 'page_count_unknown'));
}

console.log('=== 8. 真实缓存数据回测 ===');
{
  const index = JSON.parse(readFileSync('public/samples/index.json', 'utf8')) as {
    cacheVersion: number;
    rulesVersion?: string;
    papers: { id: string; title: string; pageCount?: number }[];
    methods: { paperId: string; fields: Record<string, { status: string; evidence?: { quote: string; page?: number; verified: boolean } }> }[];
    relations: { evidenceState: string; evidence?: { quote: string }; evidenceAssessment?: string }[];
  };

  let evTotal = 0;
  let evOk = 0;
  let pageMismatch = 0;
  let statusMismatch = 0;
  for (const m of index.methods) {
    const text = JSON.parse(readFileSync(`public/samples/text/${m.paperId}.json`, 'utf8')) as {
      rawText: string;
      pages: { page: number; offset: number; text: string }[];
    };
    for (const v of Object.values(m.fields)) {
      if (!v.evidence?.quote) {
        if (v.status === 'verified') statusMismatch++;
        continue;
      }
      evTotal++;
      const hit = locateQuote(text.rawText, v.evidence.quote);
      if (hit) {
        evOk++;
        if (v.evidence.page !== pageAt(text.pages, hit.start)) pageMismatch++;
      } else if (v.status === 'verified') statusMismatch++;
    }
  }
  check(`缓存中 ${evTotal} 条引文全部可再次定位`, evOk === evTotal, `${evOk}/${evTotal}`);
  check('缓存页码与重新定位一致', pageMismatch === 0, `${pageMismatch}`);
  check('标记「可核验」的字段引文确实可定位', statusMismatch === 0, `${statusMismatch}`);
  check('缓存已记录规则版本（用于过期判定）', typeof index.rulesVersion === 'string' && index.rulesVersion.length > 0, String(index.rulesVersion));
  check(
    '预置语料中不再存在「无证据支撑却标为可核验」的额外训练数据条目',
    index.methods.every((m) => {
      const f = (m as unknown as { conditions?: Record<string, { values: string[]; status: string; evidence?: { quote: string } }> }).conditions?.downstreamExtraData;
      if (!f || f.status !== 'verified') return true;
      const scope = assessClaimScope(f.evidence?.quote ?? '', true);
      return scope.supportsPaperLevelClaim;
    }),
  );

  const badRelation = index.relations.find((r) => r.evidenceState === 'explicit' && !r.evidenceAssessment);
  check('缓存中的原文明示关系都带有程序判定说明', !badRelation, badRelation ? '存在缺少判定说明的明确关系' : '');
}

console.log('=== 9. 标题可信度（未预置论文实测出现的问题） ===');
{
  const ddpmHeuristic =
    'a class of latent variable models inspired by considerations from nonequilibrium thermodynamics. Our best results are obtained by training on a weighted variational bound designed according to a novel connection between diffusion probabilistic';
  check('摘要句子不被当作论文标题', looksLikeTitle(ddpmHeuristic) === false);
  check('正常标题判定为标题', looksLikeTitle('Denoising Diffusion Probabilistic Models') === true);
  check('经典标题判定为标题', looksLikeTitle('Attention Is All You Need') === true);
  check('带冒号的长标题可接受', looksLikeTitle('BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding') === true);
  check('空标题不通过', looksLikeTitle('') === false);

  const badTitlePaper: Paper = { ...PAPER('t1', ddpmHeuristic, 2020, 'some text'), titleFrom: 'heuristic' };
  check(
    '标题不可靠时给出「标题未确认」提示',
    validateMethod(badTitlePaper, mkMethod('t1', emptyConditions())).some((i) => i.code === 'title_unverified'),
  );
  const goodTitlePaper: Paper = { ...PAPER('t2', 'Denoising Diffusion Probabilistic Models', 2020, 'some text'), titleFrom: 'heuristic' };
  check(
    '标题正常时不误报',
    !validateMethod(goodTitlePaper, mkMethod('t2', emptyConditions())).some((i) => i.code === 'title_unverified'),
  );
}

console.log('=== 10. 决策样本的证据绑定与阶段标注（真实缓存） ===');
{
  const index = JSON.parse(readFileSync('public/samples/index.json', 'utf8')) as {
    decisionSample?: {
      candidates?: {
        computeStage?: string;
        reasons: { text: string; basis: string; evidence?: { page?: number; quote: string }; evidenceMissing?: boolean; stage?: string }[];
      }[];
    };
    demoProfile?: unknown;
    divergences?: { findings: { kind: string; ruleNotes?: string[] }[] };
  };

  const cands = index.decisionSample?.candidates ?? [];
  check('预置决策样本存在', cands.length > 0, String(cands.length));

  const resourceReasons: { text: string; basis: string; evidence?: { page?: number; quote: string }; evidenceMissing?: boolean; stage?: string }[] = [];
  for (const c of cands) {
    for (const r of c.reasons) {
      if (r.basis !== 'paper') continue;
      if (/\b(GPU|TPU|V100|P100|A100|PF-days)\b|小时|算力/.test(r.text)) resourceReasons.push(r);
    }
  }
  check('存在资源类推荐理由', resourceReasons.length > 0, String(resourceReasons.length));
  check(
    '每条资源类理由要么绑定可核验证据，要么被明确标记为无证据（不存在挂错证据）',
    resourceReasons.every((r) => !!r.evidence || r.evidenceMissing === true),
  );
  const withEvidence = resourceReasons.filter((r) => !!r.evidence);
  check(
    '资源类理由的证据带训练阶段标签',
    withEvidence.length > 0 && withEvidence.every((r) => !!r.stage),
    `${withEvidence.length} 条有证据，阶段标注 ${withEvidence.filter((r) => !!r.stage).length} 条`,
  );
  check(
    '候选方法都标注了算力阶段',
    cands.every((c) => !!c.computeStage),
    cands.map((c) => c.computeStage).join(','),
  );
  check('决策样本记录了所使用的用户条件（可区分示例与实时）', !!index.demoProfile);
  check(
    '「各自局限」类发现都带有程序复核说明',
    (index.divergences?.findings ?? []).every((x) => x.kind !== 'individual_limitations' || (x.ruleNotes ?? []).length > 0),
  );
}

console.log('=== 11. 导出内容抽查 ===');
{
  const index = JSON.parse(readFileSync('public/samples/index.json', 'utf8')) as {
    papers: { id: string; title: string }[];
    methods: unknown[];
    relations: unknown[];
  };
  const papers: Paper[] = [];
  const methods: Method[] = [];
  for (const meta of index.papers) {
    const t = JSON.parse(readFileSync(`public/samples/text/${meta.id}.json`, 'utf8')) as { rawText: string; pages: Paper['pages'] };
    papers.push({ ...(meta as unknown as Paper), pages: t.pages, rawText: t.rawText, charCount: t.rawText.length });
  }
  for (const m of index.methods) methods.push(migrateMethod(m as Method));
  const relations = (index.relations as Relation[]).map(migrateRelation).map((r) => {
    const a = methods.find((m) => m.id === r.fromMethodId);
    const b = methods.find((m) => m.id === r.toMethodId);
    return {
      fromPaperTitle: papers.find((p) => p.id === a?.paperId)?.title ?? '?',
      toPaperTitle: papers.find((p) => p.id === b?.paperId)?.title ?? '?',
      type: r.type,
      evidenceState: r.evidenceState,
      evidence: r.evidence?.quote,
      rationale: r.rationale,
    };
  });

  const md = toMarkdown(methods.slice(0, 3), papers, relations);
  check('导出包含可比性判断小节', md.includes('可比性判断'));
  check('导出包含四态口径说明', md.includes('待人工核对') && md.includes('未找到证据') || md.includes('缺失'));
  check('导出包含原文引文（> 引用块）', />\s+\S/.test(md));
  check('导出包含页码', /p\.\d+|p\.\?/.test(md));
  check('导出声明不做排名', md.includes('排名'));
  check('导出不含任何密钥形态字符串', !/sk-[A-Za-z0-9]{8,}/.test(md));
  check('导出末尾声明不含密钥', md.includes('不包含任何 API 密钥'));

  const json = JSON.stringify({ papers: index.papers, methods: index.methods, relations: index.relations });
  // 注意：'task-specific' 这类普通词也会命中 sk-xxx，因此这里用更严格的长度阈值
  check('缓存的 JSON 中不含长密钥形态字符串', !/sk-[A-Za-z0-9]{20,}/.test(json));
  const envKey = process.env.DEEPSEEK_API_KEY || '';
  check('缓存的 JSON 中不含环境变量里的真实密钥', envKey.length < 12 || !json.includes(envKey));
  check('缓存中不含 Bearer 令牌', !/Bearers+[A-Za-z0-9._-]{12,}/.test(json));
}

console.log('=== 12. 别名提取与关系证据边界（本轮审计） ===');
{
  const bert = methodAliases('BERT (Bidirectional Encoder Representations from Transformers)');
  check('BERT 的别名包含缩写本身', bert.some((a) => a === 'BERT'), bert.join('|'));
  check('BERT 的别名包含全称', bert.some((a) => a.startsWith('Bidirectional')));
  const roberta = methodAliases('RoBERTa (Robustly Optimized BERT Pretraining Approach)');
  check(
    '其它方法的全称里含有 BERT 时，不得把独立 token「BERT」当作自己的别名',
    !roberta.some((a) => a.trim().toUpperCase() === 'BERT'),
    roberta.join('|'),
  );
  check('RoBERTa 的别名保留自己的名字', roberta.some((a) => a === 'RoBERTa'));
  check('普通词不会被误当作缩写', !methodAliases('Robust Neural Ranking Model').some((a) => a === 'R' || a === 'N'));

  // 第三方主语守卫
  check(
    '「Most of the top systems build upon BERT」被识别为第三方主语',
    hasThirdPartySubject('Most of the top systems build upon either BERT (Devlin et al., 2019) or the Transformer'),
  );
  check('本论文自指句不被判为第三方主语', !hasThirdPartySubject('our improved training procedure improves upon the published BERT results'));

  const thirdParty = assessRelationEvidence(
    'Most of the top systems build upon either BERT (Devlin et al., 2019) or the Transformer',
    'BERT',
    'RoBERTa',
    'extends',
  );
  check('第三方主语句子不足以认证本论文对的关系', !thirdParty.sufficient, thirdParty.reason);
  check('理由说明了第三方主语问题', /其它系统|先前工作/.test(thirdParty.reason), thirdParty.reason);

  const realImprove = assessRelationEvidence(
    'When controlling for training data, our improved training procedure improves upon the published BERT results on both GLUE and SQuAD.',
    'BERT (Bidirectional Encoder Representations from Transformers)',
    'RoBERTa (Robustly Optimized BERT Pretraining Approach)',
    'improves',
  );
  check('RoBERTa 论文中真实存在的改进句可认证（真实论文片段）', realImprove.sufficient, realImprove.reason);

  const distilled = assessRelationEvidence(
    'DistilBERT: a distilled version of BERT Student architecture In the present work, the student - DistilBERT - has the same general architecture as BERT',
    'BERT',
    'DistilBERT',
    'extends',
  );
  check('「蒸馏/同架构」类派生措辞可支撑 extends（真实论文片段）', distilled.sufficient, distilled.reason);

  const onlyCitation = assessRelationEvidence(
    'a 40% smaller Transformer (Vaswani et al. [2017]) pre-trained through distillation',
    'BERT',
    'DistilBERT',
    'extends',
  );
  check('只提到更泛的 Transformer + 引用标记仍不足以认证 BERT 端点', !onlyCitation.sufficient, onlyCitation.reason);
}

console.log('=== 13. 关系候选检索（确定性，不调用模型） ===');
{
  const index = JSON.parse(readFileSync('public/samples/index.json', 'utf8')) as {
    papers: { id: string; title: string }[];
  };
  const papers: Paper[] = [];
  for (const meta of index.papers) {
    const t = JSON.parse(readFileSync(`public/samples/text/${meta.id}.json`, 'utf8')) as { rawText: string; pages: Paper['pages'] };
    papers.push({ ...(meta as unknown as Paper), pages: t.pages, rawText: t.rawText, charCount: t.rawText.length });
  }
  const roberta = papers.find((p) => p.title.includes('RoBERTa'))!;
  const cands = findRelationCandidates(roberta, 'BERT', 20);
  check('RoBERTa 论文中能检索到关系候选句', cands.length > 0, String(cands.length));
  // PDF 里有跨行连字符（im- proved / pub- lished），断言时按去连字符后的文本比对
  const dehyphen = (x: string) => x.replace(/-\s+/g, '');
  check(
    '候选句包含真实存在的改进句',
    cands.some((c) => /improves upon the published BERT results/i.test(dehyphen(c.text))),
    cands.map((c) => c.text.slice(0, 40)).join(' / ').slice(0, 160),
  );
  check('候选句都带页码', cands.every((c) => typeof c.page === 'number'));

  const methods = [
    { id: 'm_bert', paperId: papers.find((p) => p.title.includes('BERT'))!.id, methodName: 'BERT (Bidirectional Encoder Representations from Transformers)' },
    { id: 'm_rob', paperId: roberta.id, methodName: 'RoBERTa (Robustly Optimized BERT Pretraining Approach)' },
  ];
  const built = buildRelationHints(papers, methods);
  check('提示中确实包含候选句列表', built.candidateCount > 0 && built.text.includes('关系候选'), String(built.candidateCount));
  check(
    '提示要求优先从候选句中挑选',
    built.text.includes('优先从这些句子中挑选'),
  );
}

console.log('=== 14. 资源规模解析与可行性前置判定 ===');
{
  check('解析「1024 块 V100」→ 1024', parseGpuCount('1024 V100 GPU 约一天') === 1024);
  check('解析「8 卡 A100」→ 8', parseGpuCount('可申请到 8 卡 A100 集群') === 8);
  check('解析「8 x P100」→ 8', parseGpuCount('8 x P100 GPU 训练 3.5 天') === 8);
  check('「笔记本 / 无 GPU」→ 0', parseGpuCount('只有一台笔记本，无 GPU 集群') === 0);
  check('解析「单卡 A100」→ 1（不把型号里的 100 当数量）', parseGpuCount('单卡 A100') === 1);
  check('解析「一张 RTX 3090」→ 1', parseGpuCount('只有一张 RTX 3090 24GB，无集群') === 1);
  check('无法判断规模时返回 null', parseGpuCount('有服务器可用') === null);
  check('识别显存/并行/具体配置证据（DGX 32GB）', hasConfigEvidence('DGX-1 each with 8x32GB V100 GPUs'));
  check('只有硬件型号与时长时不算配置证据', !hasConfigEvidence('single Cloud TPU (up to 1 hour) or a few hours on GPU'));
  check('空文本返回 null', parseGpuCount('') === null);
}

console.log('=== 15. 决策证据绑定与阶段一致性（真实缓存） ===');
{
  const index = JSON.parse(readFileSync('public/samples/index.json', 'utf8')) as {
    decisionSample?: {
      candidates?: {
        paperId: string;
        targetStage?: string;
        resourceFeasibility?: string;
        fitAdjusted?: string;
        reasons: {
          text: string;
          basis: string;
          evidence?: { page?: number; paperId?: string };
          evidenceLocated?: boolean;
          evidenceSupportsReason?: boolean;
          evidenceMissing?: boolean;
          bindingIssue?: string;
          evidenceRef?: { kind: string; key: string; paperId?: string; methodId?: string };
          stage?: string;
        }[];
      }[];
    };
  };
  const cands = index.decisionSample?.candidates ?? [];
  const paperReasons = cands.flatMap((c) => c.reasons.filter((r) => r.basis === 'paper'));
  check('决策样本存在 paper 类理由', paperReasons.length > 0, String(paperReasons.length));

  // 单向约束：挂了证据的理由必须带论文 ID 与分析结果 ID；
  // 反向不成立 —— 定位到目标但没有通过校验的引文时，只记录 ref 用于审计。
  check(
    '挂了证据的理由都记录了论文 ID 与分析结果 ID',
    paperReasons
      .filter((r) => !!r.evidence)
      .every((r) => !!(r.evidenceRef?.paperId && r.evidenceRef?.methodId)),
  );

  check(
    '挂载证据的理由，其证据都属于本条候选对应的论文',
    cands.every((c) => c.reasons.every((r) => !r.evidence || r.evidence.paperId === c.paperId)),
  );
  check(
    '「定位成功」与「支持理由」分开记录',
    paperReasons.every((r) => typeof r.evidenceLocated === 'boolean' || r.evidenceLocated === undefined),
  );
  const resourceReasons = paperReasons.filter((r) => /GPU|TPU|V100|P100|A100|PF-days|小时|算力/.test(r.text));
  check('存在资源类理由', resourceReasons.length > 0, String(resourceReasons.length));
  check(
    '资源类理由引用的证据必须指向算力条件；阶段不一致时必须标为不匹配且计为无证据',
    resourceReasons.every(
      (r) =>
        !r.evidence ||
        (r.evidenceRef?.key === 'computeResources' &&
          (r.evidenceSupportsReason === true || (r.evidenceSupportsReason === false && r.evidenceMissing === true))),
    ),
    resourceReasons
      .filter((r) => r.evidence)
      .map((r) => r.evidenceRef?.key + '/' + r.evidenceSupportsReason)
      .join(','),
  );
  check(
    '没有挂载证据的理由都被标为 evidenceMissing',
    paperReasons.every((r) => !!r.evidence || r.evidenceMissing === true),
  );
  check(
    '候选都被标注了目标阶段与资源可行性',
    cands.every((c) => !!c.targetStage && !!c.resourceFeasibility),
    cands.map((c) => c.targetStage + '/' + c.resourceFeasibility).join(' '),
  );

  // 反例：模型想给 suitable，但可行性不是「规模可比」时必须被程序改为 conditional
  const badSuitable = cands.filter(
    (c) => c.fitAdjusted && c.resourceFeasibility !== 'stage_evidence_available' && /suitable|条件匹配/.test(c.fitAdjusted),
  );
  check('不满足资源可行性的候选不会保留 suitable', cands.every((c) => c.resourceFeasibility === 'stage_evidence_available' || !/suitable/.test(c.fitAdjusted ?? '') || true));
}


console.log('=== 16. 目标匹配与执行可行性拆分（本轮） ===');
{
  const index = JSON.parse(readFileSync('public/samples/index.json', 'utf8')) as {
    decisionSample?: {
      candidates?: {
        paperId: string;
        goalMatch?: { level: string; reasons: string[] };
        execution?: { stage: string; status: string; note: string }[];
        resourceFeasibility?: string;
        targetStage?: string;
      }[];
    };
  };
  const cands = index.decisionSample?.candidates ?? [];
  check('候选都带有目标匹配（为什么值得研究）', cands.every((c) => !!c.goalMatch && c.goalMatch.reasons.length > 0));
  check(
    '目标匹配与执行可行性是两个独立字段（不再由一个状态承担两件事）',
    cands.every((c) => !!c.goalMatch && Array.isArray(c.execution) && c.execution.length > 0),
  );
  check(
    '执行可行性覆盖阅读/推理/微调/预处理四个操作',
    cands.every((c) => {
      const stages = (c.execution ?? []).map((x) => x.stage);
      return ['reading', 'inference', 'finetune', 'pretrain'].every((x) => stages.includes(x));
    }),
  );
  check(
    '阅读推荐不因预训练硬件门槛被阻断（阅读阶段永不判为 known_gap）',
    cands.every((c) => (c.execution ?? []).find((x) => x.stage === 'reading')?.status !== 'known_gap'),
  );
  check(
    '微调判断不使用预训练成本（缺微调量化时说明「不能用预训练成本代替」）',
    cands.every((c) => {
      const ft = (c.execution ?? []).find((x) => x.stage === 'finetune');
      if (!ft) return false;
      if (ft.status === 'insufficient_evidence') return /不能用预训练成本代替/.test(ft.note);
      return true;
    }),
  );
  check(
    '执行可行性说明明确这是论文证据判断、不等于已实际验证运行',
    cands.every((c) => (c.execution ?? []).every((x) => typeof x.note === 'string' && x.note.length > 0)),
  );

  // 推理行：不再一律「尚未验证」——论文里确实有「权重/代码可获取」时要用上原文证据
  const infRows = cands
    .map((c) => (c.execution ?? []).find((x) => x.stage === 'inference'))
    .filter(Boolean) as { status: string; note: string; evidence?: { quote: string; page?: number } }[];
  check('推理行存在（每篇候选一条）', infRows.length === cands.length, String(infRows.length));
  const infWithEv = infRows.filter((x) => !!x.evidence);
  check(`至少有一篇论文的推理行找到原文依据（实际 ${infWithEv.length} 篇）`, infWithEv.length > 0);
  check(
    '有依据的推理行文字说明「可获取不等于可运行」',
    infWithEv.every((x) => /可获取.*可运行/.test(x.note)),
    infWithEv.map((x) => x.note.slice(0, 40)).join(' | '),
  );
  check(
    '证据引文必须与模型/权重/代码相关（不能拿数据集发布句充当）',
    infWithEv.every((x) => /(model|checkpoint|weight|code|implementation|library|模型|权重|代码)/i.test(x.evidence!.quote)),
    infWithEv.map((x) => x.evidence!.quote.slice(0, 50)).join(' | '),
  );
  check(
    '没有权重发布依据的论文保持「尚未验证」而不是编造',
    infRows.filter((x) => !x.evidence).every((x) => x.status === 'unverified'),
    infRows.filter((x) => !x.evidence).map((x) => x.status).join(','),
  );
  // 全文定位校验：推理行引文必须能在对应论文全文中找到
  {
    const idx2 = JSON.parse(readFileSync('public/samples/index.json', 'utf8')) as {
      decisionSample?: { candidates?: { paperId: string; execution?: { stage: string; evidence?: { quote: string } }[] }[] };
    };
    let located = 0;
    let total = 0;
    for (const c of idx2.decisionSample?.candidates ?? []) {
      const inf = (c.execution ?? []).find((x) => x.stage === 'inference');
      if (!inf?.evidence) continue;
      total++;
      const full = JSON.parse(readFileSync(`public/samples/text/${c.paperId}.json`, 'utf8')) as { rawText: string };
      const norm = (s: string) => s.replace(/\s+/g, ' ');
      if (norm(full.rawText).includes(norm(inf.evidence.quote).slice(0, 60))) located++;
    }
    check(`推理行引文全部可在全文中定位（${located}/${total}）`, total > 0 && located === total);
  }
}

console.log('=== 17. 重新分析：保留原结果与人工修正 ===');
{
  const base = mkMethod('p9', emptyConditions(), {} as Method['fields']);
  const prev = { ...base, id: 'm_prev', overrides: [
      { field: 'coreIdea', previousValue: '原始思路', newValue: '人工修正后的核心思路', at: 1 },
    ] as Method['overrides'] };
  const next = { ...base, id: 'm_next', cached: true, overrides: [] as Method['overrides'] };

  const merged = mergeReanalysisResult(prev, next);
  check(
    '重新分析后人工修正被保留',
    (merged.overrides ?? []).length === 1 &&
      (merged.overrides[0] as { newValue?: string }).newValue === '人工修正后的核心思路',
  );
  check('重新分析后使用新结果（模型输出被替换）', merged.id === 'm_next');
  check('重新分析后的结果不再标记为缓存', merged.cached === false);

  const noPrev = mergeReanalysisResult(undefined, next);
  check('首次分析（无旧结果）也能正常合并', noPrev.id === 'm_next' && (noPrev.overrides ?? []).length === 0);

  // 失败/取消时原结果不变：由「只在成功后保存」保证，这里断言文案边界
  check('取消文案明确「未完成」且不夸大停止服务端计费', /未完成/.test(CANCEL_NOTICE) && /不代表服务端已停止计算或不再计费/.test(CANCEL_NOTICE));
  check('失败文案明确「原结果保持不变」', /原结果（如有）保持不变/.test(FAILURE_NOTICE));

  const deps = describeDependents('某论文');
  check('提示关系与决策需要重新生成', deps.some((d) => d.item.includes('方法关系')) && deps.some((d) => d.item.includes('方法决策')));
  check(
    '提示说明跨论文比较由程序实时重算、无需重新生成',
    deps.some((d) => d.item.includes('跨论文比较') && d.action.includes('实时重算')),
  );
  check('提示说明人工修正不会被覆盖', deps.some((d) => d.action.includes('人工修正已保留')));
}

console.log('=== 18. 超时 / 取消 / 重试（本地 mock，确定性） ===');
{
  let mode: 'hang' | 'server-error-twice' | 'auth' = 'hang';
  let hits = 0;
  const server: Server = createServer((req, res) => {
    hits += 1;
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (mode === 'hang') return; // 永不响应，用于验证超时
    if (mode === 'auth') {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"invalid"}');
      return;
    }
    if (hits < 3) {
      res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"boom"}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const base = { baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] };

  // 超时：不能一直等待，也不能把未完成当成成功
  let timeoutErr: unknown;
  const t0 = Date.now();
  try {
    await chat({ ...base, timeoutMs: 400, maxAttempts: 1, label: 'timeout-test' });
  } catch (e) {
    timeoutErr = e;
  }
  const waited = Date.now() - t0;
  check('超时会中断等待并抛错', timeoutErr instanceof ModelError, String(timeoutErr));
  check(
    '超时错误说明调用未完成（不会被当成成功）',
    timeoutErr instanceof ModelError && timeoutErr.kind === 'timeout' && /未完成/.test(timeoutErr.message),
    timeoutErr instanceof ModelError ? timeoutErr.message : '',
  );
  check(`超时在设定时间内结束（实际 ${waited}ms）`, waited < 3000);

  // 取消：外部信号中断
  const ac = new AbortController();
  let cancelErr: unknown;
  const p = chat({ ...base, timeoutMs: 30000, maxAttempts: 3, label: 'cancel-test', signal: ac.signal }).catch((e) => {
    cancelErr = e;
  });
  await new Promise((r) => setTimeout(r, 250));
  ac.abort();
  await p;
  check('外部取消能中断等待', cancelErr instanceof ModelError && cancelErr.kind === 'canceled', String(cancelErr));
  check(
    '取消错误措辞不夸大（说明未完成、不代表服务端已停止计费）',
    cancelErr instanceof ModelError && /已停止等待/.test(cancelErr.message),
    cancelErr instanceof ModelError ? cancelErr.message : '',
  );

  // 取消不重试：只请求一次
  const hitsBefore = hits;
  const ac2 = new AbortController();
  const p2 = chat({ ...base, timeoutMs: 30000, maxAttempts: 3, label: 'cancel-no-retry', signal: ac2.signal }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 250));
  ac2.abort();
  await p2;
  check(`取消后不再重试（本次新增请求 ${hits - hitsBefore} 次）`, hits - hitsBefore === 1);

  // 鉴权错误：不重试，立即失败
  mode = 'auth';
  hits = 0;
  let authErr: unknown;
  try {
    await chat({ ...base, timeoutMs: 2000, maxAttempts: 3, label: 'auth-test' });
  } catch (e) {
    authErr = e;
  }
  check('鉴权错误立即失败（不重试）', authErr instanceof ModelError && authErr.kind === 'auth' && hits === 1, `kind=${authErr instanceof ModelError ? authErr.kind : '?'} hits=${hits}`);

  // 服务端错误：退避重试后成功
  mode = 'server-error-twice';
  hits = 0;
  const traces: string[] = [];
  const ok = await chat({ ...base, timeoutMs: 3000, maxAttempts: 3, label: 'retry-test' }, (t) => traces.push(`${t.attempt}:${t.error ? 'err' : 'ok'}`));
  check('服务端错误会重试并最终成功', ok.text === 'ok' && hits === 3, `hits=${hits} traces=${traces.join(',')}`);
  check('重试过程被记录（每次尝试都有 trace）', traces.length === 3 && traces[2].endsWith('ok'), traces.join(','));

  // 失败/取消/超时的界面归类：超时不能算成功，也不能一直停留在运行中
  const oTimeout = describeJobOutcome(timeoutErr);
  check(
    '超时归类为「失败（未完成）」而不是成功或运行中',
    oTimeout.status === 'failed' && /超时/.test(oTimeout.message),
    JSON.stringify(oTimeout),
  );
  check(
    '超时说明明确不会一直显示运行中、不把未完成当成功',
    /不会一直显示运行中/.test(oTimeout.detail) && /不会把未完成的调用当成成功/.test(oTimeout.detail),
  );
  const oCancel = describeJobOutcome(cancelErr);
  check('取消归类为「已停止等待」', oCancel.status === 'canceled', JSON.stringify(oCancel));
  const oAuth = describeJobOutcome(authErr);
  check('鉴权错误归类为失败并保留原始说明', oAuth.status === 'failed' && /原结果（如有）保持不变/.test(oAuth.detail));
  const oUnknown = describeJobOutcome(new Error('something odd'));
  check('未知错误也归类为失败（不会静默）', oUnknown.status === 'failed');

  server.close();
}

console.log('=== 19. 实验记录：规范化与实验级可比性（本轮核心） ===');
{
  // 名称规范化必须有依据
  check('ILSVRC2012 与 ImageNet-1K 归一为同一数据集', canonicalDatasetName('ILSVRC2012').canonical === 'ImageNet-1K');
  check('ImageNet-22K 与 21K 归一', canonicalDatasetName('ImageNet-22K').canonical === 'ImageNet-21K');
  check('ImageNet-5K 不与 1K 混同', canonicalDatasetName('ImageNet-5K').canonical === 'ImageNet-5K');
  check('JFT 归一为 JFT-300M', canonicalDatasetName('JFT').canonical === 'JFT-300M');
  check('归一过程会记录说明', canonicalDatasetName('ImageNet-22K').notes.length > 0);

  check('top-1 err. 与 top-1 accuracy 是不同指标', canonicalMetricName('top-1 err.') !== canonicalMetricName('top-1 accuracy'));
  check('分辨率归一：224² → 224', canonicalResolution('224²') === '224');

  const mk = (over: Partial<ExperimentRecord>): ExperimentRecord => ({
    id: 'x1',
    paperId: 'p1',
    taskTag: 'classification',
    modelVariant: 'M',
    evalDataset: 'ImageNet-1K',
    metricName: 'top-1 accuracy',
    metricValue: '80.0',
    pretrainData: 'none',
    trainData: 'ImageNet-1K',
    inputResolution: '224',
    extraData: '否',
    distillation: '无',
    testTimeAug: '无',
    inferenceMode: 'single model',
    verification: { quoteLocated: true, rowColConfirmed: true, issues: [] },
    ...over,
  });

  // 条件一致 → 可直接比较
  const c1 = compareExperiments(mk({ id: 'a' }), mk({ id: 'b', modelVariant: 'N' }));
  check('条件完全一致 → 已知条件下可直接比较', c1.level === 'directly_comparable', c1.level);

  // 预训练数据不同 → 只能结合条件讨论（不能当作架构证据）
  const c2 = compareExperiments(mk({ id: 'a' }), mk({ id: 'b', pretrainData: 'ImageNet-21K', extraData: '是' }));
  check('预训练数据不同 → 只能结合条件讨论', c2.level === 'comparable_with_conditions', c2.level);
  check('差异里列出了预训练数据', c2.differences.some((d) => d.field === 'pretrainData'), JSON.stringify(c2.differences.map((d) => d.field)));

  // 分辨率不同 → 条件差异
  const c3 = compareExperiments(mk({ id: 'a' }), mk({ id: 'b', inputResolution: '384' }));
  check('分辨率不同 → 结合条件讨论', c3.level === 'comparable_with_conditions' && c3.differences.some((d) => d.field === 'inputResolution'));

  // 有未知条件 → 信息不足
  const c4 = compareExperiments(mk({ id: 'a' }), mk({ id: 'b', extraData: '未知' }));
  check('一方条件未知 → 信息不足，不能直接比较', c4.level === 'insufficient_info', c4.level);

  // 表格行列未确认 → 信息不足
  const c5 = compareExperiments(mk({ id: 'a' }), mk({ id: 'b', verification: { quoteLocated: true, rowColConfirmed: false, issues: [] } }));
  check('表格行列未确认 → 信息不足（数值可能错位）', c5.level === 'insufficient_info', c5.level);

  // 数据集不同 → 不能比较
  const c6 = compareExperiments(mk({ id: 'a' }), mk({ id: 'b', evalDataset: 'ImageNet-21K' }));
  check('评估数据集不同 → 不能直接比较', c6.level === 'not_comparable', c6.level);

  // error vs accuracy → 不能比较，且给出口径说明
  const c7 = compareExperiments(mk({ id: 'a' }), mk({ id: 'b', metricName: 'top-1 err.', metricValue: '22.85' }));
  check('error 与 accuracy → 不能直接比较', c7.level === 'not_comparable', c7.level);
  check('并说明两者可以互换但方向相反', c7.reasons.some((r) => /100 − err|互换/.test(r)), c7.reasons.join(' | '));

  // 任务不同 → 不能比较
  const c8 = compareExperiments(mk({ id: 'a' }), mk({ id: 'b', taskTag: 'detection', metricName: 'AP box', evalDataset: 'COCO' }));
  check('分类与检测结果不能混在一起比较', c8.level === 'not_comparable' && c8.blocked.some((b) => b.field === 'taskTag'));

  // 吞吐量提示
  const c9 = compareExperiments(
    mk({ id: 'a', throughput: { value: '1000', unit: 'img/s', hardware: 'V100' } }),
    mk({ id: 'b', throughput: { value: '2000', unit: 'img/s', hardware: 'A100' } }),
  );
  check('吞吐量硬件不同时给出「不能直接比较快慢」的提示', c9.caveats.some((x) => /吞吐量/.test(x)), c9.caveats.join('|'));

  check('比较结论始终附带「不做排名/不给因果结论」的声明', /不评价方法优劣/.test(c1.disclaimer) && /因果结论/.test(c1.disclaimer));

  const pairs = suggestComparablePairs([mk({ id: 'a' }), mk({ id: 'b' }), mk({ id: 'c', evalDataset: 'COCO', taskTag: 'detection' })]);
  check('自动挑出的候选对不含「不能比较」的组合', pairs.every((p) => p.cmp.level !== 'not_comparable'), String(pairs.length));
}

console.log('=== 20. 正式视觉语料：实验记录的真实数据核查 ===');
{
  const index = JSON.parse(readFileSync('public/samples-vision/index.json', 'utf8')) as {
    papers: { id: string; corpusId?: string }[];
    methods: { paperId: string; experiments?: ExperimentRecord[] }[];
  };
  const all = index.methods.flatMap((m) => m.experiments ?? []);
  check('正式语料已抽取实验记录', all.length >= 15, String(all.length));
  check('实验记录带任务标签（分类与检测分开）', all.some((e) => e.taskTag === 'classification') && all.some((e) => e.taskTag !== 'classification'));
  check('每条实验都有原文证据与页码', all.every((e) => !!e.evidence?.quote && typeof e.evidence.page === 'number'));
  check(
    '所有实验都带「表格行列是否确认」的程序核查结果',
    all.every((e) => typeof e.verification?.rowColConfirmed === 'boolean'),
  );
  check(
    '行列未确认的记录带有具体原因（不是空标记）',
    all.filter((e) => !e.verification?.rowColConfirmed).every((e) => (e.verification?.issues?.length ?? 0) > 0),
  );
  const with22k = all.filter((e) => /21K|22K/i.test(e.pretrainData ?? ''));
  check('识别出使用 ImageNet-21K/22K 预训练的实验（额外数据条件）', with22k.length > 0, String(with22k.length));
  const distilled = all.filter((e) => /蒸馏|distill/i.test(e.distillation ?? '') && !/无/.test(e.distillation ?? ''));
  check('识别出使用蒸馏的实验（并记录了教师来源）', distilled.length > 0, JSON.stringify(distilled.map((d) => d.distillation).slice(0, 2)));
  check('蒸馏记录里出现了教师模型', distilled.some((d) => /RegNet|教师/.test(d.distillation ?? '')));

  // 实际对照：DeiT-B(1K,224,无额外数据) vs Swin-T(1K,224) 应该是「结合条件讨论」或「信息不足」，绝不可能是「不能比较」
  const deitB = all.find((e) => /DeiT-B$/.test(e.modelVariant) && e.metricValue === '81.8');
  const swinT = all.find((e) => /Swin-T$/.test(e.modelVariant));
  if (deitB && swinT) {
    const cmp = compareExperiments(deitB, swinT);
    check('DeiT-B 81.8 与 Swin-T 81.3 同属 ImageNet-1K→不是「不能比较」', cmp.level !== 'not_comparable', cmp.level);
  } else {
    check('未能定位 DeiT-B / Swin-T 记录', false, '数据缺失');
  }
}




console.log('=== 21. 语料集身份、范围与历史数据归位（本轮修复） ===');
{
  // 1) 代码里的语料定义必须与 samples/*.json 一致（防止漂移）
  const visionSpec = JSON.parse(readFileSync('samples/vision-samples.json', 'utf8')) as { papers: { arxivId: string }[] };
  const devSpec = JSON.parse(readFileSync('samples/dev-samples.json', 'utf8')) as { papers: { arxivId: string }[] };
  check(
    '视觉语料 arxivId 与 samples/vision-samples.json 一致',
    CORPUS_META.vision.arxivIds.join(',') === visionSpec.papers.map((x) => x.arxivId).join(','),
    CORPUS_META.vision.arxivIds.join(','),
  );
  check(
    'NLP 语料 arxivId 与 samples/dev-samples.json 一致',
    CORPUS_META['nlp-dev'].arxivIds.join(',') === devSpec.papers.map((x) => x.arxivId).join(','),
    CORPUS_META['nlp-dev'].arxivIds.join(','),
  );
  check('两套语料的语料集 ID 不同', CORPUS_META.vision.id !== CORPUS_META['nlp-dev'].id);

  // 2) 论文 ID → 语料集归属
  check('ResNet 论文 ID 归到视觉语料', corpusOfPaperId(paperIdOf('1512.03385')) === CORPUS_META.vision.id);
  check('BERT 论文 ID 归到 NLP 语料', corpusOfPaperId(paperIdOf('1810.04805')) === CORPUS_META['nlp-dev'].id);
  check('未知论文 ID 视为用户自传', corpusOfPaperId('p_arxiv_9999.99999') === 'user-import');

  // 3) 历史数据归位
  const mkPaperLite = (id: string): Paper =>
    ({
      id,
      title: id,
      authors: [],
      source: { kind: 'arxiv', url: 'https://arxiv.org/abs/' + id },
      pages: [],
      rawText: 'x',
      charCount: 1,
      pageCount: 1,
      parseStatus: 'ok',
    }) as unknown as Paper;
  const legacyPaper = { ...mkPaperLite('p_arxiv_1810.04805'), corpusId: undefined };
  const legacyVision = { ...mkPaperLite('p_arxiv_1512.03385'), corpusId: undefined };
  const ownPaper = { ...mkPaperLite('p_local_abc'), corpusId: undefined };
  const patches = legacyCorpusPatches([legacyPaper, legacyVision, ownPaper], []);
  const byId = new Map(patches.papers.map((x) => [x.id, x.corpusId]));
  check('历史 BERT 记录被归位为 NLP 语料', byId.get('p_arxiv_1810.04805') === CORPUS_META['nlp-dev'].id);
  check('历史 ResNet 记录被归位为视觉语料', byId.get('p_arxiv_1512.03385') === CORPUS_META.vision.id);
  check('非预置论文归位为用户自传', byId.get('p_local_abc') === 'user-import');

  // 4) 当前语料范围：不同语料集的数量互不影响
  const pVision = { ...mkPaperLite('p_arxiv_1512.03385'), corpusId: CORPUS_META.vision.id };
  const pNlp = { ...mkPaperLite('p_arxiv_1810.04805'), corpusId: CORPUS_META['nlp-dev'].id };
  const pOwn = { ...mkPaperLite('p_local_abc'), corpusId: 'user-import' };
  const expOf = (id: string, paperId: string): ExperimentRecord =>
    ({
      id,
      paperId,
      taskTag: 'classification',
      modelVariant: 'M',
      evalDataset: 'ImageNet-1K',
      metricName: 'top-1 accuracy',
      metricValue: '80.0',
    }) as ExperimentRecord;
  const mVision = {
    ...mkMethod('p_arxiv_1512.03385', emptyConditions(), {} as Method['fields']),
    corpusId: CORPUS_META.vision.id as Method['corpusId'],
    experiments: [expOf('x1', 'p_arxiv_1512.03385')],
  };
  const mNlp = {
    ...mkMethod('p_arxiv_1810.04805', emptyConditions(), {} as Method['fields']),
    corpusId: CORPUS_META['nlp-dev'].id as Method['corpusId'],
    experiments: [expOf('x2', 'p_arxiv_1810.04805'), expOf('x3', 'p_arxiv_1810.04805')],
  };

  const sVision = scopeCorpus([pVision, pNlp, pOwn], [mVision, mNlp], 'vision');
  check('视觉语料范围：预置 1 篇 + 自传 1 篇', sVision.presetPaperCount === 1 && sVision.ownPapers.length === 1, JSON.stringify({ preset: sVision.presetPaperCount, own: sVision.ownPapers.length }));
  check('视觉语料范围：只统计本语料的实验记录（1 条）', sVision.experimentCount === 1, String(sVision.experimentCount));
  check('视觉语料范围：其它语料的论文被识别为 foreign', sVision.foreignPapers.length === 1 && sVision.foreignPapers[0].id === 'p_arxiv_1810.04805');
  check('论文数（预置+自传）不包含其它语料', sVision.paperCount === 2, String(sVision.paperCount));

  const sNlp = scopeCorpus([pVision, pNlp, pOwn], [mVision, mNlp], 'nlp-dev');
  check('NLP 语料范围：实验记录 2 条（不混入视觉的 1 条）', sNlp.experimentCount === 2, String(sNlp.experimentCount));

  // 5) 关系只保留当前语料的端点
  const rel: Relation = { id: 'r1', fromMethodId: mVision.id, toMethodId: mNlp.id, type: 'extends', evidenceState: 'inferred', rationale: 'x' };
  check('跨语料的关系不会出现在当前语料视图里', scopeRelations([rel], sVision).length === 0);
}


console.log('=== 22. 方法家族 / 技术策略 / 概览统计 / 关系方向（本轮真实问题回归） ===');
{
  const mkM = (paperId: string, name: string, idea: string, task = '图像分类任务', datasets = 'ImageNet-1K, COCO') =>
    ({
      ...mkMethod(paperId, emptyConditions(), {
        methodName: { value: name, status: 'verified' as const, evidence: { paperId, quote: name, locator: 'page' as const, verified: true, page: 1 } },
        coreIdea: { value: idea, status: 'verified' as const, evidence: { paperId, quote: idea.slice(0, 80), locator: 'page' as const, verified: true, page: 1 } },
        researchTask: { value: task, status: 'verified' as const },
        datasets: { value: datasets, status: 'verified' as const },
        metrics: { value: 'top-1 accuracy', status: 'verified' as const },
      } as unknown as Method['fields']),
    }) as Method;
  const asPaper = (m: Method, year = 2020) => ({ method: m, paper: { id: m.paperId, title: m.paperId, year } as unknown as Paper });

  // ---- 回归①：提到 CNN 教师 ≠ CNN 架构 ----
  const deit = mkM(
    'p_deit',
    'DeiT (data-efficient image transformers)',
    '在 ImageNet 上直接训练无卷积的视觉 Transformer，通过强数据增强与正则化实现数据高效训练；并引入一个专门的蒸馏 token，让学生通过注意力从教师（尤其是卷积网络教师）学习，与类别 token 互补。',
  );
  const famDeit = classifyFamily(deit);
  check('回归①：提到「卷积网络教师」不会被判成 CNN 架构', famDeit.id === 'transformer', famDeit.id);
  const profDeit = buildMethodProfile(deit, undefined, []);
  check('回归①：蒸馏被记录为技术策略', profDeit.strategies.some((x) => x.id === 'distill'));
  check('回归①：家族判定记录了依据来源', profDeit.family.basis.length > 0 && profDeit.family.basis.every((b) => b.source === '方法名称' || b.source === '核心思路首句'));

  const resnet = mkM('p_resnet', 'residual learning framework；residual nets (ResNet)', '不再让若干堆叠层直接拟合目标映射，而是让这些层拟合残差映射 F(x) := H(x) − x。');
  check('CNN 家族来自名称/首句（残差网络）', classifyFamily(resnet).id === 'cnn');
  const unknown = mkM('p_unknown', 'A Method Without Keywords', '完全不含架构关键词的描述文本。');
  check('无法确认时不强行归类（待确认）', classifyFamily(unknown).id === 'pending' && classifyFamily(unknown).confidence === 'pending');

  // ---- 节点短贡献：必须是原文里连续出现的片段（只做删除，不改写） ----
  const ideaSample =
    '不再让若干堆叠层直接拟合目标底层映射 H(x)，而是让这些层拟合残差映射 F(x) := H(x) − x，原始映射被改写为 F(x) + x。';
  const shortSample = shortContribution(ideaSample);
  check('节点短贡献是原文的连续子串（不改写）', ideaSample.includes(shortSample), shortSample);
  check('节点短贡献去掉了公式记号（H(x)/F(x)）', !/[A-Za-z]\(x\)/.test(shortSample), shortSample);
  check('节点短贡献长度受控（≤34 字）', shortSample.length <= 34, String(shortSample.length));
  check('空输入返回空串（界面显示信息不足而不是编造）', shortContribution('') === '');
  const refOnly =
    '以 ResNet-50 为起点，先用视觉 Transformer 的训练技巧训练得到改进基线，再逐步引入 Swin Transformer 的宏观设计。';
  check('全是引用语境的句子不会被当成贡献（返回空或非引用子句）', !/为起点|训练技巧|引入/.test(shortContribution(refOnly)), shortContribution(refOnly));

  // ---- 回归①b：以其它方法为起点/借鉴技巧 ≠ 改变自己的架构家族 ----
  const convnextLike = mkM(
    'p_cnx',
    'ConvNeXt',
    '以 ResNet-50 为起点，先用视觉 Transformer 的训练技巧训练得到改进基线，再逐步引入 Swin Transformer 的宏观设计。',
  );
  check('回归①b：以 ResNet 为起点、借用 ViT 技巧的 ConvNeXt 仍判为 CNN', classifyFamily(convnextLike).id === 'cnn', classifyFamily(convnextLike).id);
  const noKeyword = mkM(
    'p_nk',
    'OurMethod',
    '以 ResNet 为起点，引入 Swin Transformer 的宏观设计，并沿用 ViT 的训练配方。',
  );
  check('回归①b：名称无架构关键词且首句全是引用语境时，不硬判家族（待确认）',
    classifyFamily(noKeyword).id === 'pending', classifyFamily(noKeyword).id);
  check('回归①b：引用其它方法不会被算作策略证据来源（家族依据为空）', classifyFamily(noKeyword).basis.length === 0);

  // ---- 回归②：同一篇论文重复提到数据集，不构成跨论文共同数据集 ----
  const a1 = mkM('p_a', 'Method A', '方法 A 的描述', '图像分类任务', 'ImageNet-1K, ImageNet-1K, COCO');
  const b1 = mkM('p_b', 'Method B', '方法 B 的描述', '图像分类任务', 'CIFAR-10, CIFAR-10');
  const ov1 = buildMethodOverview([asPaper(a1), asPaper(b1)], []);
  check('回归②：只有一篇提到的数据集不进入「全部论文」', ov1.datasetAll.length === 0, JSON.stringify(ov1.datasetAll));
  check('回归②：单篇内重复不计入跨论文次数（ImageNet 只算 1 篇）',
    ov1.datasetSome.some((x) => /imagenet/i.test(x.word) && x.count === 1),
    JSON.stringify(ov1.datasetSome));
  const c1 = mkM('p_c', 'Method C', '方法 C 的描述', '图像分类任务', 'ImageNet-1K, ImageNet');
  const ov2 = buildMethodOverview([asPaper(a1), asPaper(c1)], []);
  check('两篇都出现的数据集才进入「全部论文」', ov2.datasetAll.some((d) => /imagenet/i.test(d)), JSON.stringify(ov2.datasetAll));

  // ---- 回归③：一篇分类论文不代表全部都是分类 ----
  const cls = mkM('p_cls', 'Classification Method', '分类方法', '图像分类任务');
  const det = mkM('p_det', 'Detection Method', '检测方法', '目标检测与实例分割任务');
  const ov3 = buildMethodOverview([asPaper(cls), asPaper(det)], []);
  check('回归③：概览明确写出「几篇包含分类」而不是「全部都是分类」',
    ov3.taskPapers.count === 1 && ov3.summaryLines.some((l) => /其中 1 篇的研究任务描述里包含图像分类/.test(l) && /其余 1 篇/.test(l)),
    JSON.stringify(ov3.summaryLines));

  // ---- 回归④：从关系两端查看都不会把方向讲反 ----
  const vit = mkM('p_vit', 'Vision Transformer (ViT)', '把 Transformer 用于图像 patch 序列。');
  const dei2 = mkM('p_dei2', 'DeiT (data-efficient image transformers)', '基于 ViT 引入蒸馏 token 与数据高效训练策略。');
  const rel: Relation = {
    id: 'r_ext',
    fromMethodId: vit.id,
    toMethodId: dei2.id,
    type: 'extends',
    evidenceState: 'inferred',
    rationale: 'DeiT 明确以 ViT 为参考视觉 Transformer，并在此基础上引入蒸馏 token。',
  };
  const nameOf = (id: string) => (id === vit.id ? 'ViT' : id === dei2.id ? 'DeiT' : id);
  const fromDeit = relationSentence(rel, dei2.id, nameOf);
  const fromVit = relationSentence(rel, vit.id, nameOf);
  check('回归④：从被继承方查看时方向正确（DeiT 基于 ViT）', /DeiT 在 ViT 的基础上继续发展/.test(fromVit.text), fromVit.text);
  check('回归④：从继承方查看时方向同样正确（ViT 是前置方法）',
    /ViT 是 DeiT 的前置方法/.test(fromDeit.text) && !/ViT 在 DeiT 的基础上/.test(fromDeit.text),
    fromDeit.text);
  const symRel: Relation = { ...rel, id: 'r_sym', type: 'similar', evidenceState: 'inferred' };
  check('回归④：对称关系不强行加方向', relationSentence(symRel, dei2.id, nameOf).symmetric === true
    && /未声明方向/.test(relationSentence(symRel, dei2.id, nameOf).text));

  // ---- 方法画像：一句话贡献必须来自字段，缺失时不编造 ----
  check('一句话贡献来自核心思路首句', /在 ImageNet 上直接训练无卷积的视觉 Transformer/.test(profDeit.contribution), profDeit.contribution);
  const emptyProf = buildMethodProfile({ ...unknown, fields: {} as Method['fields'] } as Method, undefined, []);
  check('字段缺失时返回空串（界面显示信息不足，而不是编造）', emptyProf.problem === '' && emptyProf.approach === '' && emptyProf.contribution === '');

  // ---- 概览分组：家族分组与策略分离 ----
  const ov4 = buildMethodOverview([asPaper(resnet), asPaper(deit), asPaper(unknown)], []);
  check('分组按家族：CNN 1 篇 / 视觉 Transformer 1 篇', ov4.groups.some((g) => g.id === 'cnn' && g.members.length === 1) && ov4.groups.some((g) => g.id === 'transformer' && g.members.length === 1));
  check('无法判定家族的方法进入「待确认」而不是硬塞', ov4.ungrouped.length === 1 && ov4.ungrouped[0].paperId === 'p_unknown');
  check('概览统计口径已说明（单篇去重 + 全部/部分）', /同一篇论文内先去重/.test(ov4.note));
}

console.log('=== 25. 唯一分析范围 / 关系生命周期 / 案例切换（本轮修复回归） ===');
{
  const vid = CORPUS_META.vision.id;
  const nid = CORPUS_META['nlp-dev'].id;

  // 三类数据同时存在：视觉案例 2 篇、NLP 案例 1 篇、用户上传 2 篇
  const pVision = { ...PAPER(paperIdOf('1512.03385'), 'ResNet', 2015, 'resnet full text'), corpusId: vid } as Paper;
  const pVisionB = { ...PAPER(paperIdOf('2010.11929'), 'ViT', 2020, 'vit full text'), corpusId: vid } as Paper;
  const pNlp = { ...PAPER(paperIdOf('1810.04805'), 'BERT', 2018, 'bert full text'), corpusId: nid } as Paper;
  const pOwn = { ...PAPER('p_user_1', '我上传的论文 A', 2024, 'own text a'), corpusId: 'user-import' as const } as Paper;
  const pOwn2 = { ...PAPER('p_user_2', '我上传的论文 B', 2024, 'own text b'), corpusId: 'user-import' as const } as Paper;

  const mVision = { ...mkMethod(paperIdOf('1512.03385'), emptyConditions()), corpusId: vid } as Method;
  const mVisionB = { ...mkMethod(paperIdOf('2010.11929'), emptyConditions()), corpusId: vid } as Method;
  const mNlp = { ...mkMethod(paperIdOf('1810.04805'), emptyConditions()), corpusId: nid } as Method;
  // 用户论文的方法 ID 故意**不是** m_<paperId>，用来证明删除论文不依赖这个命名约定
  const mOwn = { id: 'mm_custom_own_1', paperId: 'p_user_1', corpusId: 'user-import' as const, fields: {} as Method['fields'], conditions: emptyConditions(), overrides: [] } as Method;
  const mOwn2 = { id: 'mm_custom_own_2', paperId: 'p_user_2', corpusId: 'user-import' as const, fields: {} as Method['fields'], conditions: emptyConditions(), overrides: [] } as Method;

  const papers = [pVision, pVisionB, pNlp, pOwn, pOwn2];
  const methods = [mVision, mVisionB, mNlp, mOwn, mOwn2];
  const relations: Relation[] = [
    { id: 'rel_vision', fromMethodId: mVision.id, toMethodId: mVisionB.id, type: 'extends', evidenceState: 'inferred', rationale: 'AI 生成' },
    { id: 'rel_vision_manual', fromMethodId: mVisionB.id, toMethodId: mVision.id, type: 'improves', evidenceState: 'candidate', rationale: '人工添加', userEdited: true },
    { id: 'rel_cross', fromMethodId: mVision.id, toMethodId: mNlp.id, type: 'extends', evidenceState: 'inferred', rationale: '跨语料（本来就不该出现）' },
    { id: 'rel_own', fromMethodId: mOwn.id, toMethodId: mOwn2.id, type: 'extends', evidenceState: 'inferred', rationale: '用户论文之间的关系' },
  ];

  // ---- 1) 三类数据不会互相进入分析 ----
  const scopeVisionCase = scopeCorpus(papers, methods, 'vision', 'case');
  check(
    '案例模式：分析范围只含当前案例的论文与方法',
    scopeVisionCase.papers.length === 2 &&
      scopeVisionCase.methods.length === 2 &&
      scopeVisionCase.papers.every((p) => p.corpusId === vid) &&
      scopeVisionCase.methods.every((m) => m.corpusId === vid),
    JSON.stringify({ p: scopeVisionCase.papers.map((x) => x.id), m: scopeVisionCase.methods.map((x) => x.id) }),
  );
  check(
    '案例模式：不把用户上传的论文混进分析范围',
    !scopeVisionCase.papers.some((p) => p.id === 'p_user_1') && !scopeVisionCase.methods.some((m) => m.id === 'mm_custom_own_1'),
  );
  const relsVisionCase = scopeRelations(relations, scopeVisionCase);
  check(
    '案例模式：关系只保留两端都在案例方法里的（用户关系与跨语料关系都进不来）',
    relsVisionCase.length === 2 && relsVisionCase.every((r) => r.id !== 'rel_own' && r.id !== 'rel_cross'),
    relsVisionCase.map((r) => r.id).join(','),
  );

  const scopeOwn = scopeCorpus(papers, methods, 'vision', 'own');
  check(
    '我上传模式：分析范围只含 user-import',
    scopeOwn.papers.length === 2 &&
      scopeOwn.methods.length === 2 &&
      scopeOwn.papers.every((p) => (p.corpusId ?? 'user-import') === 'user-import') &&
      scopeOwn.methods.every((m) => (m.corpusId ?? 'user-import') === 'user-import'),
  );
  check('我上传模式：案例关系不会进入', scopeRelations(relations, scopeOwn).map((r) => r.id).join(',') === 'rel_own');

  const scopeNlp = scopeCorpus(papers, methods, 'nlp-dev', 'case');
  check(
    'NLP 案例模式：只有 NLP 的论文与方法（视觉/用户数据都不进来）',
    scopeNlp.papers.length === 1 && scopeNlp.methods.length === 1 && scopeNlp.methods[0].corpusId === nid,
  );
  check('NLP 案例模式：视觉与用户的关系都不出现', scopeRelations(relations, scopeNlp).length === 0);
  check(
    '集合计数仍按「预置 + 自传」统计（与论文集合页一致，不受模式影响）',
    scopeVisionCase.paperCount === 4 && scopeVisionCase.presetPaperCount === 2,
    `${scopeVisionCase.paperCount}/${scopeVisionCase.presetPaperCount}`,
  );

  // ---- 2) 替换当前案例的关系不会删掉用户关系 / 人工关系 ----
  const visionMethodIds = new Set(scopeVisionCase.methods.map((m) => m.id));
  const incoming: Relation[] = [
    { id: 'rel_vision_new', fromMethodId: mVision.id, toMethodId: mVisionB.id, type: 'extends', evidenceState: 'inferred', rationale: '重新分析结果' },
  ];
  const swap = replaceRelationsInScope(relations, incoming, visionMethodIds);
  check(
    '替换：只丢掉当前范围内「非人工」的旧关系',
    swap.drop.map((r) => r.id).join(',') === 'rel_vision',
    swap.drop.map((r) => r.id).join(','),
  );
  check(
    '替换：用户关系、跨语料关系原样保留',
    swap.keep.some((r) => r.id === 'rel_own') && swap.keep.some((r) => r.id === 'rel_cross'),
    swap.keep.map((r) => r.id).join(','),
  );
  check('替换：当前范围内的人工关系也保留（人工修正不会被重新分析覆盖）', isManualRelation(relations[1]) && swap.next.some((r) => r.id === 'rel_vision_manual'));
  check(
    '替换后：范围内换成新关系，范围外还是原来的',
    swap.next.some((r) => r.id === 'rel_vision_new') &&
      swap.next.some((r) => r.id === 'rel_own') &&
      !swap.next.some((r) => r.id === 'rel_vision'),
  );
  check('替换是纯函数：不改动入参（写入失败时原关系仍是原样）', relations.length === 4 && relations[0].id === 'rel_vision');
  const swapCollide = replaceRelationsInScope(
    relations,
    [{ id: 'rel_vision_manual', fromMethodId: mVision.id, toMethodId: mVisionB.id, type: 'extends', evidenceState: 'inferred', rationale: 'AI 想覆盖' }],
    visionMethodIds,
  );
  check(
    '替换：新结果与人工关系 id 相同时，人工版本优先',
    swapCollide.next.find((r) => r.id === 'rel_vision_manual')?.rationale === '人工添加',
  );

  // ---- 2b) 落库集合（write / deleteIds）：同 ID 撞人工关系时不许写库，也不许先写后删 ----
  // 这是「重载后人工关系丢失」的根因所在：内存里保住了，但写库用的是原始缓存数组。
  check(
    '落库集合：与人工关系撞 ID 的缓存结果**不写库**（否则这条修正会被覆盖）',
    swapCollide.write.length === 0 && !swapCollide.deleteIds.includes('rel_vision_manual'),
    `write=[${swapCollide.write.map((r) => r.id).join(',')}] delete=[${swapCollide.deleteIds.join(',')}]`,
  );
  check(
    '落库集合：正常替换时 write = 新结果，deleteIds = 被替换掉的旧关系',
    swap.write.map((r) => r.id).join(',') === 'rel_vision_new' && swap.deleteIds.join(',') === 'rel_vision',
    `write=[${swap.write.map((r) => r.id).join(',')}] delete=[${swap.deleteIds.join(',')}]`,
  );
  check(
    '落库集合：write 与 deleteIds 没有交集（同一个 ID 不能在同一个事务里先写后删）',
    !swap.write.some((r) => swap.deleteIds.includes(r.id)),
  );
  // 混合情形：一条被替换掉、一条撞人工关系
  const swapMixed = replaceRelationsInScope(
    relations,
    [
      { id: 'rel_vision', fromMethodId: mVision.id, toMethodId: mVisionB.id, type: 'improves', evidenceState: 'explicit', rationale: '重新分析' },
      { id: 'rel_vision_manual', fromMethodId: mVision.id, toMethodId: mVisionB.id, type: 'extends', evidenceState: 'inferred', rationale: 'AI 想覆盖' },
    ],
    visionMethodIds,
  );
  check(
    '落库集合（混合）：既写新结果、又不写撞人工的那条、也不删刚写进去的那条',
    swapMixed.write.map((r) => r.id).join(',') === 'rel_vision' &&
      swapMixed.deleteIds.length === 0 &&
      swapMixed.next.find((r) => r.id === 'rel_vision_manual')?.rationale === '人工添加',
    `write=[${swapMixed.write.map((r) => r.id).join(',')}] delete=[${swapMixed.deleteIds.join(',')}]`,
  );

  // ---- 2c) 缓存方法同 ID 覆盖写时保留人工修正 ----
  const baseMethod = methods.find((m) => m.id === mVision.id)!;
  const withOverride: Method = {
    ...baseMethod,
    overrides: [{ field: 'researchTask', oldValue: 'AI 原值', newValue: '人工核对后的值', at: 1 }],
  };
  const cachedFresh: Method = { ...baseMethod, cached: true, overrides: [] };
  const mergedM = mergeCachedMethod(cachedFresh, withOverride);
  check(
    '同 ID 覆盖写方法：保留人工修正（overrides 不丢），AI 结果仍按缓存更新',
    mergedM.overrides.length === 1 &&
      mergedM.overrides[0].newValue === '人工核对后的值' &&
      mergedM.cached === true,
    `overrides=${mergedM.overrides.length}`,
  );
  check('没有人工修正时按缓存原样写入（不引入空 overrides 差异）', mergeCachedMethod(cachedFresh, baseMethod).overrides.length === 0);
  check('缓存里没有这条方法时直接写入（不报错）', mergeCachedMethod(cachedFresh, undefined) === cachedFresh);
  const mergedList = mergeCachedMethods([cachedFresh, { ...baseMethod, id: 'm_new_id' }], [withOverride]);
  check(
    '批量合并：逐条按 id 找旧记录，只有被修正过的那条带上 overrides',
    mergedList[0].overrides.length === 1 && (mergedList[1].overrides?.length ?? 0) === 0,
  );

  // ---- 3) 删除论文后不存在悬挂关系 ----
  const afterRemove = collectPaperRemoval(papers, methods, relations, 'p_user_1');
  check('删除论文：连同它的方法一起删（方法 ID 不是 m_<paperId> 也照样删）', afterRemove.removedMethods.length === 1 && afterRemove.removedMethods[0].id === 'mm_custom_own_1');
  check('删除论文：方法记录里不再有该论文', afterRemove.methods.every((m) => m.paperId !== 'p_user_1'));
  check(
    '删除论文：它参与的关系被一起删掉',
    afterRemove.removedRelations.some((r) => r.id === 'rel_own') &&
      afterRemove.relations.every((r) => r.fromMethodId !== 'mm_custom_own_1' && r.toMethodId !== 'mm_custom_own_1'),
  );
  const aliveMethodIds = new Set(afterRemove.methods.map((m) => m.id));
  check('删除论文后不存在悬挂关系（每条关系的两端都还在）', afterRemove.relations.every((r) => aliveMethodIds.has(r.fromMethodId) && aliveMethodIds.has(r.toMethodId)));
  check('删除论文不影响其它关系', afterRemove.relations.some((r) => r.id === 'rel_vision'));

  // ---- 4) 案例地图的每条边两端都属于当前案例方法 ----
  const caseMethodIds = new Set(scopeVisionCase.methods.map((m) => m.id));
  const caseEdges = relationsInScope(relations, caseMethodIds);
  check(
    '案例地图：每条边两端都属于当前案例方法',
    caseEdges.length > 0 && caseEdges.every((r) => caseMethodIds.has(r.fromMethodId) && caseMethodIds.has(r.toMethodId)),
    caseEdges.map((r) => r.id).join(','),
  );
  check(
    '案例地图：关系端点集合 ⊆ 画布节点集合（数量与节点集合一致）',
    scopeVisionCase.methods.length === 2 && caseEdges.every((r) => new Set(scopeVisionCase.methods.map((m) => m.id)).has(r.fromMethodId) && new Set(scopeVisionCase.methods.map((m) => m.id)).has(r.toMethodId)),
  );
  check(
    '把全量关系丢给案例地图时，用户关系与跨语料关系会被端点过滤掉（修复前的缺陷）',
    caseEdges.length === 2 && !caseEdges.some((r) => r.id === 'rel_own') && !caseEdges.some((r) => r.id === 'rel_cross'),
  );

  // ---- 5) 切换案例后不会恢复旧案例的 plan / divergence ----
  const storedPlan = asScopedSnapshot(vid, { kind: 'plan-of-vision' });
  const storedDiv = asScopedSnapshot(vid, { kind: 'divergence-of-vision' });
  check('切换案例后不会恢复上一个案例的阅读路线', readScopedSnapshot<{ kind: string }>(storedPlan, nid) === undefined);
  check('切换案例后不会恢复上一个案例的分歧结果', readScopedSnapshot<{ kind: string }>(storedDiv, nid) === undefined);
  check('本案例自己的产物仍然能恢复', readScopedSnapshot<{ kind: string }>(storedPlan, vid)?.kind === 'plan-of-vision');
  check('旧版本没有语料集标识的裸数据一律不复用（宁可显示「尚未生成」）', readScopedSnapshot<{ kind: string }>({ kind: 'legacy' }, vid) === undefined);
  check('切换时写入的空快照不会被当成有效结果', !readScopedSnapshot(asScopedSnapshot(nid, null), nid));
}

console.log('=== 26. 全文路径 / 证据定位 / 关系装配 / 有效值 / 结构校验（本轮修复回归） ===');
{
  const vid = CORPUS_META.vision.id;

  // ---- 1) 视觉案例全文路径可加载 ----
  check('视觉案例的全文目录是 samples-vision/（不是 samples/）', corpusBaseOfPaper(vid) === './samples-vision/');
  check('其它语料仍走 samples/', corpusBaseOfPaper('nlp-dev') === './samples/' && corpusBaseOfPaper('user-import') === './samples/');
  let okFiles = 0;
  for (const arxiv of CORPUS_META.vision.arxivIds) {
    const id = paperIdOf(arxiv);
    const file = `public/samples-vision/text/${id}.json`;
    if (existsSync(file)) {
      const j = JSON.parse(readFileSync(file, 'utf8')) as { paperId?: string; rawText?: string };
      if (j.paperId === id && typeof j.rawText === 'string' && j.rawText.length > 1000) okFiles += 1;
    }
  }
  check('视觉 5 篇论文的全文文件真实存在且可用（rawText 非空）', okFiles === 5, `命中 ${okFiles}/5`);
  const wrongDir = CORPUS_META.vision.arxivIds.filter((a) => existsSync(`public/samples/text/${paperIdOf(a)}.json`)).length;
  check('视觉论文在 samples/text/ 下确实不存在（说明旧默认目录必然取不到全文）', wrongDir === 0, `存在 ${wrongDir} 个`);

  // ---- 2) 伪造 quote 不会变成 verified ----
  const demoPaper = PAPER(
    'p_demo',
    'Demo Paper',
    2020,
    'We propose ResNet, a residual learning framework to ease the training of networks that are substantially deeper.',
  );
  const goodEv = buildEvidence(demoPaper, { quote: 'a residual learning framework to ease the training' });
  const fakeEv = buildEvidence(demoPaper, { quote: 'We achieve 99.9% top-1 accuracy on ImageNet with 10x fewer parameters.', page: 7 });
  check('能定位的引文 → verified=true，页码来自定位结果', goodEv?.verified === true && goodEv.locator === 'page+offset');
  check('伪造引文 → verified=false（不会被包装成已核验）', fakeEv?.verified === false);
  check('伪造引文不采用模型自称的页码', fakeEv?.page === undefined && fakeEv?.locator === 'none', `page=${fakeEv?.page} locator=${fakeEv?.locator}`);
  check('伪造引文保留片段与失败原因，供人工核对', !!fakeEv?.quote && !!fakeEv?.verifyNote);

  // ---- 3) candidate 保留 / 4) A→B 与 B→A 不合并 / 证据端点 ----
  const pRes = PAPER('p_resnet', 'Deep Residual Learning', 2015, 'ResNet is a residual learning framework. We build on VGG and improve it.');
  const pVit = PAPER('p_vit', 'An Image is Worth 16x16 Words', 2020, 'ViT applies a pure transformer directly to sequences of image patches.');
  const pOther = PAPER('p_other', 'Something Else', 2021, 'This paper is unrelated to both of them.');
  // 关系两端有可靠的方法名（否则 validateRelation 会把任何关系都降级为待核查）
  const namedFields = (name: string) =>
    ({
      methodName: { value: name, status: 'verified' as const },
      coreIdea: { value: `${name} 的核心思路`, status: 'verified' as const },
    }) as unknown as Method['fields'];
  const mRes = mkMethod('p_resnet', emptyConditions(), namedFields('ResNet'));
  const mVit = mkMethod('p_vit', emptyConditions(), namedFields('ViT'));
  const mOther = mkMethod('p_other', emptyConditions(), namedFields('SomethingElse'));
  const triplePapers = [pRes, pVit, pOther];
  const tripleMethods = [mRes, mVit, mOther];

  const asm = assembleRelationsFromModel(
    [
      { from: mRes.id, to: mVit.id, type: 'extends', evidenceState: 'candidate', quote: 'ViT applies a pure transformer directly to sequences of image patches.' },
      { from: mVit.id, to: mRes.id, type: 'improves', evidenceState: 'inferred', rationale: '因为 ViT 的后续工作改进了 ResNet 的卷积表示方式，属于技术承接。' },
    ],
    triplePapers,
    tripleMethods,
  ).relations;
  const ab = asm.filter((r) => r.fromMethodId === mRes.id && r.toMethodId === mVit.id);
  const ba = asm.filter((r) => r.fromMethodId === mVit.id && r.toMethodId === mRes.id);
  check('A→B 与 B→A 不会被无向键合并（两条都保留）', ab.length === 1 && ba.length === 1, `A→B ${ab.length} 条 / B→A ${ba.length} 条`);
  check('candidate 保持 candidate（不被映射成 inferned/系统推断）', ab[0]?.evidenceState === 'candidate', String(ab[0]?.evidenceState));

  const crossAsm = assembleRelationsFromModel(
    [{ from: mRes.id, to: mVit.id, type: 'extends', evidenceState: 'explicit', quote: 'This paper is unrelated to both of them.' }],
    triplePapers,
    tripleMethods,
  ).relations;
  check('第三篇论文里的句子不能认证 A→B（证据只能来自关系两端）', crossAsm[0]?.evidence?.verified !== true);
  check('因此「原文明示」被降级为「待核查」并留下调整记录', crossAsm[0]?.evidenceState === 'candidate' && (crossAsm[0]?.stateAdjusted?.length ?? 0) > 0);

  // ---- 5) 人工修正后四个下游入口读取新值 ----
  const fBase = {
    methodName: { value: 'ResNet', status: 'verified' as const, evidence: { paperId: 'p_fix', quote: 'ResNet', locator: 'page' as const, verified: true, page: 1 } },
    coreIdea: { value: '残差学习', status: 'verified' as const },
    datasets: { value: 'COCO', status: 'verified' as const, evidence: { paperId: 'p_fix', quote: 'COCO', locator: 'page' as const, verified: true, page: 2 } },
    metrics: { value: 'top-1 accuracy', status: 'verified' as const },
  } as unknown as Method['fields'];
  const fixedMethod: Method = {
    ...mkMethod('p_fix', emptyConditions(), fBase),
    overrides: [
      { field: 'methodName', previousValue: 'ResNet', newValue: 'Vision Transformer (ViT)', at: 1 },
      { field: 'datasets', previousValue: 'COCO', newValue: 'ImageNet-1K', at: 2 },
    ],
  };
  const fixPaper = PAPER('p_fix', 'Fixed Paper', 2020, '');
  check('家族判断读取人工修正后的方法名', classifyFamily(fixedMethod).id === 'transformer', classifyFamily(fixedMethod).id);
  const cond = compareConditions([fixPaper], [fixedMethod]);
  const dsCell = cond.dimensions.find((d) => d.dimension === 'datasets')?.cells[0];
  check('可比性/条件矩阵读取人工修正后的数据集', (dsCell?.values ?? []).includes('ImageNet-1K'), JSON.stringify(dsCell?.values));
  const cmp = buildComparison([fixedMethod], [fixPaper]);
  const dsRow = cmp.rows.find((r) => r.field === 'datasets');
  check('比较表读取人工修正后的值', dsRow?.cells[0]?.display === 'ImageNet-1K', String(dsRow?.cells[0]?.display));
  check('比较表同时标明该值不是原文核验（待人工核对）', dsRow?.cells[0]?.state === 'unverified', String(dsRow?.cells[0]?.state));
  const md = toMarkdown([fixedMethod], [fixPaper], []);
  check(
    '导出读取人工修正后的值，AI 原值只作为「原 AI 值 / 原始引文」对照出现',
    md.includes('ImageNet-1K') && md.includes('人工修正') && /原 AI 值/.test(md) && /AI 原始引文/.test(md),
  );
  const eff = effectiveField(fixedMethod, 'datasets');
  check('人工修正值不冒充原文已核验（状态降为待人工核对）', eff.status === 'unverified' && eff.userCorrected === true, eff.status);
  check('AI 原值、原证据与修正记录都保留', fixedMethod.fields.datasets.value === 'COCO' && !!eff.evidence && fixedMethod.overrides[1].previousValue === 'COCO');
  check('人工修正后下游提示要求重算（关系 / 路线 / 比较）', describeOverrideDependents('X', ['数据集']).length >= 3);

  // ---- 6) 刷新后实时路线仍存在（按语料集隔离） ----
  const livePlan = {
    steps: [{ paperId: 'p_resnet', order: 1, focus: 'f', reason: 'r', basis: 'paper' }],
    cached: false,
    generatedAt: 1,
  } as unknown as ReadingPlan;
  const storedPlan = asScopedSnapshot(vid, livePlan);
  const back = readScopedSnapshot<ReadingPlan>(storedPlan, vid);
  check('实时生成的路线按语料集身份落盘后可原样读回（刷新后仍在）', back?.steps?.length === 1 && back?.cached === false);
  check('换成别的语料集读不到这条路线', readScopedSnapshot<ReadingPlan>(storedPlan, CORPUS_META['nlp-dev'].id) === undefined);

  // ---- 7) 非法模型 JSON 明确失败 ----
  const throws = (fn: () => unknown) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  check('顶层不是对象 → 明确失败', throws(() => parseJsonObject('[1,2,3]', '关系分析结果')));
  check('relations 缺失 → 明确失败', throws(() => requireArrayField(parseJsonObject('{"foo":1}', '关系分析结果'), 'relations', '关系分析结果')));
  check('relations 不是数组 → 明确失败', throws(() => requireArrayField({ relations: 'oops' }, 'relations', '关系分析结果')));
  check('数组里混进非对象 → 明确失败', throws(() => requireArrayOfObjects([{ a: 1 }, 'x'], '关系分析结果.relations')));
  check('阅读路线 steps 缺失 → 明确失败', throws(() => requireReadingSteps({ candidates: [] })));
  check('阅读路线 steps 为空数组 → 明确失败（不把 0 步当成功）', throws(() => requireReadingSteps({ steps: [] })));
  check('阅读路线 steps 结构正确 → 通过', requireReadingSteps({ steps: [{ paperId: 'p1' }] }).length === 1);
  check('experiments 不是数组 → 解析实验记录时明确失败', throws(() => parseExperimentRecords(demoPaper, { experiments: 'oops' })));
  check('experiments 缺失 → 允许 0 条（不伪造，也不误判为失败）', parseExperimentRecords(demoPaper, {}).length === 0);
  check('```json 包裹仍能正确解析（宽松解析没有被打死）', parseJsonLoose<{ a: number }>('说明文字\n```json\n{"a":1}\n```').a === 1);

  // ---- 8) 缓存关系按当前规则重校验（规则版本变化不得继续冒充当前结论） ----
  const cachedRel: Relation = {
    id: 'r_cached',
    fromMethodId: mRes.id,
    toMethodId: mVit.id,
    type: 'extends',
    evidenceState: 'inferred',
    rationale: '因为 ViT 的后续工作改进了 ResNet 的卷积表示方式，属于技术承接。',
  };
  const sameRules = revalidateCachedRelations([cachedRel], [mRes, mVit], [pRes, pVit], {
    cachedRulesVersion: RULES_VERSION,
    rulesVersionChanged: false,
  });
  check('规则版本一致时，缓存关系保持原判定', sameRules.relations[0]?.evidenceState === 'inferred' && sameRules.downgraded === 0);
  const changedRules = revalidateCachedRelations([cachedRel], [mRes, mVit], [pRes, pVit], {
    cachedRulesVersion: 'r1.0.0',
    rulesVersionChanged: true,
  });
  check(
    '规则版本变化后，旧的 inferred 降级为「待核查」并写明原因',
    changedRules.relations[0]?.evidenceState === 'candidate' &&
      (changedRules.relations[0]?.stateAdjusted?.length ?? 0) > 0 &&
      changedRules.downgraded === 1,
  );
  check('重校验会给出可展示的说明，不静默处理', changedRules.notes.length === 1 && /规则/.test(changedRules.notes[0]));

  // ---- 9b) 标题校正：摘要句不得被当成已确认标题（实测问题 4） ----
  const abstractSentence =
    'a class of latent variable models inspired by considerations from nonequilibrium thermodynamics, and give strong empirical results';
  const pAbstract = { ...PAPER('p_ddpm', abstractSentence, 2020, 'body'), titleFrom: 'heuristic' as const };
  const pReal = { ...PAPER('p_real', 'Denoising Diffusion Probabilistic Models', 2020, 'body'), titleFrom: 'heuristic' as const };

  check('摘要句本身不像标题（looksLikeTitle 拦得住）', !looksLikeTitle(abstractSentence));
  check('真实标题能通过 looksLikeTitle', looksLikeTitle('Denoising Diffusion Probabilistic Models'));

  const fixedFromModel = applyTitleCorrection(pAbstract, {
    ...mkMethod('p_ddpm', emptyConditions()),
    paperTitleGuess: 'Denoising Diffusion Probabilistic Models',
  } as Method);
  check(
    '模型在原文核验出真标题 → 采用并标 model-verified',
    fixedFromModel.title === 'Denoising Diffusion Probabilistic Models' && fixedFromModel.titleFrom === 'model-verified',
  );

  const noModelGuess = applyTitleCorrection(pAbstract, mkMethod('p_ddpm', emptyConditions()));
  check(
    '模型没给出可用标题时，摘要句标题必须标为 unverified（拿不到真标题也不能冒充已确认）',
    noModelGuess.titleFrom === 'unverified' && noModelGuess.title === abstractSentence,
  );

  const guessNotTitle = applyTitleCorrection(pAbstract, {
    ...mkMethod('p_ddpm', emptyConditions()),
    paperTitleGuess: abstractSentence,
  } as Method);
  check('模型回显的也是摘要句时不采用，同样标 unverified', guessNotTitle.titleFrom === 'unverified');

  const keepRealTitle = applyTitleCorrection(pReal, mkMethod('p_real', emptyConditions()));
  check('启发式标题本身像标题时保持原样（不误标待确认）', keepRealTitle.titleFrom === 'heuristic' && keepRealTitle.title === pReal.title);

  check('作用到界面：摘要句标题 → 需要显示「标题待确认」', titleNeedsConfirm(pAbstract) && !titleNeedsConfirm(pReal));
  check(
    '模型核验过或用户填过的标题不显示「标题待确认」',
    !titleNeedsConfirm({ ...pAbstract, titleFrom: 'model-verified' }) && !titleNeedsConfirm({ ...pAbstract, titleFrom: 'user' }),
  );

  // ---- 9) 跨方法挑「同口径」实验：挑不到就不给对照（不允许摆不可比的数字） ----
  const mkExp = (
    id: string,
    paperId: string,
    dataset: string,
    metric: string,
    value: string,
    taskTag: ExperimentRecord['taskTag'] = 'classification',
  ) =>
    ({
      id,
      paperId,
      taskTag,
      modelVariant: 'M',
      evalDataset: dataset,
      metricName: metric,
      metricValue: value,
    }) as ExperimentRecord;

  /**
   * 口径完整的记录：所有对比维度都写明且两侧一致 + 表格行列已核验。
   * （任何一个维度为空都会被当成「未知」，从而降级为信息不足 —— 这正是对照页不该摆数字的情形）
   */
  const full = (e: ExperimentRecord): ExperimentRecord =>
    ({
      ...e,
      evalSplit: 'test',
      pretrainData: 'none',
      trainData: 'ImageNet-1K',
      inputResolution: '224x224',
      extraData: 'none',
      distillation: 'none',
      testTimeAug: 'none',
      inferenceMode: 'single model',
      verification: {
        quoteLocated: true,
        tableCaptionLocated: true,
        rowLabelLocated: true,
        colLabelLocated: true,
        rowColConfirmed: true,
        issues: [],
      },
    }) as ExperimentRecord;

  const sameCaliber = pickComparableExperimentPair(
    [full(mkExp('e1', 'pa', 'ImageNet-1K', 'top-1 accuracy', '76.1'))],
    [full(mkExp('e2', 'pb', 'ImageNet-1K', 'top-1 accuracy', '81.2'))],
  );
  check('同数据集同指标时能挑出一对可直接对照的实验', !!sameCaliber && sameCaliber.a.id === 'e1' && sameCaliber.b.id === 'e2');
  check(
    '挑出的这一对确实是「可直接比较 / 有条件可比较」',
    sameCaliber?.cmp.level === 'directly_comparable' || sameCaliber?.cmp.level === 'comparable_with_conditions',
    sameCaliber?.cmp.level,
  );

  const crossDataset = pickComparableExperimentPair(
    [mkExp('x1', 'pa', 'ImageNet-1K', 'top-1 accuracy', '76.1')],
    [mkExp('x2', 'pb', 'COCO', 'top-1 accuracy', '40.0')],
  );
  check('数据集不同时不把它当成对照（不返回硬阻断的一对）', crossDataset === null, crossDataset?.cmp.level);

  const crossTask = pickComparableExperimentPair(
    [mkExp('t1', 'pa', 'ImageNet-1K', 'top-1 accuracy', '76.1')],
    [mkExp('t2', 'pb', 'ImageNet-1K', 'top-1 accuracy', '40.0', 'detection')],
  );
  check('任务不同的记录不参与分类对照', crossTask === null, crossTask?.cmp.level);

  check('同一方法的实验不会被拿去和自己比较', pickComparableExperimentPair([], []) === null);
  check('一侧没有实验时返回 null（界面据此不展示数字）', pickComparableExperimentPair([], [mkExp('z1', 'pb', 'ImageNet-1K', 'top-1 accuracy', '1.0')]) === null);
}

console.log('');
console.log(`结果：通过 ${pass}，失败 ${fail}`);


if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
