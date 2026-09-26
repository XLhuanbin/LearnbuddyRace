/**
 * 程序校验层。
 *
 * 本轮修正的关键点：
 * 1. 关系「原文明示」的判定不再只看「有没有引文」，而是用 rules.ts 的
 *    assessRelationEvidence 逐项检查：是否指名被继承方法（含别名）、是否具备继承/改进措辞或引用标记。
 *    降级理由必须写清「查到了什么、缺什么」，不允许出现与原文矛盾的说明。
 * 2. 条件条目要做「引文是否支撑主张」的范围检查：局部实验描述不能支持整篇论文级的否定结论。
 * 3. 未提取到 / 未报告 / 明确没有 三种情况分开标记。
 */

import type { Method, Paper, Relation, ValidationIssue } from './types';
import {
  CONDITION_DIMENSIONS,
  CONDITION_LABELS,
  FIELD_STATUS_TEXT,
  ISSUE_CODE_TEXT,
  METHOD_FIELD_LABELS,
  RELATION_LABELS,
} from './types';
import { locateQuote } from './text';
import { RULES_VERSION, assessClaimScope, assessRelationEvidence, looksLikeNegation, looksLikeTitle } from './rules';

export const MIN_QUOTE_CHARS = 20;
export { RULES_VERSION };

let seq = 0;
function issue(
  scope: ValidationIssue['scope'],
  refId: string,
  code: ValidationIssue['code'],
  severity: ValidationIssue['severity'],
  message: string,
  action: string,
  field?: string,
): ValidationIssue {
  seq += 1;
  return { id: `vi_${Date.now().toString(36)}_${seq}`, scope, refId, field, code, severity, message, action, at: Date.now() };
}

export function codeText(code: ValidationIssue['code']): string {
  return ISSUE_CODE_TEXT[code];
}

