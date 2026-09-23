# 离线分析报告（真实模型）

- 生成时间：2026/9/18 17:46:50
- 模型：deepseek-chat（api.deepseek.com）
- 提示词版本：v3.0.0
- 领域标注：图像分类中 CNN 与视觉 Transformer 的方法演进与实验比较（已确认=true）

## 字段抽取与证据校验

| 论文 | 年份 | 有值字段 | 可核验 | 待人工核对 | 未找到证据 | 缺失 |
| --- | --- | --- | --- | --- | --- | --- |
| Training data-efficient image transformers & distillation through attention | 2020 | 7/7 | 7 | 0 | 0 | 0 |
| Swin Transformer: Hierarchical Vision Transformer using Shifted Windows | 2021 | 7/7 | 7 | 0 | 0 | 0 |
| A ConvNet for the 2020s | 2022 | 7/7 | 7 | 0 | 0 | 0 |

## 实验条件（不可比检测依据）

| 论文 | 维度 | 取值 | 状态 |
| --- | --- | --- | --- |
| Training data-efficient image tran | datasets | ImageNet、ImageNet Real、ImageNet V2、CIFAR-10、CIFAR-100、Flowers-102、Stanford Cars、iNaturalist 2018、iNaturalist 2019 | verified |
| Training data-efficient image tran | dataSplits | ImageNet：train 1,281,167 / test 50,000，1000 类、iNaturalist 2018：train 437,513 / test 24,426，8,142 类、iNaturalist 2019：train 265,240 / test 3,003，1,010 类、Flowers-102：train 2,040 / test 6,149，102 类、Stanford Cars：train 8,144 / test 8,041，196 类、CIFAR-100：train 50,000 / test 10,000，100 类、CIFAR-10：train 50,000 / test 10,000，10 类 | verified |
| Training data-efficient image tran | metrics | top-1 accuracy、throughput (images/s) | verified |
| Training data-efficient image tran | pretrainingCorpus | none（不使用外部预训练数据，仅用 ImageNet 训练） | verified |
| Training data-efficient image tran | downstreamExtraData | none | verified |
| Training data-efficient image tran | dataAugmentation | Rand-Augment、Mixup、CutMix、random erasing、repeated augmentation、stochastic depth | verified |
| Training data-efficient image tran | pretrainedModel | none（从头训练，不使用外部预训练权重） | verified |
| Training data-efficient image tran | experimentalSettings | 从头训练 + fine-tuning：默认 224×224 训练，384×384 微调；AdamW，余弦学习率衰减，300 epochs（部分 1000 epochs）、知识蒸馏：hard/soft distillation，教师为 RegNetY-16GF convnet，τ=3.0，λ=0.1（soft）、迁移学习：ImageNet 预训练后在各下游数据集上 fine-tuning | verified |
| Training data-efficient image tran | computeResources | DeiT-B 300 epochs：2 节点 37 小时，或单节点 53 小时、DeiT-S 与 DeiT-Ti：4 GPU 训练少于 3 天、384×384 微调：单节点 8 GPU 20 小时（25 epochs） | verified |
| Swin Transformer: Hierarchical Vis | datasets | ImageNet-1K、COCO、ADE20K | verified |
| Swin Transformer: Hierarchical Vis | dataSplits | COCO：118K training, 5K validation and 20K test-dev images、ADE20K：25K images in total, with 20K for training, 2K for validation, and another 3K for testing | verified |
| Swin Transformer: Hierarchical Vis | metrics | top-1 accuracy、top-5 accuracy、box AP、mask AP、mIoU | verified |
| Swin Transformer: Hierarchical Vis | pretrainingCorpus | ImageNet-22K（用于部分模型预训练，规模未在片段中给出） | verified |
| Swin Transformer: Hierarchical Vis | downstreamExtraData | none | unclear |
| Swin Transformer: Hierarchical Vis | dataAugmentation | 未知 | unverified |
| Swin Transformer: Hierarchical Vis | pretrainedModel | 部分模型使用 ImageNet-22K 预训练权重（如 Swin-L 384 行位于 ImageNet-22K pre-trained models 分组）；其余初始化来源未在片段中说明 | verified |
| Swin Transformer: Hierarchical Vis | experimentalSettings | ImageNet 分类：在 ImageNet-1K 上评估 top-1/top-5，吞吐量在 V100 GPU 上测量（fine-tuning/评估协议细节未在片段中给出）、COCO 目标检测与实例分割：在 COCO 2017 上训练与评估，通过替换骨干网络、其他设置不变进行对比（fine-tuning）、ADE20K 语义分割：使用 mmseg 中的 UperNet 作为基础框架（fine-tuning） | verified |
| Swin Transformer: Hierarchical Vis | computeResources | V100 GPU（用于吞吐量测量） | verified |
| A ConvNet for the 2020s | datasets | ImageNet-1K、COCO、ADE20K、ImageNet-A、ImageNet-R、ImageNet-Sketch、ImageNet-C、ImageNet-C̄ | verified |
| A ConvNet for the 2020s | dataSplits | ImageNet-1K：训练/评估划分未在片段中明确说明、COCO：训练/评估划分未在片段中明确说明、ADE20K：报告 validation mIoU | unclear |
| A ConvNet for the 2020s | metrics | top-1 accuracy、AP_box、AP_box_50、AP_box_75、AP_mask、AP_mask_50、AP_mask_75、mIoU、mCE、corruption error | verified |
| A ConvNet for the 2020s | pretrainingCorpus | ImageNet-22K（用于部分 ConvNeXt 模型的预训练） | verified |
| A ConvNet for the 2020s | downstreamExtraData | none | unclear |
| A ConvNet for the 2020s | dataAugmentation | Mixup、Cutmix、RandAugment、Random Erasing、Stochastic Depth、Label Smoothing | verified |
| A ConvNet for the 2020s | pretrainedModel | none（ImageNet-1K 从头训练）、ImageNet-22K 预训练权重（用于部分模型） | verified |
| A ConvNet for the 2020s | experimentalSettings | ImageNet-1K 分类：从头训练 300 epochs，AdamW，batch size 4096，cosine decay，warmup 20 epochs、ImageNet-1K 微调：30 epochs，AdamW，batch size 512，cosine decay，layer-wise lr decay、COCO 检测/分割：fine-tuning Mask R-CNN 与 Cascade Mask R-CNN，multi-scale training，AdamW，3× schedule、ADE20K 分割：fine-tuning，报告 validation mIoU，multi-scale testing | verified |
| A ConvNet for the 2020s | computeResources | 未知 | unverified |

