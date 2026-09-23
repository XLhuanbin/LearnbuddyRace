# 离线分析报告（真实模型）

- 生成时间：2026/9/17 15:47:01
- 模型：deepseek-chat（api.deepseek.com）
- 提示词版本：v3.0.0
- 领域标注：Transformer 序列建模与预训练语言模型（开发流程验证用样例）（已确认=false）

## 字段抽取与证据校验

| 论文 | 年份 | 有值字段 | 可核验 | 待人工核对 | 未找到证据 | 缺失 |
| --- | --- | --- | --- | --- | --- | --- |
| Attention Is All You Need | 2017 | 7/7 | 6 | 0 | 1 | 0 |
| BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding | 2018 | 7/7 | 6 | 0 | 1 | 0 |
| RoBERTa: A Robustly Optimized BERT Pretraining Approach | 2019 | 7/7 | 7 | 0 | 0 | 0 |
| DistilBERT, a distilled version of BERT: smaller, faster, cheaper and lighter | 2019 | 7/7 | 6 | 0 | 1 | 0 |
| Language Models are Few-Shot Learners | 2020 | 7/7 | 7 | 0 | 0 | 0 |

## 实验条件（不可比检测依据）

| 论文 | 维度 | 取值 | 状态 |
| --- | --- | --- | --- |
| Attention Is All You Need | datasets | WMT 2014 English-to-German、WMT 2014 English-to-French | verified |
| Attention Is All You Need | dataSplits | — | not_extracted |
| Attention Is All You Need | metrics | BLEU | verified |
| Attention Is All You Need | pretrainingCorpus | — | not_extracted |
| Attention Is All You Need | downstreamExtraData | none | unverified |
| Attention Is All You Need | dataAugmentation | none | unverified |
| Attention Is All You Need | pretrainedModel | none（从头训练） | unverified |
| Attention Is All You Need | experimentalSettings | 机器翻译评估：从头训练（from scratch），在 WMT 2014 EN-DE 与 EN-FR 上报告 BLEU；big 模型 EN-DE 训练 3.5 天/8 P100 GPU，EN-FR 使用 dropout Pdrop=0.1（而非 0.3） | verified |
| Attention Is All You Need | computeResources | 8 x P100 GPU，训练 3.5 天（Transformer big，WMT 2014 English-to-German） | verified |
| BERT: Pre-training of Deep Bidirec | datasets | GLUE、MultiNLI、SQuAD v1.1、SQuAD v2.0、CoNLL-2003 NER | verified |
| BERT: Pre-training of Deep Bidirec | dataSplits | — | not_extracted |
| BERT: Pre-training of Deep Bidirec | metrics | GLUE score、accuracy、F1 | verified |
| BERT: Pre-training of Deep Bidirec | pretrainingCorpus | BooksCorpus (800M words)、English Wikipedia (2,500M words) | verified |
| BERT: Pre-training of Deep Bidirec | downstreamExtraData | none | unverified |
| BERT: Pre-training of Deep Bidirec | dataAugmentation | none | unverified |
| BERT: Pre-training of Deep Bidirec | pretrainedModel | BERTBASE (L=12, H=768, A=12, Total Parameters=110M)、BERTLARGE (L=24, H=1024, A=16, Total Parameters=340M) | verified |
| BERT: Pre-training of Deep Bidirec | experimentalSettings | fine-tuning：在预训练模型上添加一个输出层，并在下游任务上端到端微调所有参数。 | verified |
| BERT: Pre-training of Deep Bidirec | computeResources | 单块 Cloud TPU 最多 1 小时，或 GPU 几小时（微调） | verified |
| RoBERTa: A Robustly Optimized BERT | datasets | GLUE、SQuAD V1.1、SQuAD V2.0、RACE | verified |
| RoBERTa: A Robustly Optimized BERT | dataSplits | GLUE：提供 train/dev 划分 + 私有 held-out test（leaderboard）、SQuAD：dev 与 test 设置（Table 6 区分 dev 与 test）、RACE：test 集（Table 7 报告 test 结果） | verified |
| RoBERTa: A Robustly Optimized BERT | metrics | F1、accuracy、EM | verified |
| RoBERTa: A Robustly Optimized BERT | pretrainingCorpus | BOOKCORPUS + English WIKIPEDIA (16GB)、CC-NEWS (76GB after filtering)、OPENWEBTEXT (38GB)、STORIES (31GB)、总计超过 160GB 未压缩文本 | verified |
| RoBERTa: A Robustly Optimized BERT | downstreamExtraData | none | unverified |
| RoBERTa: A Robustly Optimized BERT | dataAugmentation | none | unclear |
| RoBERTa: A Robustly Optimized BERT | pretrainedModel | RoBERTaLARGE：L=24, H=1024, A=16, 355M 参数，遵循 BERTLARGE 架构、RoBERTaBASE：L=12, H=768, A=12, 110M 参数，遵循 BERTBASE 架构 | verified |
| RoBERTa: A Robustly Optimized BERT | experimentalSettings | fine-tuning：在单任务训练数据上微调预训练模型，不使用多任务训练或集成；微调流程遵循原 BERT 论文、fine-tuning：SQuAD V1.1 采用与 BERT 相同的 span 预测方法；SQuAD V2.0 增加可回答性二分类器，与 span 损失联合训练、fine-tuning：RACE 将每个候选答案与问题、段落拼接编码，经全连接层预测正确答案 | verified |
| RoBERTa: A Robustly Optimized BERT | computeResources | 预训练：DGX-1 机器，每台 8×32GB Nvidia V100 GPU，通过 Infiniband 互联，混合精度、预训练：1024 块 V100 GPU，约一天（RoBERTa 在 BOOKCORPUS+WIKIPEDIA 上预训练 100K 步） | verified |
| DistilBERT, a distilled version of | datasets | GLUE、IMDb、SQuAD v1.1 | verified |
| DistilBERT, a distilled version of | dataSplits | GLUE：dev sets、IMDb：test set、SQuAD v1.1：dev set | verified |
| DistilBERT, a distilled version of | metrics | accuracy、EM、F1、inference time、macro-score | verified |
| DistilBERT, a distilled version of | pretrainingCorpus | English Wikipedia and Toronto Book Corpus | verified |
| DistilBERT, a distilled version of | downstreamExtraData | none | unclear |
| DistilBERT, a distilled version of | dataAugmentation | none | unverified |
| DistilBERT, a distilled version of | pretrainedModel | DistilBERT 从 BERT-base 初始化，学生模型从教师模型每隔一层初始化。 | verified |
| DistilBERT, a distilled version of | experimentalSettings | fine-tuning：在 GLUE、IMDb、SQuAD 上微调 DistilBERT，无集成或多任务；zero-shot：未提及；few-shot：未提及；知识蒸馏：预训练阶段使用知识蒸馏；从头训练：未提及。 | verified |
| DistilBERT, a distilled version of | computeResources | 8 16GB V100 GPUs for approximately 90 hours | verified |
| Language Models are Few-Shot Learn | datasets | Quac、SQuADv2、DROP、Symbol Insertion、CoQa、ReCoRD、Winograd、BoolQ、MultiRC、RACE-h、LAMBADA、LAMBADA (No Blanks)、WSC、PIQA、RACE-m、De→En 16、En→De 16、En→Ro 16、Ro→En 16、WebQs、ANLI R1、ANLI R2、TriviaQA、ANLI R3、En→Fr 14、Fr→En 14、WiC、RTE、CB、Anagrams 2、Reversed Words、OpenBookQA、ARC (Easy)、Anagrams 1、COPA、ARC (Challenge)、HellaSwag、NQs、Cycled Letters、SAT Analogies、StoryCloze、Winogrande | verified |
| Language Models are Few-Shot Learn | dataSplits | Quac：dev、SQuADv2：dev、DROP：dev、Symbol Insertion：dev、CoQa：dev、ReCoRD：dev、Winograd：test、BoolQ：dev、MultiRC：dev、RACE-h：test、LAMBADA：test、LAMBADA (No Blanks)：test、WSC：dev、PIQA：dev、RACE-m：test、De→En 16：test、En→De 16：test、En→Ro 16：test、Ro→En 16：test、WebQs：test、ANLI R1：test、ANLI R2：test、TriviaQA：dev、ANLI R3：test、En→Fr 14：test、Fr→En 14：test、WiC：dev、RTE：dev、CB：dev、Anagrams 2：dev、Reversed Words：dev、OpenBookQA：test、ARC (Easy)：test、Anagrams 1：dev、COPA：dev、ARC (Challenge)：test、HellaSwag：dev、NQs：test、Cycled Letters：dev、SAT Analogies：dev、StoryCloze：test、Winogrande：dev | verified |
| Language Models are Few-Shot Learn | metrics | accuracy、F1、BLEU | verified |
| Language Models are Few-Shot Learn | pretrainingCorpus | Common Crawl（经过过滤和模糊去重）、已知高质量参考语料库（未在片段中列出具体名称） | verified |
| Language Models are Few-Shot Learn | downstreamExtraData | none | verified |
| Language Models are Few-Shot Learn | dataAugmentation | none | unverified |
| Language Models are Few-Shot Learn | pretrainedModel | GPT-3 175B（1750 亿参数），从头训练；同时训练了 8 种不同规模的模型（125M 到 175B） | verified |
| Language Models are Few-Shot Learn | experimentalSettings | 评估协议：zero-shot, one-shot, few-shot（无梯度更新或微调，仅前向传播） | verified |
| Language Models are Few-Shot Learn | computeResources | GPT-3 175B：3.64E+03 PF-days（3.14E+23 flops），训练 3000 亿 token | verified |

