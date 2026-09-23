# 第五轮：推荐正确性、证据引用与真实浏览器流程审计

记录日期：2026-09-17（同日第二轮）
规则版本：`r3.0.0`　提示词版本：`v3.0.0`
本轮**不新增功能**，只做核查与纠偏；不重复全量调用五篇论文（除必要的关系与决策重跑）。

---

## 0. 状态表述更正

上一轮我在报告中写了「未完成项已全部补完」，**这个表述不准确，此处更正**：

| 项 | 实际状态 |
| --- | --- |
| Node 脚本调用（抽取/关系/分歧/决策/条件对照） | 已跑通（真实模型） |
| 未预置论文抽取 | 已跑通（DDPM，Node 脚本路径） |
| 界面端到端走查（缓存路径、交互、刷新、窄屏） | 已跑通（74 项，本地 + 线上） |
| **浏览器实时抽取** | **当时未验证**；本轮已补做，见 §5 |
| 关系候选检索、推荐正确性、证据绑定 | 当时未审计；本轮已审计，发现并修复 4 处缺陷，见 §1–§4 |

---

## 1. RoBERTa 资源推荐审计

### 1.1 实际推荐原文（条件 B：8 卡 A100 · 半年，目标「研究大规模预训练的训练稳定性」）

候选状态：`fit=suitable`（模型判定），资源理由原文：

> RoBERTa 预训练算力为 1024 V100 GPU 约一天（pretrain 阶段），用户可申请 8 卡 A100 持续数周，**规模上远小于该配置，若要做同等规模预训练需重新评估资源**；该条目仅对应预训练阶段。

对应的目标理由：

> RoBERTa 系统研究预训练中的关键设计选择（动态掩码、是否使用 NSP 损失、输入格式、batch size、训练步数与数据量），与用户「大规模预训练的训练稳定性」兴趣方向高度相关，可作为对比研究的核心参照。

证据：RoBERTa 论文 p.3 的算力条目（`stage=pretrain`，可核验）。

### 1.2 逐条回答

| 问题 | 结论 |
| --- | --- |
| 推荐讨论的是哪个阶段？ | **阅读/研究设计参照 + 预训练成本**。资源理由引用的是 `pretrain` 阶段算力，与用户目标（预训练稳定性研究）阶段一致；**不是**微调，也没有用微调资源去论证预训练。 |
| 是否把更多时间折算成更少 GPU？ | **模型的原文没有**（它写的是「规模上远小于」「需重新评估资源」）。但 **我上一轮的汇报把「模型判定 suitable」概括成「算力条目在该条件下变得可行」，这属于未经验证的折算**，是本轮要纠正的核心问题。 |
| 是否用微调资源论证预训练？ | 不是。 |

### 1.3 修正（已实施）

1. 新增**程序判定**的资源可行性字段，模型不能自行认证：

   | 取值 | 含义 |
   | --- | --- |
   | `stage_evidence_available` | 论文报告了与用户目标一致的阶段，且规模不低于论文 |
   | `below_paper_scale` | 同阶段，但用户规模更低（不能用更长时间反推可复现） |
   | `user_scale_unknown` / `paper_count_unknown` | 用户或论文的规模无法解析/未给数字 |
   | `no_matching_stage_evidence` | 论文没有报告用户目标阶段的算力 |

2. `fit=suitable` 现在要求**三个条件同时成立**：① 阶段一致；② 规模可比；③ 论文给出了**显存/并行/具体配置**证据。
   任一不满足即由程序降级为 `conditional`，并在界面写明原因（含 `fitAdjusted`）。
3. 界面显式展示「论文算力阶段 / 目标阶段 / 可行性未验证」标签与可行性说明。
4. 提示词明确禁止「用更长时间换算更少 GPU」，并要求资源理由必须与目标阶段一致。

修正后 RoBERTa 的判定：**`conditional` / `below_paper_scale`（四个条件下都如此，见 §2）**，界面上并可见
「论文报告的该阶段规模高于用户可及资源；缺少显存、并行策略与可缩放实现证据，不能用更长的可用时间反推「能够复现」」。