## 程序校验问题

- [warn] p_arxiv_2012.12877  title_unverified：标题未确认：当前标题「understanding tasks, as initially demonstrated on image clas…」取自 PDF 首页文本，看起来不是论文标题。
- [warn] p_arxiv_2103.14030  title_unverified：标题未确认：当前标题「on ImageNet-1K) and dense prediction tasks such as object de…」取自 PDF 首页文本，看起来不是论文标题。
- [warn] p_arxiv_2103.14030 downstreamExtraData condition_unconfirmed：下游额外训练数据：无法确认（表述含糊）。
- [warn] p_arxiv_2103.14030 dataAugmentation evidence_not_located：数据增强：有内容但引文未通过定位校验或未支撑该主张。
- [warn] p_arxiv_2201.03545 dataSplits condition_unconfirmed：数据划分：无法确认（表述含糊）。
- [warn] p_arxiv_2201.03545 downstreamExtraData condition_unconfirmed：下游额外训练数据：无法确认（表述含糊）。
- [warn] p_arxiv_2201.03545 computeResources evidence_not_located：算力/训练时长：有内容但引文未通过定位校验或未支撑该主张。

## 方法关系

- Swin Transformer: Hierarchical Vision Transformer using Shifted Windows → Training data-efficient image transformers & distillation through attention：unclear（系统推断）
  - 依据：提供的候选片段中，Swin Transformer 论文的句子只说明 Swin 自身由标准 Transformer 改造而来（'the proposed Swin Transformer is adapted from the standard Transformer'），并未提及 DeiT；ConvNeXt 论文的句子虽同时出现 DeiT 与 Swin，但只是说训练配方接近二者（'we use a training recipe th