## 程序校验问题

- [warn] p_arxiv_1706.03762 inputsConditions page_mismatch：输入/训练条件：模型自称页码 p.3，但引文实际定位在第 2 页，已采用实际定位结果。
- [warn] p_arxiv_1706.03762 limitations evidence_missing：局限：模型给出了内容但没有提供任何原文引文，标记为「未找到证据」。
- [warn] p_arxiv_1706.03762 dataSplits condition_not_extracted：数据划分：本次提供的片段中未提取到该信息（不等于论文没有报告）。比较时按「信息不足」处理。
- [warn] p_arxiv_1706.03762 pretrainingCorpus condition_not_extracted：预训练语料：本次提供的片段中未提取到该信息（不等于论文没有报告）。比较时按「信息不足」处理。
- [warn] p_arxiv_1706.03762 downstreamExtraData evidence_not_located：下游额外训练数据：有内容但引文未通过定位校验或未支撑该主张。
- [warn] p_arxiv_1706.03762 dataAugmentation evidence_not_located：数据增强：有内容但引文未通过定位校验或未支撑该主张。
- [warn] p_arxiv_1706.03762 pretrainedModel evidence_not_located：预训练模型：有内容但引文未通过定位校验或未支撑该主张。
- [warn] p_arxiv_1810.04805 limitations evidence_missing：局限：模型给出了内容但没有提供任何原文引文，标记为「未找到证据」。
- [warn] p_arxiv_1810.04805 dataSplits condition_not_extracted：数据划分：本次提供的片段中未提取到该信息（不等于论文没有报告）。比较时按「信息不足」处理。
- [warn] p_arxiv_1810.04805 downstreamExtraData evidence_not_located：下游额外训练数据：有内容但引文未通过定位校验或未支撑该主张。
- [warn] p_arxiv_1810.04805 dataAugmentation evidence_not_located：数据增强：有内容但引文未通过定位校验或未支撑该主张。
- [warn] p_arxiv_1907.11692 metrics page_mismatch：评价指标：模型自称页码 p.4，但引文实际定位在第 5 页，已采用实际定位结果。
- [warn] p_arxiv_1907.11692 downstreamExtraData evidence_not_located：下游额外训练数据：有内容但引文未通过定位校验或未支撑该主张。
- [warn] p_arxiv_1907.11692 dataAugmentation condition_unconfirmed：数据增强：无法确认（表述含糊）。
- [warn] p_arxiv_1910.01108 limitations evidence_missing：局限：模型给出了内容但没有提供任何原文引文，标记为「未找到证据」。
- [warn] p_arxiv_1910.01108  title_unverified：标题未确认：当前标题「The last two years have seen the rise of Transfer Learning a…」取自 PDF 首页文本，看起来不是论文标题。
- [warn] p_arxiv_1910.01108 downstreamExtraData condition_unconfirmed：下游额外训练数据：无法确认（表述含糊）。
- [warn] p_arxiv_1910.01108 dataAugmentation evidence_not_located：数据增强：有内容但引文未通过定位校验或未支撑该主张。
- [warn] p_arxiv_2005.14165 dataAugmentation evidence_not_located：数据增强：有内容但引文未通过定位校验或未支撑该主张。