export function validateMethod(paper: Paper | undefined, method: Method): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pageCount = paper?.pageCount ?? paper?.pages.length ?? 0;

  for (const [key, r] of Object.entries(method.fields) as [
    keyof typeof method.fields,
    Method['fields'][keyof Method['fields']],
  ][]) {
    const label = METHOD_FIELD_LABELS[key];

    if (!r.value) {
      issues.push(
        issue(
          'method',
          method.id,
          'field_missing',
          'info',
          `${label}：${r.note?.includes('未报告') ? '论文未报告' : r.note?.includes('片段') ? '本次片段中未提取到' : '未提取到'}，系统未做补猜。`,
          '如需该字段，可人工查看原文后填写修正值。',
          key,
        ),
      );
      continue;
    }

    if (!r.evidence) {
      issues.push(
        issue(
          'method',
          method.id,
          'evidence_missing',
          'warn',
          `${label}：模型给出了内容但没有提供任何原文引文，标记为「${FIELD_STATUS_TEXT.no_evidence}」。`,
          '该值不作为可核验结论使用，需要人工回到原文核对。',
          key,
        ),
      );
      continue;
    }

    if (!r.evidence.verified) {
      issues.push(
        issue(
          'method',
          method.id,
          'evidence_not_located',
          'warn',
          `${label}：模型引文未能在论文全文中定位（${
            r.evidence.matchType === 'partial'
              ? `仅前 ${Math.round((r.evidence.coverage ?? 0) * 100)}% 可匹配，尾部疑似改写`
              : '可能改写了原文或凭记忆生成'
          }），标记为「${FIELD_STATUS_TEXT.unverified}」。`,
          '已保留模型给出的引文供对照，并展示实际匹配位置；不显示页码。',
          key,
        ),
      );
      continue;
    }

    const located = paper ? locateQuote(paper.rawText, r.evidence.quote) : null;
    if (located && located.matchedLength < MIN_QUOTE_CHARS) {
      issues.push(
        issue('method', method.id, 'quote_too_short', 'info', `${label}：引文偏短（匹配 ${located.matchedLength} 字符），证据强度有限。`, '建议人工确认该短句是否足以支撑结论。', key),
      );
    }

    const claimed = r.claimedPage;
    if (claimed !== undefined) {
      if (pageCount > 0 && (claimed < 1 || claimed > pageCount)) {
        issues.push(
          issue(
            'method',
            method.id,
            'page_invalid',
            'error',
            `${label}：模型给出的页码 p.${claimed} 超出该论文页数（共 ${pageCount} 页），已判为无效。`,
            `界面只显示程序定位得到的真实页码${r.evidence.page ? ` p.${r.evidence.page}` : '（无法确定）'}。`,
            key,
          ),
        );
      } else if (r.evidence.page !== undefined && claimed !== r.evidence.page) {
        issues.push(
          issue(
            'method',
            method.id,
            'page_mismatch',
            'warn',
            `${label}：模型自称页码 p.${claimed}，但引文实际定位在第 ${r.evidence.page} 页，已采用实际定位结果。`,
            '系统不采信模型自报页码，一律以全文定位结果为准。',
            key,
          ),
        );
      }
    }
  }

  // 标题可信度：启发式抓错、模型也只是回显原文句子时，明确标为未确认
  if (paper && paper.titleFrom !== 'model-verified' && !looksLikeTitle(paper.title)) {
    issues.push(
      issue(
        'paper',
        paper.id,
        'title_unverified',
        'warn',
        `标题未确认：当前标题「${paper.title.slice(0, 60)}…」取自 PDF 首页文本，看起来不是论文标题。`,
        '请在论文库中人工修正标题（保存后本机记录以人工值为准）。',
      ),
    );
  }

  // 页数元数据：没有可靠页数时界面显示「页数未知」，不能显示 0
  if (paper && paper.charCount > 0 && !paper.pageCount) {
    issues.push(
      issue('paper', paper.id, 'page_count_unknown', 'info', '该论文的页数元数据缺失，界面上会显示「页数未知」而不是 0。', '重新解析该论文或用完整语料重新生成即可补全页数。'),
    );
  }

  // 条件校验
  if (method.conditions) {
    for (const dim of CONDITION_DIMENSIONS) {
      const c = method.conditions[dim];
      const label = CONDITION_LABELS[dim];

      if (c.structureMigrated) {
        issues.push(
          issue(
            'method',
            method.id,
            'condition_structure_migrated',
            'warn',
            `${label}：该条目由早期字段结构迁移而来，未按当前结构重新抽取，可能缺少「适用范围 / 训练阶段」等必要信息。`,
            '需要重新生成该论文的分析结果后才能用于严格比较。',
            dim,
          ),
        );
      }

      if (c.status === 'verified') {
        // 范围检查：局部实验描述不能支撑整篇论文级的否定结论
        if (c.evidence?.verified && looksLikeNegation(c.values)) {
          const scope = assessClaimScope(c.evidence.quote, true);
          if (!scope.supportsPaperLevelClaim) {
            issues.push(
              issue(
                'method',
                method.id,
                'evidence_scope_mismatch',
                'warn',
                `${label}：${scope.reason}（当前取值：${c.values.join('、')}）`,
                '该条件已按「待人工核对」处理，不参与一致性判断；需要找到论文级的相应表述才能作为结论。',
                dim,
              ),
            );
          }
        }
        continue;
      }

      if (c.status === 'not_extracted') {
        issues.push(
          issue(
            'method',
            method.id,
            'condition_not_extracted',
            dim === 'computeResources' ? 'info' : 'warn',
            `${label}：本次提供的片段中未提取到该信息（不等于论文没有报告）。比较时按「信息不足」处理。`,
            dim === 'computeResources' ? '无法据此判断能否在你的设备上运行，系统不会推测。' : '该维度不参与一致性判断。',
            dim,
          ),
        );
      } else if (c.status === 'not_reported') {
        issues.push(
          issue(
            'method',
            method.id,
            'condition_unconfirmed',
            'info',
            `${label}：论文明确表示不适用 / 没有使用。`,
            '该情况属于「明确没有」，可与同为「明确没有」的论文做一致性判断。',
            dim,
          ),
        );
      } else if (c.status === 'unclear') {
        issues.push(
          issue('method', method.id, 'condition_unconfirmed', 'warn', `${label}：无法确认（表述含糊）。`, '需要人工回到原文确认后再用于比较。', dim),
        );
      } else if (c.status === 'unverified') {
        issues.push(
          issue(
            'method',
            method.id,
            'evidence_not_located',
            'warn',
            `${label}：有内容但引文未通过定位校验或未支撑该主张。`,
            '该条件按「信息不足」处理，不参与一致性判断。',
            dim,
          ),
        );
      }
    }
  }

  return issues;
}

/**
 * 校验关系：
 * - 原文明示必须同时满足「指名被继承方法（含别名）」与「继承/改进措辞或引用标记」；
 * - 降级理由必须准确描述查到了什么、缺什么；
 * - 依据不足一律降级为「待核查」，并说明这不代表系统断言关系不存在。
 */