- A ConvNet for the 2020s → Training data-efficient image transformers & distillation through attention：unclear（系统推断）
  - 依据：候选片段中 ConvNeXt 论文只提到其训练配方接近 DeiT（'we use a training recipe that is close to DeiT’s [73] and Swin Transformer’s [45]'），这至多说明 ConvNeXt 借鉴了 DeiT 的训练技巧，但方向是 ConvNeXt 参考 DeiT，而非 ConvNeXt 被 DeiT 基于或改进；且该句并未陈述 ConvNeXt 与 DeiT 之
- Swin Transformer: Hierarchical Vision Transformer using Shifted Windows → A ConvNet for the 2020s：improves（原文明示）
  - 依据：In the end, our pure ConvNet model, named ConvNeXt, can outperform the Swin Transformer.

## 跨论文分歧发现

- [individual_limitations] 各论文自述的局限性质不同，无法归并为同一对象上的共同局限｜可比性=not_comparable
  - 涉及：p_arxiv_2012.12877、p_arxiv_2103.14030、p_arxiv_2201.03545
  - 说明：三篇论文各自陈述的局限分别针对不同对象：DeiT 针对 CIFAR-10 上无预训练时的数据多样性不足，Swin 针对自身实现未做 kernel 优化导致的推理速度，ConvNeXt 的局限内容在给定片段中缺失。它们不构成同一任务/对象/约束上的共同局限，因此按规则拆分为 individual_limitations，而非聚合为 shared_limitation。
  - 下一步：核查 ConvNeXt 附录 §F 的实际局限内容，确认是否存在与 DeiT 或 Swin 在相同对象（如 ImageNet-1K 分类精度、推理吞吐）上的可比局限陈述。
- [condition_confounded] 无卷积视觉 Transformer 在 ImageNet 分类上的精度对比是否可归因于方法本身｜可比性=not_comparable
  - 涉及：p_arxiv_2012.12877、p_arxiv_2103.14030
  - 说明：系统判定两篇论文当前不能直接比较，且存在预训练语料、预训练权重、实验设置与指标集合等多维条件差异。因此即使两者都报告 ImageNet top-1 accuracy，也无法排除条件差异的影响，不能将精度差异归因于方法本身（DeiT 的无卷积 Transformer 设计 vs Swin 的层级移位窗口设计）。
  - 条件差异：预训练语料(DeiT 不使用外部预训练数据，仅用 ImageNet 训练；Swin 部分模型使用 ImageNet-22K 预训练，规模未在片段中给出。)；预训练模型(DeiT 从头训练、不使用外部预训练权重；Swin 部分模型使用 ImageNet-22K 预训练权重（如 Swin-L 384），其余初始化来源未在片段中说明。)；实验设置(DeiT 为 224×224 训练、384×384 微调，AdamW、余弦衰减、300 epochs（部分 1000 epochs），并含知识蒸馏；Swin 的 ImageNet 分类 fine-tuning/评估协议细节未在片段中给出，吞吐量在 V100 GPU 上测量。)；评价指标(DeiT 报告 top-1 accuracy 与 throughput；Swin 报告 top-1 accuracy、top-5 accuracy 及下游 box AP、mask AP、mIoU。)
  - 下一步：核查 Swin 在 ImageNet-1K 上从头训练（无 ImageNet-22K 预训练）的 top-1 accuracy 及其训练协议，与 DeiT 在相同训练轮数、相同分辨率与相同数据增强下的结果对齐后再比较。
