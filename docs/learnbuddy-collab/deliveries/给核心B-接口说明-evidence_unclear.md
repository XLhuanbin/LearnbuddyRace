# 给核心 B 的接口说明：新增校验码 `evidence_unclear`

- 来源：核心 A，commit `de5c538`（`validate.ts` / `rules.ts` / `analyze.ts` / `types.ts`）
- 性质：**纯新增**，不改既有字段语义、不改缓存结构
- 这份说明只描述现状，**核心 B 不需要改任何代码**

---

## 1. `evidence_unclear` 的用途

**背景**：模型可以把字段状态标成 `unclear`（「找到了相关内容，但无法确认它是否支撑结论」）。核心 A 把这种字段归一为
`status = 'no_evidence'` 且**不挂载引文**（避免被界面算进「已核验字段数」）。
但校验层原先在这一情形下仍报 `evidence_missing`，文案是「模型给出了内容但没有提供任何原文引文」——
而这一情形里模型**其实给了引文**，只是自认无法确认。于是同一条记录里出现两句互相矛盾的话。

**现在**：`validateMethod` 的 `!r.evidence` 分支按 note 里的判据词（`rules.ts` 的 `UNCLEAR_NOTE_KEY`）分流：

| 情形 | 校验码 | 短标签（`ISSUE_CODE_TEXT`） |
| --- | --- | --- |
| 模型给了引文、但自认无法确认 | `evidence_unclear`（**新**） | 「模型标注无法确认」 |
| 模型确实没有给引文 | `evidence_missing`（原有，行为与文案均未变） | 「未提供引文」 |

**没有变化的部分**（对核心 B 更重要）：

- `FieldStatus` 仍是 `verified / unverified / no_evidence / missing` 四个值，**没有新增状态**；
- `MethodFieldResult` 的字段**一个没加、没删、没改名**；
- `ValidationIssue` 的结构未变，只是 `code` 这个联合类型多了一个取值。

## 2. 旧数据是否需要迁移

**不需要。** 三条理由：

1. `CACHE_VERSION` 仍为 `3`，缓存结构与键都没有变；
2. 旧缓存里 `methods[].validation[].code` 全是旧码，读取、展示、过滤都不受影响；
   `evidence_unclear` **只会出现在新抽取或重算的结果里**；
3. 界面按 `ISSUE_CODE_TEXT[v.code]` 渲染短标签（`Library.tsx`），`SettingsView.tsx` 另有 `?? code` 兜底 ——
   即便拿到不认识的码也只是显示原码，不会崩。

**需要留意的唯一一点**：`scripts/revalidate.mjs` 会把 `validateMethod` 的产物写回缓存。
如果你们之后跑它，`methods[].validation` 里可能出现 `evidence_unclear` —— 这是**预期行为**，不需要额外处理。

## 3. 核心 B 需要运行的测试入口

平时只需要：

```bash
npm test
```

其中与本次变更**直接相关**的断言是 `tests/core.test.ts` 第 31 节（12 项，标题
「validateMethod 对 unclear 的说明：区分『给了引文但自认无法确认』与『根本没给引文』」），包含：

- unclear 字段用独立校验码 `evidence_unclear`；
- 说明里**不再**出现「没有提供任何原文引文」；
- 真的没给引文时仍是 `evidence_missing`，文案照旧；
- 端到端（本地 mock 模型服务）两种 note 形态都判成 `evidence_unclear`；
- 可核验字段不产生这两种码、引文无法定位仍是 `evidence_not_located`。

如果你动了导入 / 缓存 / 语料范围，按 01 文档再跑对应的验证脚本：

```bash
npm run verify:import      # 25 项
npm run verify:reload      # 20 项
npm run verify:scope       # 25 项
npm run verify:relations   # 16 项
```

## 4. 不要修改代码

本说明**不需要核心 B 做任何改动**。特别说明两点边界：

- `IssueCode` 与 `ISSUE_CODE_TEXT` 在 `src/core/types.ts` 里，属**核心 A 的范围**；如果核心 B 需要新的校验码，
  请提需求给核心 A 添加，不要自行修改（`Record<IssueCode, string>` 是穷尽映射，漏加一项会直接编译失败）；
- 校验码对核心 B 而言应视为**不透明字符串**：缓存只做存取与展示，不要按 code 做业务判断。

如果核心 B 发现与本说明不符的地方（例如缓存读写出错、旧数据出现未知码导致报错），
请在交付说明里记下来找核心 A 对齐，不要自行在核心 B 侧做兼容处理。
