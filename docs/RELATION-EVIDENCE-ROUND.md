# 关系证据检索改版（2026-10-11）

目标：让关系抽取**到引用句 / Related Work 里找作者明说的表述**，把真正存在的继承关系做成「原文明示」。

> 本文件分两轮：
> **第一轮**（§一–§五）修证据检索 —— 原文明示 0 → 4 条。
> **第二轮**（§六–§七）修「关系只剩一条时间链」 —— 覆盖全部配对、补横向关系、修布局。

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

---

## 六、第二轮：关系不能只剩一条「沿时间往前推」的链

第一轮之后，用户看着关系图问：**「为什么我们的关系还是简单的线性？」** 实测（读取画布 SVG）：

- 节点坐标是 `ResNet(120,315) ViT(120,445) DeiT(310,315) Swin(310,445) ConvNeXt(500,380)`
  ⇒ **布局本身是三列分叉的，不是画错了**；
- 但 8 条边**全部指向时间上更晚的方法**，且 10 个无序配对里唯独缺了两对**横向关系**：
  `ResNet–ViT`（CNN vs Transformer 两条路线）、`DeiT–Swin`（ViT 之后同期的两个并行分支）。

三条原因：

1. `from` 被定义为「被基于/被改进的一方」⇒ 模型必然把早的放 from、晚的放 to，**结构上不可能出现横向边**；
2. 关系类型里没有「并行分支 / 路线对立」这一档，`similar` 名义上能装，但提示词没往这引导；
3. 第一轮把「不许判成 extends」收紧之后，模型对这两对干脆**整对不输出**了
   （改版前它们是以 unclear/inferred 存在的）—— 这是收紧的副作用。

### 改了什么

| 位置 | 改动 |
| --- | --- |
| `src/core/model/prompts.ts` | **每一对方法都要给出一条判断**（N 个方法 ⇒ C(N,2) 对，提示词里直接把应有对数算出来写进去）；实在没证据也要输出为 candidate，不能整对不输出 |
| `src/core/model/prompts.ts` | 明确「**并行分支**」（两个方法基于同一个前置 / 同期同任务思路不同源）与「**不同技术路线**」（卷积 vs 注意力、自监督 vs 监督）→ 判 `similar`，并在 rationale 写明是哪一种 |
| `src/core/model/prompts.ts` | 补**优先级**：引文里有 `outperforms` / `builds upon` / `starting point` / `modernize` 这类明确措辞时仍判 improves/extends，**不要因为"路线不同"就改判 similar** |
| `src/core/model/analyze.ts` | 非 explicit 的关系：引文必须**至少提到一个端点**才挂，否则写「无引文」。实测提示词要求覆盖全部配对后，模型给待核查关系也附引文，其中有些片段与这两个方法都无关（ResNet–ViT 挂了 ViT 论文里纯讲 patch 切分的一句），界面上就成了这条关系的「原文依据」 |
| `src/ui/MapNetworkView.tsx` | **分层只用「有方向」的关系**（extends / improves / combines）。similar / unclear 的 from→to 只是形式上的两端，界面也写着「相近/不明确的关系不声明方向」；把它们也算进层深，一旦关系覆盖变全就会被推成「5 层、每层 1 个」⇒ 全部落在同一条 y 上，画出来是直线。<br>另外：`hasBranch` 判据从「某层 >1 或某节点出度 >1」改为**只看某层是否有 >1 个节点**（出度大是辐辏不是分叉）；层内按年份升序 |
| `src/ui/MapNetworkView.tsx` | 只给**有方向**的关系画箭头。similar / unclear 原来自带箭头，等于凭空声明了一个方向，与图例自相矛盾 |
| `tests/core.test.ts` | 第 37 节新增 5 条断言：提示词覆盖全部配对、提示词含「并行分支/不同路线」、真实语料配对覆盖 ≥ C(5,2)−1、存在 ≥2 条 similar |

**刻意没做**：没有按「无向键」把同一对方法的两条关系合并掉。
实测模型偶尔会同时给出 `A→B` 与 `B→A`，看着像重复，但合并会丢掉真实存在的反向关系
（既有硬约束：A→B 与 B→A 是两条不同的关系）。这类反向条目保留为「待核查」并展示引文，由读者判断。

### 结果（真实模型调用，视觉语料）

关系数 8 → **10（全部 10 个配对都覆盖）**；原文明示仍 **4** 条；三态变为
**全部 10 · 可用 7 · 待核查 3**。

新增的两对横向关系：

| 配对 | 类型 | 说明 |
| --- | --- | --- |
| `ResNet – ViT` | similar | 「卷积路线 vs 注意力路线」，两条解决同一任务的不同技术路线 |
| `DeiT – Swin` | similar | 同为 ViT 之后的同期并行分支 |

画布布局（读取 SVG 实测）：`ResNet(120,250) ViT(120,380) Swin(120,510)` 三个根 →
`DeiT(310,315) ConvNeXt(310,445)` 两个后继（DeiT 继承 ViT；ConvNeXt 继承 ResNet、改进 Swin），
**不再是 5 个节点排在一条线上**。

### 诚实边界（延续第一轮的口径）

横向关系都是 **系统推断 / 待核查**，**不是**「原文明示」——它们的 rationale 写明了判断依据
（共同前置 / 路线差异），而不是拿原文句子冒充陈述。图例里 similar 用虚线、不画箭头，
与「原文明示用实线」区分开。