- [condition_confounded] 无卷积视觉 Transformer 与现代化 ConvNet 在 ImageNet 分类上的精度对比是否可归因于架构本身｜可比性=not_comparable
  - 涉及：p_arxiv_2012.12877、p_arxiv_2201.03545
  - 说明：系统判定两篇论文当前不能直接比较，且预训练语料、预训练权重、数据增强组合、训练超参与指标集合均存在差异。因此即使两者都报告 ImageNet top-1 accuracy，也无法排除条件差异的影响，不能将精度差异归因于 DeiT 的 Transformer 架构或 ConvNeXt 的现代化 ConvNet 架构本身。
  - 条件差异：预训练语料(DeiT 不使用外部预训练数据；ConvNeXt 部分模型使用 ImageNet-22K 预训练。)；预训练模型(DeiT 从头训练、不使用外部预训练权重；ConvNeXt 的 ImageNet-1K 模型从头训练，部分模型使用 ImageNet-22K 预训练权重。)；数据增强(DeiT 使用 Rand-Augment、Mixup、CutMix、random erasing、repeated augmentation、stochastic depth；ConvNeXt 使用 Mixup、Cutmix、RandAugment、Random Erasing、Stochastic Depth、Label Smoothing。)；实验设置(DeiT 为 224×224 训练、384×384 微调，AdamW、余弦衰减、300 epochs（部分 1000 epochs），含知识蒸馏；ConvNeXt 为 ImageNet-1K 从头训练 300 epochs、AdamW、batch size 4096、cosine decay、warmup 20 epochs，微调 30 epochs、batch size 512、layer-wise lr decay。)；评价指标(DeiT 报告 top-1 accuracy 与 throughput；ConvNeXt 报告 top-1 accuracy 及 AP_box、AP_mask、mIoU、mCE 等下游与鲁棒性指标。)
  - 下一步：核查 ConvNeXt 在 ImageNet-1K 从头训练（无 ImageNet-22K 预训练）且与 DeiT 相同数据增强、相同训练轮数与相同分辨率下的 top-1 accuracy，再进行对齐比较。
- [condition_confounded] 层级式视觉 Transformer 与现代化 ConvNet 在 ImageNet 分类上的精度对比是否可归因于架构本身｜可比性=not_comparable
  - 涉及：p_arxiv_2103.14030、p_arxiv_2201.03545
  - 说明：系统判定两篇论文当前不能直接比较，且预训练权重来源、训练超参与评估协议、指标集合与数据集范围均存在差异。因此即使两者都报告 ImageNet top-1 accuracy，也无法排除条件差异的影响，不能将精度差异归因于 Swin 的移位窗口层级设计或 ConvNeXt 的现代化 ConvNet 设计本身。
  - 条件差异：预训练模型(Swin 部分模型使用 ImageNet-22K 预训练权重（如 Swin-L 384），其余初始化来源未在片段中说明；ConvNeXt 的 ImageNet-1K 模型从头训练，部分模型使用 ImageNet-22K 预训练权重。)；实验设置(Swin 的 ImageNet 分类 fine-tuning/评估协议细节未在片段中给出，吞吐量在 V100 GPU 上测量；ConvNeXt 为 ImageNet-1K 从头训练 300 epochs、AdamW、batch size 4096、cosine decay、warmup 20 epochs，微调 30 epochs、batch size 512、layer-wise lr decay。)；评价指标(Swin 报告 top-1 accuracy、top-5 accuracy、box AP、mask AP、mIoU；ConvNeXt 报告 top-1 accuracy、AP_box、AP_box_50、AP_box_75、AP_mask、AP_mask_50、AP_mask_75、mIoU、mCE、corruption error。)；数据集(Swin 使用 ImageNet-1K、COCO、ADE20K；ConvNeXt 额外使用 ImageNet-A、ImageNet-R、ImageNet-Sketch、ImageNet-C、ImageNet-C̄ 等鲁棒性数据集。)
  - 下一步：核查 Swin 与 ConvNeXt 在相同预训练设置（均从头训练或均使用 ImageNet-22K）与相同训练轮数下的 ImageNet-1K top-1 accuracy，再进行对齐比较。