export function validateRelation(
  rel: Relation,
  methods: Method[],
  papers: Paper[],
): { relation: Relation; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const next: Relation = { ...rel, stateAdjusted: [...(rel.stateAdjusted ?? [])] };
  const fromMethod = methods.find((m) => m.id === rel.fromMethodId);
  const toMethod = methods.find((m) => m.id === rel.toMethodId);
  const fromPaper = papers.find((p) => p.id === fromMethod?.paperId);
  const toPaper = papers.find((p) => p.id === toMethod?.paperId);
  const label = `${fromPaper?.title?.slice(0, 30) ?? '?'} → ${toPaper?.title?.slice(0, 30) ?? '?'}`;

  const downgrade = (to: Relation['evidenceState'], reason: string, code: ValidationIssue['code'] = 'relation_downgraded') => {
    if (next.evidenceState === to) return;
    next.stateAdjusted!.push({ from: next.evidenceState, to, reason });
    issues.push(
      issue(
        'relation',
        rel.id,
        code,
        to === 'candidate' ? 'warn' : 'info',
        `${label}（${RELATION_LABELS[rel.type]}）：可信度由「${stateLabel(next.evidenceState)}」调整为「${stateLabel(to)}」。${reason}`,
        to === 'candidate'
          ? '该关系保留为「待核查」：这不代表系统断言关系不存在，只是当前片段不足以认证。'
          : '已按更保守的可信度展示。',
      ),
    );
    next.evidenceState = to;
  };

  if (next.evidenceState === 'explicit') {
    const quote = next.evidence?.quote ?? '';
    if (!next.evidence?.verified) {
      downgrade(
        'candidate',
        next.evidence
          ? `引文未能在原文中定位（${next.evidence.verifyNote ?? '无法核实'}）。`
          : '模型声称论文明确陈述，但没有给出任何原文引文。',
      );
    } else {
      const assessment = assessRelationEvidence(
        quote,
        fromMethod?.fields?.methodName?.value,
        toMethod?.fields?.methodName?.value,
        next.type,
      );
      next.evidenceAssessment = assessment.reason;
      if (!assessment.sufficient) {
        downgrade(
          'candidate',
          `证据不足以认证该具体关系。${assessment.reason}`,
          assessment.mentionsFrom ? 'relation_downgraded' : 'relation_endpoint_unnamed',
        );
      }
    }
  }

  if (next.evidenceState === 'inferred') {
    const r = (next.rationale ?? '').trim();
    if (r.length < 20) {
      downgrade('candidate', r ? `推断理由过短（${r.length} 字），不足以支撑推断。` : '没有给出推断理由。');
    } else if (/^(两者都|都属于|都是|关键词|相似|同上|无需)/.test(r) && !/(因为|依据|由于|原文|构成|目标|任务|设置)/.test(r)) {
      downgrade('candidate', '推断理由仅凭共同关键词或笼统归类，未说明技术承接关系。');
    }
  }

  // 字段记录可能不完整（历史缓存 / 迁移数据），这里必须容错：缺字段不等于崩溃
  const fromName = fromMethod?.fields?.methodName?.value;
  const toName = toMethod?.fields?.methodName?.value;
  if (next.evidenceState !== 'candidate' && (!fromName || !toName)) {
    downgrade('candidate', '关系两端至少有一方未抽取出可靠的方法名称，无法确认关系主体。');
  }

  if (!next.rationale || next.rationale.trim().length < 10) {
    next.rationale =
      next.evidenceState === 'explicit'
        ? `论文原文明确陈述了该关系，证据见引文（p.${next.evidence?.page ?? '?'}）。`
        : '模型未提供充分理由，该关系仅作为待核查候选。';
    issues.push(
      issue('relation', rel.id, 'relation_no_basis', 'info', `${label}：模型未给出有效依据，已补写说明并保留为「${stateLabel(next.evidenceState)}」。`, '建议人工核对后再使用该关系。'),
    );
  }

  return { relation: next, issues };
}

function stateLabel(s: Relation['evidenceState']): string {
  return s === 'explicit' ? '原文明示' : s === 'inferred' ? '系统推断' : '待核查';
}

export function summarizeIssues(issues: ValidationIssue[]) {
  const bySeverity = { error: 0, warn: 0, info: 0 } as Record<ValidationIssue['severity'], number>;
  const byCode: Record<string, number> = {};
  for (const i of issues) {
    bySeverity[i.severity] += 1;
    byCode[i.code] = (byCode[i.code] ?? 0) + 1;
  }
  return { total: issues.length, bySeverity, byCode };
}