## 方法关系

- Attention Is All You Need → BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding：extends（原文明示）
  - 依据：Model Architecture BERT’s model architec- ture is a multi-layer bidirectional Transformer en- coder based on the original implementation de- scribed in Vaswani et al
- BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding → RoBERTa: A Robustly Optimized BERT Pretraining Approach：improves（原文明示）
  - 依据：When controlling for training data, our im- proved training procedure improves upon the pub- lished BERT results on both GLUE and SQuAD
- BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding → DistilBERT, a distilled version of BERT: smaller, faster, cheaper and lighter：extends（原文明示）
  - 依据：3 DistilBERT: a distilled version of BERT Student architecture In the present work, the student - DistilBERT - has the same general architec- ture as BERT
- Attention Is All You Need → DistilBERT, a distilled version of BERT: smaller, faster, cheaper and lighter：extends（系统推断）
  - 依据：Using a triple loss, we show that a 40% smaller Transformer (Vaswani et al. [2017]) pre-trained through distillation via the supervision of a bigger Transformer language model can achieve similar performance on a variety
- Attention Is All You Need → Language Models are Few-Shot Learners：unclear（系统推断）
  - 依据：提供的 GPT-3 相关片段只提到 GPT-3 的评估、性能提升与参数规模，未出现 Transformer 或 Vaswani et al. 等指名继承关系的表述，无法依据现有原文判定 GPT-3 与 Transformer 的具体关系，需核查 GPT-3 论文中关于模型架构来源的原文。
- BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding → Language Models are Few-Shot Learners：unclear（系统推断）
  - 依据：提供的 GPT-3 相关片段未提及 BERT，也未出现基于/改进 BERT 的措辞，无法依据现有原文判定 GPT-3 与 BERT 的关系，需核查 GPT-3 论文中是否明确说明与 BERT 的承接关系。

## 跨论文分歧发现

- [individual_limitations] 各论文作者承认的局限或未来工作方向｜可比性=not_comparable
  - 涉及：p_arxiv_1907.11692、p_arxiv_2005.14165
  - 说明：两篇论文各自承认的局限针对完全不同的对象：RoBERTa 的局限是关于其自身架构改动（含更大架构）未在本文研究，属于方法设计层面的未来工作；GPT-3 的局限是关于其少样本学习在部分数据集上表现不佳以及大规模网络语料训练带来的方法学问题，属于评估与数据层面的问题。二者既非同一任务、同一数据集，也非同一约束，不构成共同局限，因此分别列出。
  - 下一步：若需聚合共同局限，应核查是否存在同一任务/数据集/约束下双方都承认的同类限制；当前材料不支持。
- [condition_confounded] 不同论文报告的下游任务性能数值是否可直接比较｜可比性=not_comparable
  - 涉及：p_arxiv_1706.03762、p_arxiv_1810.04805、p_arxiv_1907.11692、p_arxiv_1910.01108、p_arxiv_2005.14165
  - 说明：系统给出的可比性判定为「当前不能直接比较」，且各论文在数据集、指标、实验设置、预训练语料与模型规模上均存在差异。因此这些数值结果之间不存在可直接比较的共同对象，任何数值高低都无法排除条件差异的影响，也不能归因于方法本身。此处仅作为条件混杂记录，不构成结论分歧。
  - 条件差异：数据集(Transformer 使用 WMT 2014 EN-DE/EN-FR；BERT 使用 GLUE、MultiNLI、SQuAD v1.1/v2.0、CoNLL-2003 NER；RoBERTa 使用 GLUE、SQuAD V1.1/V2.0、RACE；DistilBERT 使用 GLUE、IMDb、SQuAD v1.1；GPT-3 使用数十个数据集（含 SQuADv2、RACE、LAMBADA 等）。各论文任务与数据集几乎不重叠。)；评价指标(Transformer 报告 BLEU；BERT 报告 GLUE score、accuracy、F1；RoBERTa 报告 F1、accuracy、EM；DistilBERT 报告 accuracy、EM、F1、inference time、macro-score；GPT-3 报告 accuracy、F1、BLEU。指标集合不一致。)；实验设置(Transformer 为机器翻译从头训练；BERT/RoBERTa/DistilBERT 为预训练后微调；GPT-3 为无梯度更新的 zero/one/few-shot 前向评估。训练与评估范式不同。)；预训练语料(BERT 使用 BooksCorpus + English Wikipedia；RoBERTa 使用 BookCorpus + Wikipedia + CC-NEWS + OPENWEBTEXT + STORIES（超 160GB）；DistilBERT 使用 English Wikipedia and Toronto Book；GPT-3 使用过滤去重后的 Common Crawl 及高质量参考语料。语料规模与来源差异巨大。)；预训练模型(BERT 为 BERTBASE/BERTLARGE；RoBERTa 为 RoBERTaBASE/RoBERTaLARGE；DistilBERT 从 BERT-base 每隔一层初始化；GPT-3 为 175B 参数模型（并训练 125M–175B 多种规模）。模型规模与初始化方式不同。)
  - 下一步：若要做数值比较，需先统一任务与数据集版本/划分、评价指标与评估协议（微调 vs 少样本），并控制预训练语料与模型规模。

### 已检查的论文对

