# 给核心 B 的接口说明（二）：`cache.ts` 两处迁移语义

- 来源：核心 A 在审计分析内核时发现，**属核心 B 的文件**（`src/core/cache.ts`，按 00 文档所有权表归核心 B）
- 核心 A **没有、也不会**修改 `cache.ts`；这份说明只描述现象、影响与建议方向，是否修、怎么修由核心 B 定
- 触发时机：`migrateMethod` / `migrateRelation` 只在**载入没有新字段的旧缓存**时才会走到这些分支

---

## 1. 字段迁移：`migrateMethod` 把 legacy 状态直接当「可核验」

**位置**：`src/core/cache.ts:207`

```ts
const legacy = (r as unknown as { status: string }).status;
if (legacy === 'ok' || legacy === 'verified') fields[k] = { ...r, status: 'verified' };
```

**问题**：只看了 legacy 的 `status`，**没有复核 `r.evidence?.verified`**。也就是说，旧缓存里
「status=verified 但引文缺失或未通过定位」的字段，迁移后仍然是 `verified`。

**后果**（只在旧数据上出现）：

- 界面标签显示「可核验」（`FIELD_STATUS_TEXT.verified`）；
- `Library.verifiedOf()` 按 `fields[k].evidence?.verified` 统计「已核验字段数」，
  `UploadFlowView` 的进度与样式也按 `evidence.verified` 判断 —— 于是状态与统计**互相矛盾**；
- 同时 `validateMethod` 会给这个字段报一条 `evidence_missing`（「模型给出了内容但没有提供任何原文引文」），
  等于同一字段上「可核验」和「没有引文」两句话并存。

**现状核实（重要，避免误判影响面）**：两个预置语料的字段状态**只有** `verified` / `no_evidence` 两种，
且「状态为 verified/ok 但证据未定位」的字段数为 **0** ⇒ 该分支对预置数据**不触发**。
风险只落在**旧版浏览器 IndexedDB** 或**旧提交产出的缓存**上。

**建议方向**（供你们取舍）：迁移时按 `r.evidence?.verified === true` 复核，不满足则降为 `unverified`，
保留 `value` 与原 `evidence`，并在 `note` 里写明「迁移时证据未通过复核，需人工确认」。

## 2. 关系迁移：`migrateRelation` 把「引文定位成功」当成「原文明示」

**位置**：`src/core/cache.ts:128`

```ts
const legacy = r.assertedBy ?? (r.evidence?.verified ? 'explicit' : 'inferred');
```

**问题**：`evidence.verified` 只表示「这段文字能在全文里定位到」，**不等于**「这段文字足以支撑该关系」。
项目里这条区分由 `rules.ts#assessRelationEvidence` 负责（例如要求引文指名被继承方法、并有继承/改进措辞）。
这里没走那一步就把关系升成 `explicit`。

**现状核实（端到端已被兜底）**：这条分支只在缺 `evidenceState` 时触发；载入后

- 应用侧 `App.tsx` 会接着跑 `revalidateCachedRelations()` → 内部逐个 `validateRelation()`；
- 离线侧 `scripts/revalidate.mjs` 同样先 `migrateRelation` 再 `validateRelation`。

所以不满足充分性的关系**最终会被降级为 `candidate`**，规则版本变化时更会被整体降级。
**实际影响因此有限**；问题在于函数**自身语义不对**，且它是导出函数 —— 将来任何只调
`migrateRelation`、不跟 `validateRelation` 的新调用点都会把「只是定位到」当成「原文明示」。

**现状核实**：两个预置语料的关系**全部带 `evidenceState`**、带 `assertedBy` 的条数为 **0** ⇒ 该分支同样不触发。

**建议方向**：legacy 分支不要直接给 `explicit`；要么走一次 `assessRelationEvidence` 再定档，
要么默认降为 `candidate` 并在 `rationale` 里写明「迁移时未复核证据充分性，需人工确认」。

## 3. 核心 B 需要运行的测试入口

改动前后都建议跑（项数为当前基线，供对照）：

```bash
npm test                 # 435 项；其中第 10/11 节会用 migrateMethod / migrateRelation 载入真实缓存
npm run verify:reload    # 20 项 —— 重载、人工修正保留、普通关系不被误判为人工
npm run verify:relations # 16 项 —— 关系人工标志与范围删除
```

**新增断言的归属**：`tests/core.test.ts` 按 00 文档是**核心 A 维护**的文件（核心 B 不直接编辑）。
如果你们改了迁移逻辑、需要补这两条回归断言：

- legacy 字段 `status='verified'` 但 `evidence` 缺失/未定位 → 迁移后**不得**是 `verified`；
- legacy 关系只有「引文定位成功」→ 迁移后**不得**是 `explicit`；

请把「输入样例 + 期望结果」写给核心 A，由我在 `tests/core.test.ts` 里加；
或者你们按既有做法用独立的 `scripts/verify-*.mjs` 覆盖（那就不必动这个共享文件）。

## 4. 边界

- 本说明**不要求**核心 A 做任何事，也不改变任何公共类型、缓存结构与版本号：
  两个预置语料的 `rulesVersion = r3.2.0`、`CACHE_VERSION = 3` 均未变，本次只是文档。
- `storage.ts` / `corpus.ts` / `parse/**` / `reanalysis.ts` / `effective.ts` 我一律未触碰（可用
  `git diff --name-only <不要修改清单>` 自证）。
- 如果你们在修的过程中发现需要核心 A 配合（例如 `effective.ts` 的消费口径、
  或希望迁移时顺带把 `validation` 重算一遍），在你们的交付说明里记下来找我这边对齐。
