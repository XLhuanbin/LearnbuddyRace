/**
 * 跨论文比较。
 *
 * 第二阶段改动：
 * - 字段状态改用四态（可核验 / 待人工核对 / 未找到证据 / 缺失）；
 * - 引入 comparability.ts 的规则化不可比检测，给出「可以直接比较 / 只能有限比较 / 当前不能直接比较」；
 * - 仍然不做排名：条件不一致时明确禁止横向比较，条件一致时也只做同口径并列。
 */

import type { Method, Paper, Relation, FieldKey } from './types';
import {
  CONDITION_DIMENSIONS,
  CONDITION_LABELS,
  FIELD_STATUS_TEXT,
  METHOD_FIELD_LABELS,
  RELATION_LABELS,
  RELATION_STATE_LABELS,
} from './types';
import { compareConditions, conditionOf, LEVEL_LABELS, type ComparabilityReport } from './comparability';
import { withEffectiveMethods } from './effective';

export interface CompareCell {
  field: FieldKey;
  label: string;
  display: string;
  state: Method['fields'][FieldKey]['status'];
  stateText: string;
  note?: string;
  method?: Method;
}

export interface CompareRow {
  field: FieldKey;
  label: string;
  cells: CompareCell[];
}

export interface CompareResult {
  columns: Method[];
  rows: CompareRow[];
  /** 规则化不可比检测结果 */
  comparability: ComparabilityReport;
  globalWarnings: string[];
}

const COMPARE_FIELDS: FieldKey[] = [
  'researchTask',
  'methodName',
  'coreIdea',
  'inputsConditions',
  'datasets',
  'metrics',
  'limitations',
];

function cellOf(field: FieldKey, m: Method): CompareCell {
  const r = m.fields[field];
  const label = METHOD_FIELD_LABELS[field];
  if (!r || !r.value) {
    return {
      field,
      label,
      display: r?.note?.includes('未报告') ? '论文未报告' : '未提取到',
      state: 'missing',
      stateText: FIELD_STATUS_TEXT.missing,
      note: r?.note || '该字段在论文中未找到内容',
      method: m,
    };
  }
  return {
    field,
    label,
    display: r.value,
    state: r.status,
    stateText: FIELD_STATUS_TEXT[r.status],
    note: r.status === 'verified' ? undefined : r.note,
    method: m,
  };
}

export function buildComparison(methodsIn: Method[], papers: Paper[]): CompareResult {
  // 比较表读人工修正后的有效值（AI 原值仍保留在 overrides 里，可对照）
  const methods = withEffectiveMethods(methodsIn);
  const rows: CompareRow[] = COMPARE_FIELDS.map((field) => ({
    field,
    label: METHOD_FIELD_LABELS[field],
    cells: methods.map((m) => cellOf(field, m)),
  }));

  const comparability = compareConditions(papers, methods);

  const globalWarnings: string[] = [
    `可比性结论：${LEVEL_LABELS[comparability.overall.level]}。${comparability.overall.summary}`,
  ];
  if (!comparability.overall.numericComparisonAllowed) {
    globalWarnings.push('条件不一致，系统不提供任何形式的性能排名，也不做优劣判断。');
  } else {
    globalWarnings.push('已检查条件一致，可做同口径对照；但系统仍不会自动排名，请回到原文核对具体数值。');
  }
  const yearsMissing = methods.filter((m) => !papers.find((p) => p.id === m.paperId)?.year).length;
  if (yearsMissing) globalWarnings.push(`有 ${yearsMissing} 篇论文年份未识别，时间顺序提示可能不完整。`);

  return { columns: methods, rows, comparability, globalWarnings };
}