- Attention Is All You Need ↔ BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding：可比性=当前不能直接比较；条件差异：数据集、评价指标、实验设置
- Attention Is All You Need ↔ RoBERTa: A Robustly Optimized BERT Pretraining Approach：可比性=当前不能直接比较；条件差异：数据集、评价指标、实验设置
- Attention Is All You Need ↔ DistilBERT, a distilled version of BERT: smaller, faster, cheaper and lighter：可比性=当前不能直接比较；条件差异：数据集、评价指标、实验设置
- Attention Is All You Need ↔ Language Models are Few-Shot Learners：可比性=当前不能直接比较；条件差异：数据集、评价指标、实验设置
- BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding ↔ RoBERTa: A Robustly Optimized BERT Pretraining Approach：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练语料、预训练模型
- BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding ↔ DistilBERT, a distilled version of BERT: smaller, faster, cheaper and lighter：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练语料、预训练模型、实验设置
- BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding ↔ Language Models are Few-Shot Learners：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练语料、预训练模型、实验设置
- RoBERTa: A Robustly Optimized BERT Pretraining Approach ↔ DistilBERT, a distilled version of BERT: smaller, faster, cheaper and lighter：可比性=当前不能直接比较；条件差异：数据集、数据划分、评价指标、预训练语料、预训练模型、实验设置
- RoBERTa: A Robustly Optimized BERT Pretraining Approach ↔ Language Models are Few-Shot Learners：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练语料、预训练模型、实验设置
- DistilBERT, a distilled version of BERT: smaller, faster, cheaper and lighter ↔ Language Models are Few-Shot Learners：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练语料、预训练模型、实验设置

## 不可比检测矩阵（规则计算）

总体结论：**当前不能直接比较** —— 以下条件不一致，不能直接比较：数据集、评价指标、实验设置；以下条件信息不足，无法判断：数据划分、预训练语料、下游额外训练数据、数据增强、预训练模型。

| 条件维度 | 结论 | 具体差异 |
| --- | --- | --- |
| 数据集 | 当前不能直接比较 | Attention Is All You Need（WMT 2014 English-to-German、WMT 2014 English-to-French）与 BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding（GLUE、MultiNLI、SQuAD v1.1、SQuAD v2.0、CoNLL-2003 NER）没有共同项；Attention Is All You Need（WMT 2014 English-to-German、WMT 2014 English-to-French） |
| 数据划分 | 信息不足，无法判断 | — |
| 评价指标 | 当前不能直接比较 | Attention Is All You Need（BLEU）与 BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding（GLUE score、accuracy、F1）没有共同项；Attention Is All You Need（BLEU）与 RoBERTa: A Robustly Optimized BERT Pretraining Approach（F1、accuracy、EM）没有共同项；Attention Is All You Need（BLEU）与 DistilBERT, a  |
| 预训练语料 | 信息不足，无法判断 | — |
| 下游额外训练数据 | 信息不足，无法判断 | — |
| 数据增强 | 信息不足，无法判断 | — |
| 预训练模型 | 信息不足，无法判断 | — |
| 实验设置 | 当前不能直接比较 | Attention Is All You Need（协议：从头训练）↔ BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding（协议：微调/预训练）；Attention Is All You Need（协议：从头训练）↔ RoBERTa: A Robustly Optimized BERT Pretraining Approach（协议：微调/预训练）；Attention Is All You Need（协议：从头训练）↔ Language Models are Few-Shot Lear |
| 算力/训练时长 | 只能有限比较 | — |

### 各论文条件取值

- Attention Is All You Need
  - datasets：WMT 2014 English-to-German、WMT 2014 English-to-French（verified，摘要还提到英语成分句法分析，但片段中未给出其数据集名称。）
  - dataSplits：—（not_extracted，片段中未给出 WMT 2014 等数据集的 train/dev/test 划分说明。）
  - metrics：BLEU（verified）
  - pretrainingCorpus：—（not_extracted，片段中未描述预训练语料；该论文方法为从头训练，但片段未给出相关表述。）
  - downstreamExtraData：none（unverified，片段中未提及相对某个实验额外引入的训练数据。）
  - dataAugmentation：none（unverified，片段中未提及数据增强。）
  - pretrainedModel：none（从头训练）（unverified，片段中未明确说明初始化来源；从方法描述看为从头训练，但缺少可直接引用的原文句子。）
  - experimentalSettings：机器翻译评估：从头训练（from scratch），在 WMT 2014 EN-DE 与 EN-FR 上报告 BLEU；big 模型 EN-DE 训练 3.5 天/8 P100 GPU，EN-FR 使用 dropout Pdrop=0.1（而非 0.3）（verified，片段未出现 fine-tuning / zero-shot / few-shot / 知识蒸馏 等协议描述；从方法看为从头训练。）
  - computeResources：8 x P100 GPU，训练 3.5 天（Transformer big，WMT 2014 English-to-German）（verified）
- BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding
  - datasets：GLUE、MultiNLI、SQuAD v1.1、SQuAD v2.0、CoNLL-2003 NER（verified，片段中未列出全部十一个任务的数据集，仅提取明确出现的评估数据集。）
  - dataSplits：—（not_extracted，提供的片段中没有关于数据集划分的详细描述。）
  - metrics：GLUE score、accuracy、F1（verified）
  - pretrainingCorpus：BooksCorpus (800M words)、English Wikipedia (2,500M words)（verified）
  - downstreamExtraData：none（unverified，提供的片段中没有明确说明下游任务是否使用了额外数据。）
  - dataAugmentation：none（unverified，提供的片段中没有提到数据增强。）
  - pretrainedModel：BERTBASE (L=12, H=768, A=12, Total Parameters=110M)、BERTLARGE (L=24, H=1024, A=16, Total Parameters=340M)（verified）
  - experimentalSettings：fine-tuning：在预训练模型上添加一个输出层，并在下游任务上端到端微调所有参数。（verified）
  - computeResources：单块 Cloud TPU 最多 1 小时，或 GPU 几小时（微调）（verified）
- RoBERTa: A Robustly Optimized BERT Pretraining Approach
  - datasets：GLUE、SQuAD V1.1、SQuAD V2.0、RACE（verified，三个基准为 GLUE、SQuAD、RACE；SQuAD 含 V1.1 与 V2.0。）
  - dataSplits：GLUE：提供 train/dev 划分 + 私有 held-out test（leaderboard）、SQuAD：dev 与 test 设置（Table 6 区分 dev 与 test）、RACE：test 集（Table 7 报告 test 结果）（verified，SQuAD 与 RACE 的划分细节在片段中未明确说明。）
  - metrics：F1、accuracy、EM（verified，EM 见 Table 6 表头。）
  - pretrainingCorpus：BOOKCORPUS + English WIKIPEDIA (16GB)、CC-NEWS (76GB after filtering)、OPENWEBTEXT (38GB)、STORIES (31GB)、总计超过 160GB 未压缩文本（verified，各语料规模见同页列表。）
  - downstreamExtraData：none（unverified，引文是局部实验描述（出现「provided SQuAD」这类限定），只说明该实验的情况，不能支持「整篇论文均无」的否定结论。该条件不作为「一致」的依据。）
  - dataAugmentation：none（unclear，该引文只是 Table 6 中 SQuAD dev 单模型结果的局部描述，不能支持整篇论文级「未做数据增强」的结论。）
  - pretrainedModel：RoBERTaLARGE：L=24, H=1024, A=16, 355M 参数，遵循 BERTLARGE 架构、RoBERTaBASE：L=12, H=768, A=12, 110M 参数，遵循 BERTBASE 架构（verified，BASE 配置见第 4 页「BERTBASE (L = 12, H = 768, A = 12, 110M params)」。）
  - experimentalSettings：fine-tuning：在单任务训练数据上微调预训练模型，不使用多任务训练或集成；微调流程遵循原 BERT 论文、fine-tuning：SQuAD V1.1 采用与 BERT 相同的 span 预测方法；SQuAD V2.0 增加可回答性二分类器，与 span 损失联合训练、fine-tuning：RACE 将每个候（verified，SQuAD 与 RACE 的微调细节见第 4 页及后续片段。）
  - computeResources：预训练：DGX-1 机器，每台 8×32GB Nvidia V100 GPU，通过 Infiniband 互联，混合精度、预训练：1024 块 V100 GPU，约一天（RoBERTa 在 BOOKCORPUS+WIKIPEDIA 上预训练 100K 步）（verified）
- DistilBERT, a distilled version of BERT: smaller, faster, cheaper and lighter
  - datasets：GLUE、IMDb、SQuAD v1.1（verified，IMDb 和 SQuAD 在后续句子中提及。）
  - dataSplits：GLUE：dev sets、IMDb：test set、SQuAD v1.1：dev set（verified，IMDb 和 SQuAD 的划分在表2标题中说明。）
  - metrics：accuracy、EM、F1、inference time、macro-score（verified，GLUE 使用 macro-score，推理时间在表3中报告。）
  - pretrainingCorpus：English Wikipedia and Toronto Book Corpus（verified）
  - downstreamExtraData：none（unclear，该引文仅说明未使用集成或多任务微调，未明确说明是否引入额外数据。）
  - dataAugmentation：none（unverified，提供的片段中没有提及数据增强。）
  - pretrainedModel：DistilBERT 从 BERT-base 初始化，学生模型从教师模型每隔一层初始化。（verified）
  - experimentalSettings：fine-tuning：在 GLUE、IMDb、SQuAD 上微调 DistilBERT，无集成或多任务；zero-shot：未提及；few-shot：未提及；知识蒸馏：预训练阶段使用知识蒸馏；从头训练：未提及。（verified，评估协议为微调。）
  - computeResources：8 16GB V100 GPUs for approximately 90 hours（verified）