### 已检查的论文对

- Training data-efficient image transformers & distillation through attention ↔ Swin Transformer: Hierarchical Vision Transformer using Shifted Windows：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练语料、预训练模型、实验设置
- Training data-efficient image transformers & distillation through attention ↔ A ConvNet for the 2020s：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练语料、数据增强、预训练模型、实验设置
- Swin Transformer: Hierarchical Vision Transformer using Shifted Windows ↔ A ConvNet for the 2020s：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练语料、预训练模型、实验设置

## 不可比检测矩阵（规则计算）

总体结论：**当前不能直接比较** —— 以下条件不一致，不能直接比较：数据集、预训练语料；以下条件存在差异，只能有限比较：评价指标、预训练模型、实验设置；以下条件信息不足，无法判断：数据划分、下游额外训练数据、数据增强。

| 条件维度 | 结论 | 具体差异 |
| --- | --- | --- |
| 数据集 | 当前不能直接比较 | Training data-efficient image transformers & distillation through attention（ImageNet、ImageNet Real、ImageNet V2、CIFAR-10、CIFAR-100、Flowers-102、Stanford Cars、iNaturalist 2018、iNaturalist 2019）与 Swin Transformer: Hierarchical Vision Transformer using Shifted Windows（ImageNet-1K、COCO、ADE20K）没有共同项；Traini |
| 数据划分 | 信息不足，无法判断 | — |
| 评价指标 | 只能有限比较 | Training data-efficient image transformers & distillation through attention（top-1 accuracy、throughput (images/s)）与 Swin Transformer: Hierarchical Vision Transformer using Shifted Windows（top-1 accuracy、top-5 accuracy、box AP、mask AP、mIoU）仅共有：top-1 accuracy；Training data-efficient image transformers & |
| 预训练语料 | 当前不能直接比较 | Training data-efficient image transformers & distillation through attention（none（不使用外部预训练数据，仅用 ImageNet 训练））与 Swin Transformer: Hierarchical Vision Transformer using Shifted Windows（ImageNet-22K（用于部分模型预训练，规模未在片段中给出））没有共同项；Training data-efficient image transformers & distillation through attention（no |
| 下游额外训练数据 | 信息不足，无法判断 | — |
| 数据增强 | 信息不足，无法判断 | — |
| 预训练模型 | 只能有限比较 | Training data-efficient image transformers & distillation through attention（none（从头训练，不使用外部预训练权重））↔ Swin Transformer: Hierarchical Vision Transformer using Shifted Windows（部分模型使用 ImageNet-22K 预训练权重（如 Swin-L 384 行位于 ImageNet-22K pre-trained models 分组）；其余初始化来源未在片段中说明）；Training data-efficient image tra |
| 实验设置 | 只能有限比较 | Training data-efficient image transformers & distillation through attention：从头训练 + fine-tuning：默认 224×224 训练，384×384 微调；AdamW，余弦学习率衰减，300 epochs（部分 1000 epochs）、知识蒸馏： ↔ Swin Transformer: Hierarchical Vision Transformer using Shifted Windows：ImageNet 分类：在 ImageNet-1K 上评估 top-1/top-5，吞吐量在 V100 GPU 上测量 |
| 算力/训练时长 | 信息不足，无法判断 | — |

### 各论文条件取值