> 结论：原判定**存在过度乐观**（缺显存/并行/配置证据就给了 suitable），已通过程序门槛修正；本轮之后，四个条件下**没有任何候选被认证为 suitable**。

---

## 2. 单变量条件对照（重做）

固定「研究目标 = 围绕预训练训练稳定性做可复现对比研究、基础 = 有 BERT 微调经验」，**只改一个变量**：

| 条件 | 阅读顺序 | 候选状态（节选，格式：fit/可行性@目标阶段） |
| --- | --- | --- |
| ① 基准 8×A100 · 半年 | BERT > RoBERTa > DistilBERT > Transformer > GPT-3（按各自理由排序） | RoBERTa `conditional/below_paper_scale@pretrain`；BERT `conditional/stage_evidence_available@finetune` |
| ② **只改算力** 单卡 3090 · 半年 | — | RoBERTa `conditional/below_paper_scale@pretrain`（DistilBERT/Transformer 亦为低于规模） |
| ③ **只改时间** 8×A100 · 两周 | — | RoBERTa **仍为** `conditional/below_paper_scale@pretrain`；DistilBERT 变为 `no_matching_stage_evidence@distill` |
| ④ **反例** 笔记本无 GPU · **两年** | — | 全部 `conditional`/`unknown`；**被判 suitable 且目标阶段为训练阶段的数量 = 0** |

人工核查依据（逐条对照文档 `DECISION-VARIATION.md`）：

1. **只改算力**：可行性状态由「低于论文规模」变为「用户规模无法解析（单卡 3090 未给可比数字）」——理由随之变化，且**没有**因为 GPU 变差就断言任何新结论。
2. **只改时间**：RoBERTa 的可行性**没有变化**，说明「时间变长」没有被折算成可复现；只有依赖微调阶段证据的候选才出现状态变化（有依据）。
3. **反例**：模型原文明确写出「**不能把「两年全职时间」折算为可复现该预训练**」，程序同时判定 `below_paper_scale` —— 这是本轮要求的关键反例。
4. 阅读顺序**没有**仅因算力变化而大幅变化；顺序差异都伴随候选状态/理由的变化，可在文档中逐条核对。

> 局限：本对照每组只跑一次模型调用（温度 0.2），不是统计意义上的稳定性测试；结论以「状态与理由是否有证据支撑」为准，而非排序本身。

---

## 3. evidenceRef 绑定审计

上一轮为兼容模型把条件写成 `field` 的情况，改成「不按 kind 过滤、两处都查」。本轮把这条规则**收紧为可审计的流程**：

| 规则 | 实现 |
| --- | --- |
| 唯一定位 | 键在两处都存在时：模型声明了类型 → 按声明消歧并记录说明；**完全没声明类型 → 拒绝绑定**并记录原因 |
| 类型规范化 | 声明的 kind 与实际位置不一致 → 按实际位置绑定，并记录「已规范化」 |
| 无效引用 | 键在当前分析结果中不存在 → 拒绝绑定并记录 |
| 中文标注 | 常见中文键名（计算资源 / 数据集 / 评价指标…）规范化为标准键 |
| 跨论文 | 证据的 `paperId` 与候选论文不一致 → 拒绝绑定 |
| 阶段一致性 | 资源类理由必须指向 `computeResources` 且阶段等于 `targetStage`，否则记 `evidenceSupportsReason=false` 并计为无证据 |
| 两个判定分离 | 新增 `evidenceLocated`（是否定位成功）与 `evidenceSupportsReason`（是否支持理由）两个字段，分别展示 |
| 可追溯 | 绑定成功的 ref 一并记录 `paperId` 与 `methodId` |

**实测命中**（真实数据，非构造）：

- `datasets` 在字段与条件中同时存在 → 记录「已按模型声明的类型绑定到字段条目」；
- 模型把 `computeResources` 标成 `field` → 记录「类型与实际位置不一致，已按实际位置规范化」；
- DistilBERT/RoBERTa 的资源理由引用了**不同阶段**的算力 → 记录「引用的算力证据阶段与用户目标阶段不一致」，界面显示为「引用的证据与这条理由不匹配」，**不当作支持**。