- Language Models are Few-Shot Learners
  - datasets：Quac、SQuADv2、DROP、Symbol Insertion、CoQa、ReCoRD、Winograd、BoolQ、MultiRC、RACE-h、LAMBADA、LAMBADA (No Blanks)、WSC、PIQA、RACE-m、De→En 16、En→De 16、En→Ro 16、Ro→En 16、Web（verified，数据集名称来自表 C.1 的 Name 列。）
  - dataSplits：Quac：dev、SQuADv2：dev、DROP：dev、Symbol Insertion：dev、CoQa：dev、ReCoRD：dev、Winograd：test、BoolQ：dev、MultiRC：dev、RACE-h：test、LAMBADA：test、LAMBADA (No Blanks)：test、WSC（verified，划分信息来自表 C.1 的 Split 列。）
  - metrics：accuracy、F1、BLEU（verified）
  - pretrainingCorpus：Common Crawl（经过过滤和模糊去重）、已知高质量参考语料库（未在片段中列出具体名称）（verified，片段中未给出具体语料名称和规模。）
  - downstreamExtraData：none（verified，论文明确说明所有任务均不进行梯度更新或微调，仅通过文本交互提供任务描述和少量示例。）
  - dataAugmentation：none（unverified，提供的片段中未提及数据增强。）
  - pretrainedModel：GPT-3 175B（1750 亿参数），从头训练；同时训练了 8 种不同规模的模型（125M 到 175B）（verified）
  - experimentalSettings：评估协议：zero-shot, one-shot, few-shot（无梯度更新或微调，仅前向传播）（verified）
  - computeResources：GPT-3 175B：3.64E+03 PF-days（3.14E+23 flops），训练 3000 亿 token（verified，算力数据来自表 D.1。）

## 示例决策（演示用用户条件）

- 用户条件：{"background":"计算机相关专业，上过机器学习课，能读懂 Transformer 基本结构","interest":"想了解预训练语言模型的训练与评测思路，偏向可复现的小模型方向","time":"两周，每天约 2 小时","compute":"只有一台笔记本，无 GPU 集群","goal":"选一个能上手复现的小方向做课程项目"}
- 候选 p_arxiv_1910.01108：fit=conditional，算力已报告=true
  - [paper] 用户想了解预训练语言模型的训练与评测思路，且偏向可复现的小模型方向；DistilBERT 的核心思路正是在预训练阶段用知识蒸馏让学生模型模仿教师 BERT，属于「小模型 + 预训练思路」的直接相关方法。
  - [paper] 评测侧有明确可参照的下游任务与指标：GLUE、IMDb、SQuAD v1.1，指标为 accuracy、EM、F1、inference time、macro-score，便于课程项目设计评测环节。
  - [paper] 论文报告的算力条目属于预训练阶段（8 张 16GB V100 约 90 小时），用户只有笔记本且无 GPU 集群，因此无法按论文配置复现其预训练；该条目不能用于判断微调或推理阶段的可运行性。
  - [gap] 论文未明确提及局限性，无法据此判断该方法在用户场景下的适用边界。
  - 缺失信息：论文未报告微调阶段与推理阶段的算力与训练时长，无法确认用户笔记本上微调/推理的可运行性；论文未明确提及局限性
- 候选 p_arxiv_1810.04805：fit=conditional，算力已报告=true
  - [paper] BERT 的核心思路是双向 Transformer 编码器 + MLM/NSP 预训练，预训练后只需加一个输出层即可微调，正好覆盖用户想了解的「预训练 + 评测」思路。
  - [paper] 论文报告的算力条目属于微调阶段（单块 Cloud TPU 最多 1 小时，或 GPU 几小时），这是材料中唯一明确标注为 finetune 阶段的算力信息，对「只有笔记本」的用户而言，微调阶段的可运行性相对更可讨论；但该条目仅覆盖微调，不能推断预训练阶段能否在笔记本上完成。
  - [paper] 评测侧给出 GLUE、MultiNLI、SQuAD v1.1、SQuAD v2.0、CoNLL-2003 NER 与 GLUE score、accuracy、F1，便于课程项目选择评测任务与指标。
  - [gap] 论文未明确提及局限性，无法据此判断适用边界。
  - 缺失信息：论文未报告预训练阶段的算力与训练时长，无法确认用户笔记本上从头预训练的可运行性；论文未明确提及局限性
