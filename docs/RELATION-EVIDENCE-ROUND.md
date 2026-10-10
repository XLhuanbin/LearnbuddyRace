# 关系证据检索改版（2026-10-11）

目标：让关系抽取**到引用句 / Related Work 里找作者明说的表述**，把真正存在的继承关系做成「原文明示」。

结论先行：**视觉案例的原文明示关系从 0 条变成 4 条**；其中 `ViT → DeiT`、`ResNet → ConvNeXt` 拿到了硬证据。
`ViT → Swin` **不能**做成「原文明示的继承」——Swin 论文里没有任何继承表述，最接近的原文是
「Most related to our work is the Vision Transformer (ViT)」，只能支撑「相似/相关」，已按这个类型落地。

---

## 一、改版前：为什么明明有的证据被判成"没有"

视觉案例缓存里 10 条关系，**0 条原文明示**。逐条看模型的 rationale，三处都在说
「检索片段未指名被继承方法」。但把 5 篇论文全文按句子检索后发现，**句子就在那里**：

| 关系 | 原文里真实存在的句子 |
| --- | --- |
| ViT → DeiT | `In order to get a transformer to process images, our work builds upon the ViT model [15].`（DeiT p.5, Related work） |
| ResNet → ConvNeXt | `Our starting point is a ResNet-50 model.`（ConvNeXt p.3） |
| Swin → ConvNeXt | `We modernize a standard ConvNet (ResNet) towards the design of a hierarchical vision Transformer (Swin).`（ConvNeXt p.3） |

句子没被送到模型面前，是检索层的三个缺陷叠加：

1. **只取"最短别名" + 长度 <4 整条丢弃**。
   `Vision Transformer (ViT)` 的最短别名是 `ViT`（3 字符），被 `buildRelationHints` 的 `length < 4` 门槛
   整条跳过 ⇒ **ViT→DeiT / ViT→Swin 的候选数为 0**。
2. **别名派生只认全大写缩写**。`DeiT` 不是全大写，所以 `DeiT` 这个专名**根本没有独立别名**
   （派生出来的只有 "data-efficient image transformers" 和带人工注解的 "…蒸馏版本记为 DeiT⚗"）。
3. **候选按出现顺序取前 N 条**，正文里的性能对比句和 Related Work 里的关系句同权 ⇒ 好句子被挤掉。

## 二、改了什么

| 位置 | 改动 |
| --- | --- |
| `src/core/rules.ts` | 别名派生补**驼峰专名**（DeiT / RoBERTa / ConvNeXt）；「记为/亦称/简称/缩写」这类人工注解不再进别名集合 |
| `src/core/relationCandidates.ts` | 改用**全部可用别名**检索（去掉长度门槛，与认证侧 `findAliasInText` 的下限一致）；候选带上**章节名与引用标记**，按「强措辞 + Related Work/引言章节 + 含引用标记」打分排序；`buildRelationHints` 改为**全局打分后按预算分配**，保证强候选一定进上下文 |
| `src/core/rules.ts` | 继承措辞表补真实写法：`starting point` / `modernize` / `go from` / `adapted from` / `inspired by` / `motivated by`；`similar` 补 `most related` |
| `src/core/rules.ts` | **收紧**：`extends` 的关系措辞改为**必需**。旧规则允许「提到方法名 + 引用标记」就通过，实测会把 "Most related to our work is the Vision Transformer (ViT) [20]" 判成继承——引用标记只说明"提到了这篇工作"，不说明"是什么关系" |
| `src/core/rules.ts` | `similar` 允许另一端用「our work」自指（related work 里常见写法），但两端都必须能指到 |
| `src/core/model/prompts.ts` | 提示词明示去哪里找（Related Work / 引言里带引用标记的句子），并要求**关系类型与句子字面语义一致**：`most related to` → similar，不能写成 extends |
| `scripts/analyze.mjs` | 新增 `--relations-only`（沿用缓存的论文与方法，只重跑关系；写 `relationsOnlyRegeneratedAt` 标明范围） |

版本：`RULES_VERSION` r3.2.0 → **r3.3.0**；`PROMPT_VERSION` v3.1.0 → **v3.2.0**。
三个预置语料（`samples-vision` / `samples-vision-core` / `samples`）已用真实模型重跑关系。

## 三、实测结果（真实模型调用，3 次）