- Training data-efficient image transformers & distillation through attention
  - datasets：ImageNet、ImageNet Real、ImageNet V2、CIFAR-10、CIFAR-100、Flowers-102、Stanford Cars、iNaturalist 2018、iNaturalist 2019（verified，Table 6 列出 ImageNet、iNaturalist 2018、iNaturalist 2019、Flowers-102、Stanford Cars、CIFAR-100、CIFAR-10；Table 5 另含 ImageNet Real 与 ImageNet V2。）
  - dataSplits：ImageNet：train 1,281,167 / test 50,000，1000 类、iNaturalist 2018：train 437,513 / test 24,426，8,142 类、iNaturalist 2019：train 265,240 / test 3,003，1,010 类、Flowers-1（verified，Table 6 给出各数据集的 train/test 规模与类别数。）
  - metrics：top-1 accuracy、throughput (images/s)（verified）
  - pretrainingCorpus：none（不使用外部预训练数据，仅用 ImageNet 训练）（verified，论文强调不使用外部数据。）
  - downstreamExtraData：none（verified）
  - dataAugmentation：Rand-Augment、Mixup、CutMix、random erasing、repeated augmentation、stochastic depth（verified，Table 9 列出 Rand Augment 9/0.5、Mixup 0.8、Cutmix 1.0、Erasing 0.25、Stoch. Depth 0.1、Repeated Aug 3。）
  - pretrainedModel：none（从头训练，不使用外部预训练权重）（verified，论文强调仅用 ImageNet 训练，无外部数据。）
  - experimentalSettings：从头训练 + fine-tuning：默认 224×224 训练，384×384 微调；AdamW，余弦学习率衰减，300 epochs（部分 1000 epochs）、知识蒸馏：hard/soft distillation，教师为 RegNetY-16GF convnet，τ=3.0，λ=0.1（soft）、迁移学习（verified，评估协议包含从头训练、fine-tuning 与知识蒸馏。）
  - computeResources：DeiT-B 300 epochs：2 节点 37 小时，或单节点 53 小时、DeiT-S 与 DeiT-Ti：4 GPU 训练少于 3 天、384×384 微调：单节点 8 GPU 20 小时（25 epochs）（verified，原文未明确 GPU 型号与节点 GPU 数（除微调为 8 GPU）。）
- Swin Transformer: Hierarchical Vision Transformer using Shifted Windows
  - datasets：ImageNet-1K、COCO、ADE20K（verified）
  - dataSplits：COCO：118K training, 5K validation and 20K test-dev images、ADE20K：25K images in total, with 20K for training, 2K for validation, and another 3K for testing（verified，ADE20K 划分来自另一句：It has 25K images in total, with 20K for training, 2K for validation, and another 3K for testing.）
  - metrics：top-1 accuracy、top-5 accuracy、box AP、mask AP、mIoU（verified，该引文来自 Table 4 的表头，列出 top-1/top-5/AP box/AP mask/mIoU。）
  - pretrainingCorpus：ImageNet-22K（用于部分模型预训练，规模未在片段中给出）（verified，片段中仅出现 ImageNet-22K 预训练模型分组标题，未给出语料规模。）
  - downstreamExtraData：none（unclear，该句仅说明对比对象 Copy-paste 未使用外部数据，不能支持本文所有实验均未使用额外数据的论文级结论。）
  - dataAugmentation：未知（unverified，本次提供的片段中未找到数据增强的描述。）
  - pretrainedModel：部分模型使用 ImageNet-22K 预训练权重（如 Swin-L 384 行位于 ImageNet-22K pre-trained models 分组）；其余初始化来源未在片段中说明（verified）
  - experimentalSettings：ImageNet 分类：在 ImageNet-1K 上评估 top-1/top-5，吞吐量在 V100 GPU 上测量（fine-tuning/评估协议细节未在片段中给出）、COCO 目标检测与实例分割：在 COCO 2017 上训练与评估，通过替换骨干网络、其他设置不变进行对比（fine-tuning）、ADE20K（verified，ADE20K 框架来自：We utilize UperNet [69] in mmseg [16] as our base framework for its high efficiency.）
  - computeResources：V100 GPU（用于吞吐量测量）（verified，片段中未给出训练/预训练所用硬件与时长。）