- 候选 p_arxiv_1907.11692：fit=unknown，算力已报告=true
  - [paper] RoBERTa 的核心思路是在保持 BERT 架构不变的前提下系统研究预训练关键设计选择（动态掩码、是否使用 NSP、输入格式、批大小、数据规模与训练步数），与用户「了解预训练语言模型的训练思路」的兴趣高度相关。
  - [paper] 论文报告的算力条目属于预训练阶段（DGX-1 每台 8×32GB V100；1024 块 V100 约一天），用户只有笔记本且无 GPU 集群，无法按论文配置复现其预训练；该条目不能用于判断微调或推理阶段的可运行性。
  - [paper] 论文承认架构改动（包括更大架构）留作未来工作，未在本文研究，说明其结论边界限于所研究的预训练设计选择，而非任意架构改动。
  - [gap] 材料中未给出 RoBERTa 微调阶段或推理阶段的算力信息，无法判断用户笔记本上能否完成微调或推理，因此整体适配性只能标为 unknown。
  - 缺失信息：论文未报告微调阶段与推理阶段的算力与训练时长，无法确认用户笔记本上微调/推理的可运行性
- 候选 p_arxiv_1706.03762：fit=unknown，算力已报告=true
  - [paper] Transformer 的核心思路（编码器-解码器、多头自注意力、位置编码）是用户已能读懂 Transformer 基本结构的基础，可作为理解后续预训练模型的起点。
  - [paper] 论文报告的算力条目属于从头训练阶段（8 x P100 GPU，训练 3.5 天，Transformer big，WMT 2014 English-to-German），用户只有笔记本且无 GPU 集群，无法按论文配置复现该从头训练；该条目不能用于判断微调或推理阶段的可运行性。
  - [paper] 评测侧为 WMT 2014 EN-DE 与 EN-FR 上的 BLEU，属于机器翻译任务，与用户「预训练语言模型的训练与评测」兴趣方向不完全一致。
  - [gap] 论文片段中未找到作者明确承认的局限或适用范围限制，无法据此判断适用边界。
  - 缺失信息：论文未报告微调阶段与推理阶段的算力与训练时长，无法确认用户笔记本上微调/推理的可运行性；论文片段中未找到作者明确承认的局限或适用范围限制
- 候选 p_arxiv_2005.14165：fit=unknown，算力已报告=true
  - [paper] GPT-3 的核心思路是 1750 亿参数自回归语言模型，评估时不进行梯度更新或微调，仅通过上下文示例完成零样本/单样本/少样本任务，与用户想了解的「预训练 + 评测思路」相关。
  - [paper] 论文报告的算力条目属于预训练阶段（GPT-3 175B：3.64E+03 PF-days，训练 3000 亿 token），用户只有笔记本且无 GPU 集群，无法按论文配置复现其预训练；该条目不能用于判断微调或推理阶段的可运行性。
  - [paper] 论文承认 GPT-3 的少样本学习在某些数据集上仍然表现不佳，并且一些数据集存在与大规模网络语料训练相关的方法学问题，说明其评测结论存在边界。
  - [gap] 材料中未给出 GPT-3 推理阶段的算力信息，无法判断用户笔记本上能否完成推理，因此整体适配性只能标为 unknown。
  - 缺失信息：论文未报告推理阶段的算力与时长，无法确认用户笔记本上推理的可运行性
- 1. p_arxiv_1706.03762｜profile：用户已能读懂 Transformer 基本结构，先读这篇可把架构术语对齐，再读 BERT/RoBERTa/DistilBERT 时不会卡在结构描述上。
- 2. p_arxiv_1810.04805｜paper：BERT 是用户兴趣方向（预训练语言模型的训练与评测）的核心节点，且材料中唯一明确标注 finetune 阶段的算力条目来自这篇，便于用户区分预训练与微调两个阶段的成本。
- 3. p_arxiv_1907.11692｜paper：在理解 BERT 预训练目标之后读 RoBERTa，可以看清「预训练配方」这一层变量，契合用户想了解训练思路的兴趣；但需注意其预训练算力远超笔记本条件。
- 4. p_arxiv_1910.01108｜paper：这是材料中最贴近「小模型 + 预训练」方向的一篇，适合在理解 BERT 之后看如何把大模型能力压到小模型；但论文只报告了预训练阶段算力，微调/推理阶段算力缺失。
- 5. p_arxiv_2005.14165｜paper：作为「评测思路」的极端案例放在最后读，帮助用户理解不微调路线；其预训练算力与用户条件差距极大，只宜作为思路参考。
- 条件敏感性：若用户获得可用的 GPU 资源或把目标从「复现」改为「读论文写综述」，则 BERT 微调与 DistilBERT 相关方向的适配性会上升；若时间进一步压缩到几天，则只能停留在读论文与理解评测协议层面。