/** 导出为 Markdown（依据交接文档 §4 P0-5） */
export function toMarkdown(
  methodsIn: Method[],
  papers: Paper[],
  relations: {
    fromPaperTitle: string;
    toPaperTitle: string;
    type: string;
    evidenceState: string;
    evidence?: string;
    rationale?: string;
  }[],
): string {
  // 导出同样只写人工修正后的有效值（AI 原值与修正记录保留在本机数据里）
  const methods = withEffectiveMethods(methodsIn);
  const paperById = new Map(papers.map((p) => [p.id, p]));
  const lines: string[] = [];
  lines.push('# 论文方法对比（ResearchPilot 导出）');
  lines.push('');
  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('> 说明：字段值来自模型抽取，标注「可核验」的条目其引文已通过论文全文定位校验；');
  lines.push('> 标注「待人工核对」的条目引文未能定位，仅供参考；「缺失」表示论文未报告或未提取到。');
  lines.push('> 系统不对方法效果做排名。');
  lines.push('');

  const cmp = buildComparison(methods, papers);
  lines.push('## 可比性判断（规则计算）');
  lines.push('');
  lines.push(`**总体结论：${LEVEL_LABELS[cmp.comparability.overall.level]}** —— ${cmp.comparability.overall.summary}`);
  lines.push('');
  lines.push('| 条件维度 | 结论 | 具体差异 |');
  lines.push('| --- | --- | --- |');
  for (const d of cmp.comparability.dimensions) {
    lines.push(`| ${d.label} | ${LEVEL_LABELS[d.level]} | ${d.differences.join('；') || '—'} |`);
  }
  lines.push('');

  methods.forEach((m, i) => {
    const p = paperById.get(m.paperId);
    lines.push(`## ${i + 1}. ${p?.title || m.paperId}`);
    lines.push('');
    lines.push(`- 来源：${p?.source.url || '本地上传文件'}`);
    lines.push(`- 年份：${p?.year ?? '未识别'}`);
    lines.push(`- 作者：${p?.authors.length ? p.authors.join(', ') : '未识别'}`);
    lines.push('');
    COMPARE_FIELDS.forEach((f) => {
      const r = m.fields[f];
      const label = METHOD_FIELD_LABELS[f];
      if (!r?.value) {
        lines.push(`- **${label}**：${r?.note?.includes('未报告') ? '论文未报告' : '未提取到'}`);
        return;
      }
      const tag = r.userCorrected
        ? '人工修正，不是原文核验结果'
        : r.status === 'verified'
          ? `可核验，p.${r.evidence?.page ?? '?'}`
          : FIELD_STATUS_TEXT[r.status];
      lines.push(`- **${label}**：${r.value}（${tag}）`);
      const ov = m.overrides?.find((o) => o.field === f);
      if (r.userCorrected && ov) {
        lines.push(`  - 人工修正：原 AI 值「${ov.previousValue ?? '（空）'}」→ 现值「${ov.newValue}」（修正值按待人工核对对待）`);
      }
      if (r.evidence?.verified && r.evidence.quote) {
        lines.push(
          `  > ${r.userCorrected ? '（AI 原始引文，仅供对照）' : ''}${r.evidence.quote.replace(/\s+/g, ' ').slice(0, 300)}`,
        );
      }
    });
    if (m.conditions) {
      lines.push('');
      lines.push('  实验条件：');
      // 逐维度取「有效条件」：人工修正过的数据集/指标不会被 conditions 里的旧值盖住
      for (const dim of CONDITION_DIMENSIONS) {
        const c = conditionOf(m, dim);
        const statusText =
          c.status === 'verified'
            ? `可核验 p.${c.evidence?.page ?? '?'}`
            : c.status === 'unverified'
              ? '待人工核对'
              : c.status === 'not_reported'
                ? '论文未报告'
                : '无法确认';
        lines.push(
          `  - ${CONDITION_LABELS[dim]}：${c.values.join('、') || (c.status === 'not_reported' ? '论文未报告' : '无法确认')}（${statusText}）`,
        );
      }
    }
    lines.push('');
  });

  if (relations.length) {
    lines.push('## 方法关系');
    lines.push('');
    lines.push('| 起点 | 终点 | 关系 | 可信度 | 依据 |');
    lines.push('| --- | --- | --- | --- | --- |');
    relations.forEach((r) => {
      lines.push(
        `| ${r.fromPaperTitle} | ${r.toPaperTitle} | ${r.type} | ${r.evidenceState} | ${
          (r.evidence || r.rationale || '—').replace(/\s+/g, ' ').slice(0, 140) || '—'
        } |`,
      );
    });
    lines.push('');
    lines.push('> 可信度含义：原文明示=论文有明确陈述且引文已定位；系统推断=基于原文内容的推断并附理由；待核查=依据不足，需人工确认。');
    lines.push('');
  }

  lines.push('---');
  lines.push('本文件不包含任何 API 密钥。');
  return lines.join('\n');
}

/** 关系导出用的标签辅助 */
export function relationLabels(r: Relation) {
  return {
    type: RELATION_LABELS[r.type],
    state: RELATION_STATE_LABELS[r.evidenceState],
  };
}