- A ConvNet for the 2020s
  - datasets：ImageNet-1K、COCO、ADE20K、ImageNet-A、ImageNet-R、ImageNet-Sketch、ImageNet-C、ImageNet-C̄（verified，COCO 与 ADE20K 见 Table 3 与 Table 7。）
  - dataSplits：ImageNet-1K：训练/评估划分未在片段中明确说明、COCO：训练/评估划分未在片段中明确说明、ADE20K：报告 validation mIoU（unclear，片段仅明确 ADE20K 使用 validation，其余划分未说明。）
  - metrics：top-1 accuracy、AP_box、AP_box_50、AP_box_75、AP_mask、AP_mask_50、AP_mask_75、mIoU、mCE、corruption error（verified，AP 与 mIoU 见 Table 3、Table 7。）
  - pretrainingCorpus：ImageNet-22K（用于部分 ConvNeXt 模型的预训练）（verified，片段未给出 ImageNet-22K 的规模细节。）
  - downstreamExtraData：none（unclear，该引文只说明鲁棒性评估未做额外微调，不能支持整篇论文级结论。）
  - dataAugmentation：Mixup、Cutmix、RandAugment、Random Erasing、Stochastic Depth、Label Smoothing（verified，微调阶段设置见 Table 6，其中 mixup/cutmix 为 None。）
  - pretrainedModel：none（ImageNet-1K 从头训练）、ImageNet-22K 预训练权重（用于部分模型）（verified，片段未给出预训练权重的具体来源细节。）
  - experimentalSettings：ImageNet-1K 分类：从头训练 300 epochs，AdamW，batch size 4096，cosine decay，warmup 20 epochs、ImageNet-1K 微调：30 epochs，AdamW，batch size 512，cosine decay，layer-wise lr deca（verified，分类训练/微调设置来自 Table 5 与 Table 6。）
  - computeResources：未知（unverified，片段未给出训练时长或 GPU 数量等算力信息。）

## 示例决策（演示用用户条件）

- 用户条件：{"background":"刚进入视觉方向的研究生/高年级本科生，学过深度学习基础课程，读过 CNN 与注意力机制的基本材料，但还没有系统做过视觉实验","interest":"想搞清楚 ImageNet 分类上这些方法到底能不能直接比准确率，以及自己应该先读哪几篇","time":"一学期，每周约 10 小时","compute":"实验室有 4 张 RTX 3090，可做小规模微调；没有大规模预训练资源","goal":"为课程/开题做一份「图像分类方法演进」的调研，需要判断哪些结果可比、哪些不能直接比"}
- 候选 p_arxiv_2012.12877：fit=conditional，算力已报告=true
  - [paper] 用户目标是判断 ImageNet 分类结果是否可直接比准确率，DeiT 明确报告了 ImageNet 上的 top-1 accuracy 与 throughput，并给出从头训练与 384×384 微调两套设置，适合作为「同数据集、同指标、不同训练配置」可比性讨论的样本。
  - [paper] DeiT 的算力条目明确标注阶段为 from_scratch：DeiT-B 300 epochs 为 2 节点 37 小时或单节点 53 小时，DeiT-S/Ti 为 4 GPU 训练少于 3 天；用户实验室 4 张 RTX 3090 与「4 GPU」数量一致，但材料未给出显存、并行策略与训练配置，因此只能作为「同阶段算力条目存在」的证据，不能据此断言用户资源已满足。
  - [paper] DeiT 的 384×384 微调算力条目为单节点 8 GPU 20 小时（25 epochs），属于微调阶段；用户只有 4 张 RTX 3090，且材料未说明该微调配置能否在 4 GPU 上缩放，因此微调阶段可行性未验证。
  - [paper] 论文自述在 CIFAR-10 上仅用自身数据训练不如 ImageNet 预训练（98.5% vs 99.1%），说明「是否使用预训练」会直接改变可比性，这正是用户调研中需要区分的条件维度。
  - 缺失信息：材料未给出 DeiT 训练所需显存、并行策略与完整训练配置，无法确认 4 张 RTX 3090 能否复现 from_scratch 训练；材料未给出 384×384 微调在 4 GPU 上的可缩放实现证据，微调阶段可行性未验证
