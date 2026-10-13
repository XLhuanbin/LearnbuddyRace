/**
 * 重新分析（re-analysis）的纯逻辑：便于测试，也避免把规则散落在界面代码里。
 *
 * 约定（与界面行为一一对应）：
 * 1. 只有**成功**时才替换结果；失败或取消都保留原结果（由调用方保证：保存动作只在成功后执行）。
 * 2. 重新分析**不覆盖人工修正**：旧结果里的 override 会合并进新结果。
 * 3. 重新分析后，由模型生成的**下游结果**（方法关系、方法决策）需要重新生成；
 *    跨论文比较与分歧的可比性由程序按当前数据实时重算，因此不需要重新生成，但仍应提示用户复核。
 */

import type { ExperimentRecord, Method } from './types';
import { experimentIdentityKey } from './experiments';

/** 人工修正记录（实际使用 field + previousValue/newValue；这里保持宽松以便测试与兼容） */
export interface OverrideLike {
  field?: string;
  previousValue?: string;
  newValue?: string;
  value?: string;
  note?: string;
  at?: number;
}

/** 合并重新分析结果：保留人工修正，替换模型输出 */
export function mergeReanalysisResult(prev: Method | undefined, next: Method): Method {
  const prevOverrides = (prev?.overrides ?? []) as OverrideLike[];
  const nextOverrides = (next.overrides ?? []) as OverrideLike[];
  const merged: OverrideLike[] = [...prevOverrides];
  for (const o of nextOverrides) {
    if (!merged.some((x) => x.field === o.field)) merged.push(o);
  }
  /**
   * 实验记录上的人工产物（条件补充 `supplements` 与「已确认」标记 `userSupplemented`）必须保留 ——
   * 重新分析会**整份替换**实验记录，不搬过去就等于全丢。
   *
   * ⚠️ 两处修复（P1/P2，均已复现）：
   *
   * ① **匹配键不足**：旧键是「模型变体 | 指标名 | 评估集」。实测把评估划分从 val 改成 test 之后，
   *    旧记录的确认仍然被带到新记录上 —— 条件已经变了，确认却还留着。
   *    现在统一用 `experimentIdentityKey`（论文 + 任务 + 模型 + 数据集 + **划分** + **分辨率** + 指标 + 单位），
   *    条件一变键就变，相应的人工产物自然失效。
   *
   * ② **同模型同指标的多条记录互相覆盖**：旧实现是 `Map<key, 标记>`，同键的 N 条旧记录只剩最后一条，
   *    匹配时所有新记录都拿到同一份标记（N 条挤成 1 条，且可能张冠李戴）。
   *    现在用「键 → 队列」，按出现顺序**一一对应**地发放；新记录比旧记录多时多出来的不带标记，
   *    比旧记录少时多余的旧标记自然丢弃（不留到下次误配）。
   */
  const pool = new Map<string, ExperimentRecord[]>();
  for (const e of prev?.experiments ?? []) {
    if (!e.supplements?.length && !e.userSupplemented?.length) continue;
    const k = experimentIdentityKey(e);
    const bucket = pool.get(k);
    if (bucket) bucket.push(e);
    else pool.set(k, [e]);
  }
  let carriedAny = false;
  const experiments = (next.experiments ?? []).map((e) => {
    const bucket = pool.get(experimentIdentityKey(e));
    const src = bucket?.shift();
    if (!src) return e;
    carriedAny = true;
    return {
      ...e,
      ...(src.supplements?.length ? { supplements: src.supplements } : {}),
      ...(src.userSupplemented?.length ? { userSupplemented: src.userSupplemented } : {}),
    };
  });
  return {
    ...next,
    ...(next.experiments?.length && carriedAny ? { experiments } : {}),
    overrides: merged as Method['overrides'],
    cached: false,
  };
}

/** 重新分析成功后需要用户注意的下游影响（用于界面提示，不自动改动任何结果） */
export function describeDependents(paperTitle: string): { item: string; action: string }[] {
  return [
    { item: '方法关系图', action: '关系由模型生成，需要重新推断后再作为当前结论' },
    { item: '方法决策（推荐与阅读顺序）', action: '推荐依据已变化，需要重新生成' },
    {
      item: '跨论文比较 / 分歧',
      action: '可比性由程序按当前数据实时重算，无需重新生成；但受影响的论文对建议人工复核',
    },
    { item: `论文：${paperTitle}`, action: '人工修正已保留，不会被本次重新分析覆盖' },
  ];
}

/**
 * 人工修正字段后需要重算/复核的下游。
 *
 * 与「重新分析」的区别：这里**不重新调用模型**，但人工修正改变了分析所依据的有效值，
 * 因此关系、阅读路线、比较与分歧都必须进入「待重算 / 需复核」状态，不能继续显示旧结论。
 * 同时说明：人工修正值不是原文核验结果。
 */
export function describeOverrideDependents(
  paperTitle: string,
  fieldLabels: string[],
): { item: string; action: string }[] {
  const fields = fieldLabels.join('、') || '字段';
  return [
    {
      item: '方法关系图',
      action: `关系判定用的是人工修正后的有效值（${fields}），需要重新分析关系才能作为当前结论`,
    },
    {
      item: '方法决策（推荐与阅读顺序）',
      action: '推荐依据的人工修正值已变化，需要重新生成',
    },
    {
      item: '跨论文比较 / 分歧',
      action: '可比性与条件差异由程序按当前有效值实时重算；请复核受影响的论文对',
    },
    {
      item: `论文：${paperTitle}`,
      action: `人工修正（${fields}）已保存，AI 原值与原证据仍保留在修正记录中；修正值不是原文核验结果`,
    },
  ];
}

/** 取消/失败时的界面文案（明确边界，避免夸大成「已终止服务端计算」） */
export const CANCEL_NOTICE =
  '已停止等待：本次调用未完成，原结果保持不变。停止等待只是不再等待响应，不代表服务端已停止计算或不再计费。';

export const FAILURE_NOTICE = '本次分析失败：原结果（如有）保持不变，未被覆盖，也不会以不完整结果冒充成功。';

/**
 * 把一次模型调用失败归类为界面状态。
 * 关键点：**超时不算成功，也不会一直停留在「运行中」**；取消单独成一类。
 */
export function describeJobOutcome(err: unknown): { status: 'failed' | 'canceled'; message: string; detail: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const kind = (err as { kind?: string } | undefined)?.kind;
  if (kind === 'canceled' || /已停止等待/.test(msg)) {
    return { status: 'canceled', message: '已停止等待', detail: CANCEL_NOTICE };
  }
  if (kind === 'timeout' || /超时/.test(msg)) {
    return {
      status: 'failed',
      message: '超时（未完成）',
      detail:
        '本次调用已超时并按失败处理：不会一直显示运行中，也不会把未完成的调用当成成功。原结果保持不变。',
    };
  }
  return { status: 'failed', message: '失败', detail: FAILURE_NOTICE };
}