新增回归用例：同名键消歧、错误 kind 规范化、无效引用拒绝、跨论文拒绝、阶段不匹配计为无证据、`evidenceLocated`/`evidenceSupportsReason` 分离、证据 paperId 归属校验、候选必须带 targetStage 与可行性。

---

## 4. 真实关系证据检索

### 4.1 先检索（确定性，不调用模型）

新增 `scripts/relation-candidates.mjs`：在全文里找「同时含被继承方法名 + 关系措辞」的句子，输出完整句子、页码，并统计它们是否落在原流水线送入模型的窗口内。

结果（`docs/RELATION-CANDIDATES.md`）：

| 论文对 | 候选句数 | 原窗口覆盖 | 是否漏送 |
| --- | --- | --- | --- |
| BERT → RoBERTa | 13 | 13/13 | 否 |
| BERT → DistilBERT | 13 | 10/13 | **是（3 条未送入）** |
| Transformer → BERT | 7 | 2/7 | **是（5 条未送入）** |
| BERT → GPT-3 | 11 | 9/11 | **是（2 条未送入）** |

**真实存在的可直接认证句子（举例）**：

- RoBERTa p.1：「When controlling for training data, our improved training procedure **improves upon the published BERT results** on both GLUE and SQuAD.」
- RoBERTa p.6：「RoBERTa … we propose **modifications to the BERT pretraining procedure that improve** end-task performance.」
- DistilBERT p.2：「DistilBERT: **a distilled version of BERT** … the student - DistilBERT - has the **same general architecture as BERT**.」
- BERT p.3：「BERT's model architecture is a multi-layer bidirectional Transformer encoder **based on** the original implementation described in Vaswani et al.」
- 反面样本（不能认证）：「Most of the top systems **build upon** either **BERT** …」——主语是其它系统，不是本论文。

### 4.2 改进（不放宽标准）

1. 新增 `src/core/relationCandidates.ts`：句子级候选检索 → 同一份逻辑同时供流水线与检索脚本使用。
2. 关系分析的提示改为：**先给出候选句列表（含论文与页码）**，要求模型优先从中挑选；仍要求逐字引用。
3. 判定标准**收紧**而非放宽：
   - 增加「第三方主语」守卫（「Most of the top systems build upon BERT」不足以认证本论文对）；
   - 要求证据必须指向关系另一端（提到对方方法名或本论文自指），半句片段不足以建立端点；
   - extends 增加「派生类」措辞（distilled version of / same architecture as / initialized from），仍必须先指名被继承方法。

### 4.3 改进后的真实结果（重跑一次关系推断）

| 关系 | 状态 | 引文（真实、逐字、已定位） | 判定说明 |
| --- | --- | --- | --- |
| Transformer → BERT | **原文明示** | 「BERT's model architecture is a multi-layer bidirectional Transformer encoder based on the original implementation described in Vaswani et al.」 | 提到被继承方法「Transformer」、提到「BERT」、含继承措辞「based on」 |
| BERT → RoBERTa | **原文明示** | 「our improved training procedure improves upon the published BERT results on both GLUE and SQuAD.」 | 提到「BERT」、含改进措辞「improves」 |
| BERT → DistilBERT | **原文明示** | 「DistilBERT: a distilled version of BERT … the student - DistilBERT - has the same general architecture as BERT」 | 提到「BERT」与「DistilBERT」、含派生措辞「distilled version of」 |
| Transformer → DistilBERT | 系统推断 | 更小的 Transformer 由更大的 Transformer 蒸馏 | 未指名 BERT，保持推断 |
| BERT → GPT-3 / Transformer → GPT-3 | 系统推断 | 片段未出现承接表述 | 如实标为推断，不硬凑 |

（同时修复了一处别名缺陷：`RoBERTa (Robustly Optimized BERT Pretraining Approach)` 的括号里含 "BERT"，
旧实现会把独立的 `BERT` 当成 RoBERTa 的别名，导致判定文案出现「关系另一端「BERT」」这种错误。
现仅从主名称提取全大写缩写。）

**合成测试与真实论文验证分别报告**：