- 候选 p_arxiv_2103.14030：fit=conditional，算力已报告=true
  - [paper] Swin Transformer 在 ImageNet-1K 上报告 top-1/top-5 accuracy，并给出 V100 上的吞吐量测量，属于推理阶段；这为用户比较「准确率与吞吐量是否在同一测量条件下可比」提供了明确条目。
  - [paper] 算力条目仅覆盖推理阶段（V100 用于 Table 1 吞吐量测量），材料未报告 Swin 从头训练或微调的算力与训练时长，因此不能把该推理条目用于判断用户能否训练或微调 Swin。
  - [paper] 作者指出实现使用未充分优化的 PyTorch 内置函数，推理速度受限于未做彻底的 kernel 优化，这提示吞吐量数字受实现条件影响，直接跨方法比吞吐量需要谨慎。
  - [gap] 材料中 ImageNet 分类的 fine-tuning/评估协议细节未给出，因此无法确认其准确率与其它方法是否在同一训练/评估协议下取得，可比性判断缺少关键条件。
  - 缺失信息：材料未给出 ImageNet 分类的 fine-tuning/评估协议细节；材料未报告 Swin 从头训练或微调的算力与训练时长，无法确认可运行性
- 候选 p_arxiv_2201.03545：fit=unknown，算力已报告=false
  - [paper] ConvNeXt 明确以「FLOPs 大致受控」为前提逐步引入设计并比较精度，直接对应用户「哪些结果可比」的问题：比较精度时必须同时看 FLOPs 等条件。
  - [paper] ConvNeXt 报告 ImageNet-1K 从头训练 300 epochs、AdamW、batch size 4096 等设置，说明其精度数字绑定在特定训练配置上，跨方法比准确率需核对配置是否一致。
  - [gap] 算力条目状态为 unverified、阶段未说明、适用范围未说明，因此无法判断用户 4 张 RTX 3090 能否支撑其任何阶段的训练或微调，可行性未验证。
  - [gap] 论文在附录中声明会讨论 limitations（§F），但提供的片段未包含该节内容，因此无法引用其自述的适用边界。
  - 缺失信息：算力条目未说明阶段与适用范围，无法确认任何阶段的资源需求；论文未报告可核验的算力与训练时长，无法确认可运行性；提供的片段未包含 limitations 节内容
- 1. p_arxiv_2012.12877｜paper：该论文同时给出同阶段（from_scratch）算力条目与明确的训练/微调设置，最适合作为用户理解「训练配置如何影响可比性」的第一篇。
- 2. p_arxiv_2103.14030｜paper：在理解 DeiT 的训练配置后，再看 Swin 的推理阶段吞吐量条目，可以对比「准确率可比」与「吞吐量可比」是两类不同条件。
- 3. p_arxiv_2201.03545｜gap：该论文的算力条目未验证且阶段未说明，放在最后读，用于补充「控制 FLOPs 再比精度」这一可比性维度，但不作为资源可行性依据。
- 条件敏感性：如果用户把目标从「调研可比性」改为「亲手复现训练」，则因材料只给出 DeiT 的 from_scratch 算力条目、Swin 仅推理条目、ConvNeXt 算力未验证，推荐会整体转为以 DeiT 为唯一有条件候选并需先补齐显存与并行策略信息；若用户只做推理对比，则 Swin 的推理条目相关性会上升。