### 视觉案例（5 篇）—— 改前 0 条原文明示 → 改后 4 条

| 起点 | 类型 | 指向 | 状态 | 引文（程序定位，非模型自报页码） |
| --- | --- | --- | --- | --- |
| ViT | 继承/基于 | DeiT | **原文明示** | `our work builds upon the ViT model [15].` — DeiT p.5 Related work |
| ResNet | 继承/基于 | ConvNeXt | **原文明示** | `Our starting point is a ResNet-50 model.` — ConvNeXt p.3 |
| Swin | 改进 | ConvNeXt | **原文明示** | `our pure ConvNet model, named ConvNeXt, can outperform the Swin Transformer.` — ConvNeXt p.3 |
| ViT | 相似 | Swin | **原文明示** | `Most related to our work is the Vision Transformer (ViT) [20] …` — Swin p.3 Related work |
| DeiT | 相似 | ConvNeXt | 系统推断 | `we use a training recipe that is close to DeiT's [73] and Swin Transformer's [45].` — p.3 |
| ResNet → DeiT / ResNet → Swin / ViT → ConvNeXt | 不明确 | | 待核查 | 无引文（模型如实未给出） |

关系总数 10 → 8（模型这次少输出了两对「不明确」的配对，属模型自主取舍，不是剔除）。

### 诚实边界（必须写清楚）

**`ViT → Swin` 不是"继承"，原文没有这句话。** 把 Swin 全文按句子扫一遍：
`extend` 0 句、`build upon` 0 句、`based on` 0 句、`inspired` / `motivated` / `start from` 均 0 句；
唯一出现的 `adapted from` 指的是 "Transformer is adapted from the"（Vaswani 的 Transformer，不是 ViT）。
所以只能把 Related Work 里的「最相关」落到 `similar`。**没有为了让三条都变绿而放宽标准。**

### 其它语料

- `samples-vision-core`（3 篇）：5 条关系，1 条原文明示（Swin → ConvNeXt 改进）。
- `samples`（NLP 开发回归样例）：5 条关系，3 条原文明示，**改版前已认证的 3 条在收紧后全部仍然成立**（收紧没有造成回退）。

## 四、验证（本机实跑）

| 项目 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | **474/474**（新增第 37 节 11 条断言，专门钉住本轮修复） |
| `npm run build` | 通过，构建指纹 `5fc847cb9f` |
| `npm run e2e` | 70/78 —— 8 项失败**全部**是研究地图改版遗留的选择器失效（见下） |
| `npm run verify:relations` | 16/16 |
| `npm run verify:layout` | 81/81 |
| `npm run verify:import` | 25/25 |
| `npm run verify:reload` | 20/20 |
| `npm run verify:scope` | 23/25 —— 2 项失败同属地图改版遗留 |
| `npm run verify:ui` / `verify:mobile` | 崩溃，同属地图改版遗留 |

### 与研究地图改版的关系（不是本轮造成的）

研究地图已换成草稿画布 `MapNetworkView`（根容器 `.mapnet`，节点是 `<g class="cursor-pointer">`），
而 `e2e-check.mjs` / `verify-desktop-ui.mjs` / `verify-mobile-map.mjs` / `verify-scope-flow.mjs`
还在找旧结构的 `.mapstage .mnode` —— DOM 里已经不存在，于是节点数恒为 0、脚本崩溃。
实测页面本身是正常的：5 个方法节点、8 条关系、三态筛选「全部 8 / 可用 5 / 待核查 3」都在。
本轮只修了自己引入的一处写死条数（`全部10` → 改成不写死数字），**其余留待地图改版方一起更新选择器**。

## 五、新增的回归保护（tests/core.test.ts 第 37 节）

- 「ViT」必须能作为检索别名（不得被长度门槛丢掉）
- 驼峰专名「DeiT」能派生独立别名；人工注解不进别名集合
- `"most related to our work is X"` 判 `extends` 必须不通过，判 `similar` 可以通过
- `"Our starting point is a ResNet-50 model"` / `"we gradually modernize a standard ResNet"` 可支撑 `extends`
- 真实视觉语料里至少 3 条原文明示；每条都带 `verified=true` 的引文；**用当前规则逐条复核仍然成立**
  （这条最关键：防止以后规则一改，展品悄悄失效却没人发现）