- 合成测试：8 项（别名、第三方主语、半句片段、派生措辞、更泛的 Transformer + 引用标记等），`npm test` 逐项通过；
- 真实论文验证：3 条原文明示均来自真实论文句子（上表引文可在论文中直接检索到），并在测试中断言「RoBERTa 论文中确实存在该改进句」。

---

## 5. 真实浏览器调用流程

新增 `scripts/browser-flow-check.mjs`，在**线上站点**用安全方式（密钥只从环境变量读入并直接注入输入框，不打印、不写文件）走一次完整链路。

结果：**30 项检查全部通过**（`docs/BROWSER-FLOW-VERIFICATION.md`）

| 环节 | 结果 |
| --- | --- |
| 设置页填入接口并「保存到本机」 | 通过；侧栏变为「已配置」；界面不出现明文 |
| 上传**非预置**论文（DDPM, 2006.11239, 9.8MB） | 通过，浏览器端解析成功（25 页 / 57,483 字符） |
| **浏览器发起真实模型调用** | 通过，得到结构化字段与实验条件；日志记录模型调用且不含密钥 |
| 证据查看 | 通过（展开后有 12 个证据按钮；弹层含定位校验标记、真实页码、上下文高亮） |
| 保存与刷新恢复 | 通过（刷新后论文与分析结果从本地持久化恢复；配置仍在） |
| 无效凭据 | 抽取确实被触发、**未假报成功**、不回显凭据（真实服务在该窗口内未返回响应，故可读提示由下述 mock 用例验证） |
| 控制台 | 无未处理异常 |

**鉴权失败路径（本地 mock，确定性）**：新增 `scripts/auth-error-check.mjs`，用本地 mock 服务返回 401（带 CORS 头），在浏览器里走同一条前端代码路径 —— **7/7 通过**：给出可读提示（含 401 / API Key 提示）、日志记录失败原因、**失败后不生成结构化结果**、不回显凭据、无前端异常（`docs/AUTH-ERROR-VERIFICATION.md`）。

> 跨域/超时/重试：真实调用在浏览器端成功，说明 CORS 预检通过；超时与退避重试由客户端统一处理（每次尝试 180s、最多 3 次）。
> 本轮观测到：**真实服务对无效凭据的响应在 90 秒窗口内未返回**，因此「真实接口的鉴权失败提示」保持**未验证**状态，不以 mock 结果代替。

---

## 6. 本轮验证汇总

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 0 error |
| `npm test` | **114/114 通过**（本轮新增 24 项：别名/第三方主语/派生措辞/候选检索/GPU 解析/配置证据/绑定与阶段/决策字段） |
| `npm run e2e`（本地） | **74/74 通过** |
| `npm run e2e`（线上） | **74/74 通过** |
| `browser-flow-check`（线上，真实模型） | **30/30 通过** |
| `auth-error-check`（本地 mock） | **7/7 通过** |
| 条件对照（4 组，单变量 + 反例） | 已执行；反例中 suitable 且目标为训练阶段者 **0 个** |
| 关系候选检索（确定性） | 已执行；4 组论文对的候选句与覆盖度已记录，3 条真实句子被认证为原文明示 |
| 线上构建指纹 | `7b35461dbe`，与本地一致 |

---

## 7. 仍未验证 / 已知限制

| 项 | 说明 |
| --- | --- |
| 真实接口的鉴权失败提示 | 观察窗口内服务未返回响应，保持未验证（已用本地 mock 覆盖同一代码路径） |
| 模型判定的稳定性 | 条件对照每组只跑一次（温度 0.2），未做多次重复统计 |
| 关系候选句的语义充分性 | 程序仍只做「必要条件」判定（指名 + 措辞 + 指向关系另一端 + 非第三方主语），语义仍建议人工复核；界面已写明该边界 |
| 论文级初筛 | 结果级比较仍需选定具体实验（任务 + 数据集版本/划分 + 指标 + 设置） |
| 5 篇样例仍未出现显存/并行/配置级算力证据 | 因此没有候选能被认证为 `suitable`；这不是缺陷，而是证据不足的如实结论 |
| 扫描件/OCR、自动全网检索、失败经验库、多用户协作 | 范围外 |
