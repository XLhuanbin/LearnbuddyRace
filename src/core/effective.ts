/**
 * 人工修正后的「有效字段」（唯一入口）。
 *
 * 背景：用户可以在论文详情里手工修正字段，`Method.overrides` 保底记录了 AI 原值与修正值，
 * 但地图、关系分析、跨论文比较、家族判断、阅读路线、导出与模型 prompt 过去读的都是
 * `m.fields[k].value`，于是人工修正只在论文详情里看得见，下游全都当它不存在。
 *
 * 约定（不可妥协的部分）：
 * 1. 有效值 = **最后一次人工修正**的值；没有任何修正时就是模型抽取值。
 * 2. 人工修正**不是原文核验**：状态一律降为「待人工核对」(unverified)，
 *    AI 原值（overrides[].previousValue）与原证据（fields[k].evidence）都保留下来供对照，
 *    绝不冒充「可核验」。
 * 3. 本模块是纯函数，不修改入参对象。
 */

import type { FieldKey, Method, MethodFieldResult, UserOverride } from './types';
import { METHOD_FIELD_LABELS } from './types';

export const FIELD_KEY_LIST = Object.keys(METHOD_FIELD_LABELS) as FieldKey[];

/** 某字段的最后一次人工修正（没有则 undefined） */
export function overrideFor(m: Method | undefined, k: FieldKey): UserOverride | undefined {
  const list = (m?.overrides ?? []).filter((o) => o.field === k);
  return list.length ? list[list.length - 1] : undefined;
}

/** 单字段的有效值：人工修正优先，并明确标注「不是原文核验」 */
export function effectiveField(m: Method, k: FieldKey): MethodFieldResult {
  const base: MethodFieldResult = m.fields?.[k] ?? { status: 'missing' };
  const ov = overrideFor(m, k);
  if (!ov) return base;
  const value = (ov.newValue ?? '').trim();
  const previous = (ov.previousValue ?? '').trim();
  return {
    ...base,
    value: value || undefined,
    // 人工修正不能冒充原文已核验
    status: value ? 'unverified' : 'missing',
    userCorrected: true,
    note: value
      ? `人工修正值（原 AI 值：${previous ? `「${previous.slice(0, 80)}」` : '（空）'}）。该值不是原文核验结果，使用时按「待人工核对」对待。`
      : '人工清空了该字段。',
  };
}

/** 全部字段的有效值 */
export function effectiveFields(m: Method): Record<FieldKey, MethodFieldResult> {
  const out = {} as Record<FieldKey, MethodFieldResult>;
  for (const k of FIELD_KEY_LIST) out[k] = effectiveField(m, k);
  return out;
}

/** 有效值字符串（读不到就是空串，界面据此显示「信息不足」） */
export function effectiveFieldValue(m: Method | undefined, k: FieldKey): string {
  if (!m) return '';
  return effectiveField(m, k).value ?? '';
}

/** 字段已换成有效值的方法副本；没有人工修正时原样返回（不制造新对象） */
export function withEffectiveFields(m: Method): Method {
  if (!m?.overrides?.length) return m;
  return { ...m, fields: effectiveFields(m) };
}

/** 批量版本：所有下游入口统一先过这一层 */
export function withEffectiveMethods(ms: Method[]): Method[] {
  return ms.map(withEffectiveFields);
}

/** 是否有人工修正（界面标签与统计用） */
export function hasOverrides(m: Method | undefined): boolean {
  return Boolean(m?.overrides?.length);
}

/** 人工修正涉及哪些字段（提示「哪些结论需要重算」时用） */
export function overriddenFieldLabels(m: Method | undefined): string[] {
  const fields = new Set((m?.overrides ?? []).map((o) => o.field));
  return [...fields].map((k) => METHOD_FIELD_LABELS[k]);
}
