# 离线分析报告（真实模型）

- 生成时间：2026/9/18 17:53:01
- 模型：deepseek-chat（api.deepseek.com）
- 提示词版本：v3.0.0
- 领域标注：图像分类中 CNN 与视觉 Transformer 的方法演进与实验比较（已确认=true）

## 字段抽取与证据校验

| 论文 | 年份 | 有值字段 | 可核验 | 待人工核对 | 未找到证据 | 缺失 |
| --- | --- | --- | --- | --- | --- | --- |
| Deep Residual Learning for Image Recognition | 2015 | 7/7 | 6 | 0 | 1 | 0 |
| AN IMAGE IS WORTH 16X16 WORDS: TRANSFORMERS FOR IMAGE RECOGNITION AT SCALE | 2020 | 7/7 | 7 | 0 | 0 | 0 |
| Training data-efficient image transformers & distillation through attention | 2020 | 7/7 | 7 | 0 | 0 | 0 |
| Swin Transformer: Hierarchical Vision Transformer using Shifted Windows | 2021 | 7/7 | 7 | 0 | 0 | 0 |
| A ConvNet for the 2020s | 2022 | 7/7 | 7 | 0 | 0 | 0 |

## 实验条件（不可比检测依据）

| 论文 | 维度 | 取值 | 状态 |
| --- | --- | --- | --- |
| Deep Residual Learning for Image R | datasets | ImageNet 2012 classification dataset、CIFAR-10、COCO、PASCAL VOC 2007、PASCAL VOC 2012、ImageNet detection (DET)、ImageNet localization (LOC) | verified |
| Deep Residual Learning for Image R | dataSplits | ImageNet 2012 classification：1.28M 训练图像 / 50k 验证图像 / 100k 测试图像（测试结果由测试服务器报告）、CIFAR-10：50k 训练图像 / 10k 测试图像，训练于训练集、评估于测试集、ImageNet DET：验证集按 [8] 分为 val1/val2，用 DET 训练集与 val1 微调，val2 用于验证 | verified |
| Deep Residual Learning for Image R | metrics | top-1 error rate、top-5 error rate、classification error、mAP@.5、mAP、localization error | verified |
| Deep Residual Learning for Image R | pretrainingCorpus | none | unverified |
| Deep Residual Learning for Image R | downstreamExtraData | none | verified |
| Deep Residual Learning for Image R | dataAugmentation | CIFAR-10：4 像素填充后随机采样 32×32 裁剪或其水平翻转；测试时仅评估原始 32×32 图像的单视图、ImageNet localization：随机采样 224×224 裁剪 | verified |
| Deep Residual Learning for Image R | pretrainedModel | none（ImageNet 分类与 CIFAR-10 为从头训练）、ImageNet 1000-class classification set 预训练后微调（用于 DET 与 LOC） | verified |
| Deep Residual Learning for Image R | experimentalSettings | ImageNet 分类：从头训练，评估 top-1/top-5 错误率，10-crop testing（Table 3）与 single-model（Table 4）、CIFAR-10：从头训练，weight decay 0.0001、momentum 0.9、BN、无 dropout，mini-batch 128、两块 GPU，初始学习率 0.1 并在 32k/48k 迭代除以 10，64k 迭代终止；测试时单视图、ImageNet DET：在 1000 类 ImageNet 分类集上预训练，在 DET 数据上微调，评估 mAP@.5、ImageNet LOC：在 ImageNet 分类上预训练后微调用于定位，评估 localization error | verified |
| Deep Residual Learning for Image R | computeResources | 两块 GPU，CIFAR-10 训练（mini-batch 128，64k 迭代） | verified |
| AN IMAGE IS WORTH 16X16 WORDS: TRA | datasets | ImageNet、ImageNet ReaL、CIFAR-10、CIFAR-100、Oxford-IIIT Pets、Oxford Flowers-102、VTAB (19 tasks) | verified |
| AN IMAGE IS WORTH 16X16 WORDS: TRA | dataSplits | ImageNet：original validation labels 与 cleaned-up ReaL labels、VTAB (19 tasks)：每任务 1000 个训练样本，分为 Natural/Specialized/Structured 三组 | verified |
| AN IMAGE IS WORTH 16X16 WORDS: TRA | metrics | few-shot accuracy、fine-tuning accuracy | verified |
| AN IMAGE IS WORTH 16X16 WORDS: TRA | pretrainingCorpus | ImageNet (1k classes, 1.3M images)、ImageNet-21k (21k classes, 14M images)、JFT (18k classes, 303M high-resolution images) | verified |
| AN IMAGE IS WORTH 16X16 WORDS: TRA | downstreamExtraData | none | unclear |
| AN IMAGE IS WORTH 16X16 WORDS: TRA | dataAugmentation | 未知 | unclear |
| AN IMAGE IS WORTH 16X16 WORDS: TRA | pretrainedModel | none（ViT 从头预训练）、ResNet (BiT) 基线使用 ResNet 替换 BatchNorm 为 GroupNorm 并标准化卷积 | verified |
| AN IMAGE IS WORTH 16X16 WORDS: TRA | experimentalSettings | fine-tuning：预训练后移除预训练预测头，接零初始化 D×K 前馈层，微调至下游任务；可在更高分辨率微调并 2D 插值位置嵌入、few-shot：用正则化最小二乘回归将冻结表示映射到 {-1,1}^K 目标向量、从头训练：自监督预训练对比从头训练 | verified |
| AN IMAGE IS WORTH 16X16 WORDS: TRA | computeResources | TPUv3-core-days：ViT-H/14 2.5k，ViT-L/16 0.68k，ViT-L/16 (I21k) 0.23k，BiT-L 9.9k，Noisy Student 12.3k、ViT-L/16 在 ImageNet-21k 上可用标准云 TPUv3 8 核约 30 天训练 | verified |
| Training data-efficient image tran | datasets | ImageNet、ImageNet Real、ImageNet V2 matched frequency、CIFAR-10、CIFAR-100、Flowers-102、Stanford Cars、iNaturalist 2018、iNaturalist 2019 | verified |
| Training data-efficient image tran | dataSplits | ImageNet：train 1,281,167 / test 50,000，1000 类、iNaturalist 2018：train 437,513 / test 24,426，8,142 类、iNaturalist 2019：train 265,240 / test 3,003，1,010 类、Flowers-102：train 2,040 / test 6,149，102 类、Stanford Cars：train 8,144 / test 8,041，196 类、CIFAR-100：train 50,000 / test 10,000，100 类、CIFAR-10：train 50,000 / test 10,000，10 类 | verified |
| Training data-efficient image tran | metrics | top-1 accuracy、image throughput (image/s) | verified |
| Training data-efficient image tran | pretrainingCorpus | none（不使用外部预训练数据，仅在 ImageNet 上训练） | verified |
| Training data-efficient image tran | downstreamExtraData | none | verified |
| Training data-efficient image tran | dataAugmentation | Rand-Augment、Mixup、Cutmix、random erasing、repeated augmentation、stochastic depth、Auto-Augment（被评估但最终未采用） | verified |
| Training data-efficient image tran | pretrainedModel | none（从头训练，不使用外部预训练权重） | verified |
| Training data-efficient image tran | experimentalSettings | fine-tuning：在 ImageNet 上训练 300 epochs，随后在 384×384 分辨率微调（约 25 epochs）、知识蒸馏：使用硬蒸馏（hard distillation），教师为 RegNetY-16GF，蒸馏 token 参与注意力、从头训练：DeiT 在 ImageNet-1k 上从头训练，无外部数据 | verified |
| Training data-efficient image tran | computeResources | DeiT-B 训练 300 epochs：2 节点 37 小时，或单节点 53 小时、DeiT-S 与 DeiT-Ti：4 GPU 上少于 3 天、384×384 微调：单节点 8 GPU 20 小时（25 epochs） | verified |
| Swin Transformer: Hierarchical Vis | datasets | ImageNet-1K、ImageNet-22K、COCO、ADE20K | verified |
| Swin Transformer: Hierarchical Vis | dataSplits | COCO：118K training, 5K validation and 20K test-dev images、ADE20K：25K images in total, with 20K for training, 2K for validation, and another 3K for testing | verified |
| Swin Transformer: Hierarchical Vis | metrics | top-1 accuracy、top-5 accuracy、box AP、mask AP、mIoU | verified |
| Swin Transformer: Hierarchical Vis | pretrainingCorpus | ImageNet-22K（表 1(b) 标题为 “(b) ImageNet-22K pre-trained models”，规模未在片段中给出） | verified |
| Swin Transformer: Hierarchical Vis | downstreamExtraData | none | unclear |
| Swin Transformer: Hierarchical Vis | dataAugmentation | 未知 | unverified |
| Swin Transformer: Hierarchical Vis | pretrainedModel | none（Swin-T/S/B 在 ImageNet-1K 上从头训练，片段未明确说明初始化来源）、ImageNet-22K 预训练权重（Swin-B/Swin-L 用于 ImageNet-1K 分类与 ADE20K 分割） | unclear |
| Swin Transformer: Hierarchical Vis | experimentalSettings | ImageNet-1K 分类：fine-tuning/从头训练（片段未明确），评估协议未在片段中说明、COCO 目标检测与实例分割：在 COCO 2017 上训练与评估，对比时只更换 backbone，其他设置不变、ADE20K 语义分割：以 UperNet [69] in mmseg [16] 为 base framework | unclear |
| Swin Transformer: Hierarchical Vis | computeResources | V100 GPU（用于吞吐量测量，具体数量与时长未给出） | verified |
| A ConvNet for the 2020s | datasets | ImageNet-1K、ImageNet-22K、COCO、ADE20K、ImageNet-A、ImageNet-R、ImageNet-Sketch、ImageNet-C、ImageNet-C̄ | verified |
| A ConvNet for the 2020s | dataSplits | ADE20K：validation（报告 validation mIoU）、COCO：未说明具体划分、ImageNet-1K：未说明具体划分 | verified |
| A ConvNet for the 2020s | metrics | top-1 accuracy、mCE、corruption error、mIoU、AP_box、AP_box_50、AP_box_75、AP_mask、AP_mask_50、AP_mask_75 | verified |
| A ConvNet for the 2020s | pretrainingCorpus | ImageNet-1K、ImageNet-22K | verified |
| A ConvNet for the 2020s | downstreamExtraData | none | unclear |
| A ConvNet for the 2020s | dataAugmentation | Mixup、Cutmix、RandAugment、Random Erasing、Stochastic Depth、Label Smoothing | verified |
| A ConvNet for the 2020s | pretrainedModel | none（ImageNet-1K trained models 从头训练）、ImageNet-22K 预训练权重（ImageNet-22K pre-trained models） | verified |
| A ConvNet for the 2020s | experimentalSettings | 分类：从头训练（ImageNet-1K，300 epochs）或 ImageNet-22K 预训练后 ImageNet-1K 微调（30 epochs，384^2）、检测/分割：在 COCO/ADE20K 上微调（fine-tuning），Mask R-CNN / Cascade Mask R-CNN，3× schedule、鲁棒性：直接评估，无额外微调 | verified |
| A ConvNet for the 2020s | computeResources | 未知 | unverified |

## 程序校验问题

- [warn] p_arxiv_1512.03385 limitations evidence_missing：局限：模型给出了内容但没有提供任何原文引文，标记为「未找到证据」。
- [warn] p_arxiv_1512.03385 pretrainingCorpus evidence_not_located：预训练语料：有内容但引文未通过定位校验或未支撑该主张。
- [warn] p_arxiv_2010.11929 downstreamExtraData condition_unconfirmed：下游额外训练数据：无法确认（表述含糊）。
- [warn] p_arxiv_2010.11929 dataAugmentation condition_unconfirmed：数据增强：无法确认（表述含糊）。
- [warn] p_arxiv_2012.12877  title_unverified：标题未确认：当前标题「understanding tasks, as initially demonstrated on image clas…」取自 PDF 首页文本，看起来不是论文标题。
- [warn] p_arxiv_2103.14030  title_unverified：标题未确认：当前标题「on ImageNet-1K) and dense prediction tasks such as object de…」取自 PDF 首页文本，看起来不是论文标题。
- [warn] p_arxiv_2103.14030 downstreamExtraData condition_unconfirmed：下游额外训练数据：无法确认（表述含糊）。
- [warn] p_arxiv_2103.14030 dataAugmentation evidence_not_located：数据增强：有内容但引文未通过定位校验或未支撑该主张。
- [warn] p_arxiv_2103.14030 pretrainedModel condition_unconfirmed：预训练模型：无法确认（表述含糊）。
- [warn] p_arxiv_2103.14030 experimentalSettings condition_unconfirmed：实验设置：无法确认（表述含糊）。
- [warn] p_arxiv_2201.03545 downstreamExtraData condition_unconfirmed：下游额外训练数据：无法确认（表述含糊）。
- [warn] p_arxiv_2201.03545 computeResources evidence_not_located：算力/训练时长：有内容但引文未通过定位校验或未支撑该主张。

## 方法关系

- Deep Residual Learning for Image Recognition → AN IMAGE IS WORTH 16X16 WORDS: TRANSFORMERS FOR IMAGE RECOGNITION AT SCALE：unclear（系统推断）
  - 依据：检索到的句子只表明 ViT 在 JFT-300M 预训练后优于 ResNet-based baselines（性能对比），并未说明 ViT 基于或改进 ResNet。ViT 的核心是标准 Transformer 直接作用于图像 patch，与残差学习框架无继承关系。ResNet 在 ViT 论文中仅作为对比基线出现，不足以认证方法继承关系，故标为 candidate。
- Deep Residual Learning for Image Recognition → Training data-efficient image transformers & distillation through attention：unclear（系统推断）
  - 依据：检索到的 DeiT 片段仅提到 DeiT-S 和 DeiT-Ti 可视为 ResNet-50 和 ResNet-18 的对应物（counterpart），这是参数量/规模上的类比，并非方法继承或改进。DeiT 基于 ViT 与蒸馏 token，与残差学习框架无直接继承关系。故标为 candidate。
- Deep Residual Learning for Image Recognition → Swin Transformer: Hierarchical Vision Transformer using Shifted Windows：unclear（系统推断）
  - 依据：Swin Transformer 论文中 ResNet 仅作为 CNN 架构发展史中的一员被列举（e.g., VGG, GoogleNet, ResNet, DenseNet...），并未说明 Swin 基于或改进 ResNet。Swin 明确 adapted from the standard Transformer，与残差学习框架无继承关系。故标为 candidate。
- Deep Residual Learning for Image Recognition → A ConvNet for the 2020s：extends（待核查）
  - 依据：Our starting point is a ResNet-50 model. We first train it with similar training techniques used to train vision Transformers and obtain much improved results compared to the original ResNet-50. This will be our baseline
  - 状态调整：explicit → candidate（证据不足以认证该具体关系。引文提到了被继承方法「ResNet」。缺少继承/组合措辞或引用标记。）
- AN IMAGE IS WORTH 16X16 WORDS: TRANSFORMERS FOR IMAGE RECOGNITION AT SCALE → Training data-efficient image transformers & distillation through attention：extends（系统推断）
  - 依据：DeiT 论文明确以 ViT 为参考视觉 Transformer（reference vision transformer），并在此基础上引入蒸馏 token 与数据高效训练策略。检索片段未直接出现指名 ViT 的继承措辞，但 DeiT 的核心架构与训练流程承接自 ViT，属于技术承接关系，故标为 inferred。
- AN IMAGE IS WORTH 16X16 WORDS: TRANSFORMERS FOR IMAGE RECOGNITION AT SCALE → Swin Transformer: Hierarchical Vision Transformer using Shifted Windows：extends（系统推断）
  - 依据：Swin Transformer 明确 adapted from the standard Transformer，并针对 ViT 类架构单分辨率、二次复杂度的问题提出层级式与移位窗口设计。检索片段未直接指名 ViT 并给出继承措辞，但技术承接关系清晰，故标为 inferred。
- AN IMAGE IS WORTH 16X16 WORDS: TRANSFORMERS FOR IMAGE RECOGNITION AT SCALE → A ConvNet for the 2020s：unclear（系统推断）
  - 依据：ConvNeXt 论文提到使用训练视觉 Transformer 的技巧，但检索片段未指名 ViT 并给出继承措辞。ConvNeXt 的宏观设计主要借鉴 Swin Transformer，与 ViT 的直接继承关系不明确，故标为 candidate。
- Training data-efficient image transformers & distillation through attention → Swin Transformer: Hierarchical Vision Transformer using Shifted Windows：unclear（系统推断）
  - 依据：检索片段中未出现 DeiT 与 Swin Transformer 之间的直接继承或改进措辞。两者均为视觉 Transformer 变体，但无明确证据表明 Swin 基于或改进 DeiT，故标为 candidate。
- Training data-efficient image transformers & distillation through attention → A ConvNet for the 2020s：unclear（系统推断）
  - 依据：检索片段中未出现 DeiT 与 ConvNeXt 之间的直接继承或改进措辞。ConvNeXt 主要借鉴 Swin Transformer 的设计，与 DeiT 的关系不明确，故标为 candidate。
- Swin Transformer: Hierarchical Vision Transformer using Shifted Windows → A ConvNet for the 2020s：extends（待核查）
  - 依据：model, named ConvNeXt, can outperform the Swin Transformer.
  - 状态调整：explicit → candidate（证据不足以认证该具体关系。引文提到了被继承方法「Swin Transformer」；提到了关系另一端「ConvNeXt」。缺少继承/组合措辞或引用标记。）
- [warn] 关系问题 relation_downgraded：Deep Residual Learning for Ima → A ConvNet for the 2020s（继承/基于）：可信度由「原文明示」调整为「待核查」。证据不足以认证该具体关系。引文提到了被继承方法「ResNet」。缺少继承/组合措辞或引用标记。
- [warn] 关系问题 relation_downgraded：Swin Transformer: Hierarchical → A ConvNet for the 2020s（继承/基于）：可信度由「原文明示」调整为「待核查」。证据不足以认证该具体关系。引文提到了被继承方法「Swin Transformer」；提到了关系另一端「ConvNeXt」。缺少继承/组合措辞或引用标记。

## 跨论文分歧发现

- [condition_confounded] ViT 与 ResNet 在小数据集上的过拟合倾向对比｜可比性=not_comparable
  - 涉及：p_arxiv_2010.11929、p_arxiv_1512.03385
  - 说明：ViT 论文明确声称在较小数据集上比同等计算量的 ResNet 更容易过拟合，但双方的数据集、评价指标与实验设置均不一致，系统判定为当前不能直接比较。因此无法排除条件差异的影响，也不能将该差异归因于架构本身。
  - 条件差异：数据集(ViT 使用 ImageNet、ImageNet ReaL、CIFAR-10、CIFAR-100、Oxford-IIIT Pets、Oxford Flowers-102、VTAB；ResNet 使用 ImageNet 2012、CIFAR-10、COCO、PASCAL VOC 等)；评价指标(ViT 报告 few-shot accuracy、fine-tuning accuracy；ResNet 报告 top-1/top-5 error rate、classification error、mAP 等)；实验设置(ViT 的过拟合观察基于其自身预训练/微调流程；ResNet 的 CIFAR-10 训练使用 weight decay 0.0001、momentum 0.9、BN、无 dropout、mini-batch 128、特定学习率调度)
  - 下一步：核查在完全相同的数据集划分、训练轮数、数据增强与正则化设置下，ViT 与 ResNet 的过拟合程度是否仍有差异。
- [individual_limitations] 各论文自述的局限｜可比性=not_comparable
  - 涉及：p_arxiv_2010.11929、p_arxiv_2012.12877、p_arxiv_2103.14030、p_arxiv_2201.03545
  - 说明：各论文自述的局限分别针对不同对象（ViT 的小数据集过拟合、DeiT 的 CIFAR-10 训练多样性、Swin 的推理速度实现、ConvNeXt 的未提供局限章节），不构成同一对象/任务/约束下的共同局限，因此分别列出。
  - 下一步：分别核查各论文局限的具体适用条件与影响范围。

### 已检查的论文对

- Deep Residual Learning for Image Recognition ↔ AN IMAGE IS WORTH 16X16 WORDS: TRANSFORMERS FOR IMAGE RECOGNITION AT SCALE：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练模型、实验设置
- Deep Residual Learning for Image Recognition ↔ Training data-efficient image transformers & distillation through attention：可比性=当前不能直接比较；条件差异：数据集、数据划分、评价指标、预训练模型、实验设置
- Deep Residual Learning for Image Recognition ↔ Swin Transformer: Hierarchical Vision Transformer using Shifted Windows：可比性=当前不能直接比较；条件差异：数据集、评价指标
- Deep Residual Learning for Image Recognition ↔ A ConvNet for the 2020s：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练模型
- AN IMAGE IS WORTH 16X16 WORDS: TRANSFORMERS FOR IMAGE RECOGNITION AT SCALE ↔ Training data-efficient image transformers & distillation through attention：可比性=当前不能直接比较；条件差异：数据集、数据划分、评价指标、预训练语料、预训练模型、实验设置
- AN IMAGE IS WORTH 16X16 WORDS: TRANSFORMERS FOR IMAGE RECOGNITION AT SCALE ↔ Swin Transformer: Hierarchical Vision Transformer using Shifted Windows：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练语料
- AN IMAGE IS WORTH 16X16 WORDS: TRANSFORMERS FOR IMAGE RECOGNITION AT SCALE ↔ A ConvNet for the 2020s：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练语料、预训练模型、实验设置
- Training data-efficient image transformers & distillation through attention ↔ Swin Transformer: Hierarchical Vision Transformer using Shifted Windows：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练语料
- Training data-efficient image transformers & distillation through attention ↔ A ConvNet for the 2020s：可比性=当前不能直接比较；条件差异：数据集、评价指标、预训练语料、预训练模型、实验设置
- Swin Transformer: Hierarchical Vision Transformer using Shifted Windows ↔ A ConvNet for the 2020s：可比性=当前不能直接比较；条件差异：数据集、数据划分、评价指标、预训练语料

## 不可比检测矩阵（规则计算）

总体结论：**当前不能直接比较** —— 以下条件不一致，不能直接比较：评价指标；以下条件存在差异，只能有限比较：数据集；以下条件信息不足，无法判断：数据划分、预训练语料、下游额外训练数据、数据增强、预训练模型、实验设置。

| 条件维度 | 结论 | 具体差异 |
| --- | --- | --- |
| 数据集 | 只能有限比较 | Deep Residual Learning for Image Recognition（ImageNet 2012 classification、CIFAR-10、COCO、PASCAL VOC 2007、PASCAL VOC 2012、ImageNet detection (DET)、ImageNet localization (LOC)）与 AN IMAGE IS WORTH 16X16 WORDS: TRANSFORMERS FOR IMAGE RECOGNITION AT SCALE（ImageNet、ImageNet ReaL、CIFAR-10、CIFAR-100、Oxford-I |
| 数据划分 | 信息不足，无法判断 | — |
| 评价指标 | 当前不能直接比较 | Deep Residual Learning for Image Recognition（top-1 error rate、top-5 error rate、classification error、mAP@.5、mAP、localization error）与 AN IMAGE IS WORTH 16X16 WORDS: TRANSFORMERS FOR IMAGE RECOGNITION AT SCALE（few-shot accuracy、fine-tuning accuracy）没有共同项；Deep Residual Learning for Image Recognition（top |
| 预训练语料 | 信息不足，无法判断 | — |
| 下游额外训练数据 | 信息不足，无法判断 | — |
| 数据增强 | 信息不足，无法判断 | — |
| 预训练模型 | 信息不足，无法判断 | — |
| 实验设置 | 信息不足，无法判断 | — |
| 算力/训练时长 | 信息不足，无法判断 | — |

### 各论文条件取值

- Deep Residual Learning for Image Recognition
  - datasets：ImageNet 2012 classification dataset、CIFAR-10、COCO、PASCAL VOC 2007、PASCAL VOC 2012、ImageNet detection (DET)、ImageNet localization (LOC)（verified，该引文来自 experiments 片段，无 [[p.N]] 标记。其他数据集在各自片段中出现。）
  - dataSplits：ImageNet 2012 classification：1.28M 训练图像 / 50k 验证图像 / 100k 测试图像（测试结果由测试服务器报告）、CIFAR-10：50k 训练图像 / 10k 测试图像，训练于训练集、评估于测试集、ImageNet DET：验证集按 [8] 分为 val1/val2，用 DET（verified，该引文来自 experiments 片段，无 [[p.N]] 标记。CIFAR-10 与 DET 划分来自其他片段。）
  - metrics：top-1 error rate、top-5 error rate、classification error、mAP@.5、mAP、localization error（verified，该引文来自 experiments 片段，无 [[p.N]] 标记。）
  - pretrainingCorpus：none（unverified，提供的片段中未出现关于预训练语料的描述；ImageNet 分类实验为从头训练，但片段中无明确整篇论文级的预训练语料说明。）
  - downstreamExtraData：none（verified，该引文来自 method 片段，无 [[p.N]] 标记。仅针对 DET 任务说明未使用其他 ILSVRC 2015 数据，不能推广为整篇论文结论。）
  - dataAugmentation：CIFAR-10：4 像素填充后随机采样 32×32 裁剪或其水平翻转；测试时仅评估原始 32×32 图像的单视图、ImageNet localization：随机采样 224×224 裁剪（verified，该引文位于 [[p.7]] 附近。ImageNet localization 的 224×224 随机裁剪来自另一段 method 片段。）
  - pretrainedModel：none（ImageNet 分类与 CIFAR-10 为从头训练）、ImageNet 1000-class classification set 预训练后微调（用于 DET 与 LOC）（verified，该引文来自 method 片段，无 [[p.N]] 标记。分类实验为从头训练，检测/定位使用分类预训练模型微调。）
  - experimentalSettings：ImageNet 分类：从头训练，评估 top-1/top-5 错误率，10-crop testing（Table 3）与 single-model（Table 4）、CIFAR-10：从头训练，weight decay 0.0001、momentum 0.9、BN、无 dropout，mini-batch 128、两（verified，该引文位于 [[p.7]] 附近，描述 CIFAR-10 训练设置。其他设置来自不同片段。）
  - computeResources：两块 GPU，CIFAR-10 训练（mini-batch 128，64k 迭代）（verified，该引文位于 [[p.7]] 附近。未给出具体 GPU 型号与训练时长。）
- AN IMAGE IS WORTH 16X16 WORDS: TRANSFORMERS FOR IMAGE RECOGNITION AT SCALE
  - datasets：ImageNet、ImageNet ReaL、CIFAR-10、CIFAR-100、Oxford-IIIT Pets、Oxford Flowers-102、VTAB (19 tasks)（verified）
  - dataSplits：ImageNet：original validation labels 与 cleaned-up ReaL labels、VTAB (19 tasks)：每任务 1000 个训练样本，分为 Natural/Specialized/Structured 三组（verified）
  - metrics：few-shot accuracy、fine-tuning accuracy（verified）
  - pretrainingCorpus：ImageNet (1k classes, 1.3M images)、ImageNet-21k (21k classes, 14M images)、JFT (18k classes, 303M high-resolution images)（verified）
  - downstreamExtraData：none（unclear，片段中未明确说明下游实验是否引入额外训练数据，仅提到去重。）
  - dataAugmentation：未知（unclear，原文只说预处理遵循 Kolesnikov et al. (2020)，未在本片段中列出具体数据增强。）
  - pretrainedModel：none（ViT 从头预训练）、ResNet (BiT) 基线使用 ResNet 替换 BatchNorm 为 GroupNorm 并标准化卷积（verified）
  - experimentalSettings：fine-tuning：预训练后移除预训练预测头，接零初始化 D×K 前馈层，微调至下游任务；可在更高分辨率微调并 2D 插值位置嵌入、few-shot：用正则化最小二乘回归将冻结表示映射到 {-1,1}^K 目标向量、从头训练：自监督预训练对比从头训练（verified）
  - computeResources：TPUv3-core-days：ViT-H/14 2.5k，ViT-L/16 0.68k，ViT-L/16 (I21k) 0.23k，BiT-L 9.9k，Noisy Student 12.3k、ViT-L/16 在 ImageNet-21k 上可用标准云 TPUv3 8 核约 30 天训练（verified）
- Training data-efficient image transformers & distillation through attention
  - datasets：ImageNet、ImageNet Real、ImageNet V2 matched frequency、CIFAR-10、CIFAR-100、Flowers-102、Stanford Cars、iNaturalist 2018、iNaturalist 2019（verified，Table 6 列出 ImageNet、iNaturalist 2018、iNaturalist 2019、Flowers-102、Stanford Cars、CIFAR-100、CIFAR-10；Table 5 另含 ImageNet Real 与 ImageNet V2 matched frequency。）
  - dataSplits：ImageNet：train 1,281,167 / test 50,000，1000 类、iNaturalist 2018：train 437,513 / test 24,426，8,142 类、iNaturalist 2019：train 265,240 / test 3,003，1,010 类、Flowers-1（verified，Table 6 给出各数据集的 Train size / Test size / #classes。）
  - metrics：top-1 accuracy、image throughput (image/s)（verified）
  - pretrainingCorpus：none（不使用外部预训练数据，仅在 ImageNet 上训练）（verified，论文强调不使用外部数据，因此无独立预训练语料。）
  - downstreamExtraData：none（verified）
  - dataAugmentation：Rand-Augment、Mixup、Cutmix、random erasing、repeated augmentation、stochastic depth、Auto-Augment（被评估但最终未采用）（verified，Table 9 列出 Rand Augment 9/0.5、Mixup prob. 0.8、Cutmix prob. 1.0、Erasing prob. 0.25、Stoch. Depth 0.1、Repeated Aug 3。）
  - pretrainedModel：none（从头训练，不使用外部预训练权重）（verified，论文强调不使用外部数据，模型在 ImageNet 上从头训练。）
  - experimentalSettings：fine-tuning：在 ImageNet 上训练 300 epochs，随后在 384×384 分辨率微调（约 25 epochs）、知识蒸馏：使用硬蒸馏（hard distillation），教师为 RegNetY-16GF，蒸馏 token 参与注意力、从头训练：DeiT 在 ImageNet-1k 上从头训练（verified，Table 9 给出默认超参数：AdamW、batch size 1024、cosine 衰减、warmup 5 epochs、label smoothing 0.1 等。）
  - computeResources：DeiT-B 训练 300 epochs：2 节点 37 小时，或单节点 53 小时、DeiT-S 与 DeiT-Ti：4 GPU 上少于 3 天、384×384 微调：单节点 8 GPU 20 小时（25 epochs）（verified，原文未明确 GPU 型号与节点内 GPU 数（除微调写 8 GPU）。）
- Swin Transformer: Hierarchical Vision Transformer using Shifted Windows
  - datasets：ImageNet-1K、ImageNet-22K、COCO、ADE20K（verified，ImageNet-22K 出现在表 1(b) 标题 “(b) ImageNet-22K pre-trained models”。）
  - dataSplits：COCO：118K training, 5K validation and 20K test-dev images、ADE20K：25K images in total, with 20K for training, 2K for validation, and another 3K for testing（verified，ADE20K 划分来自 “It has 25K images in total, with 20K for training, 2K for validation, and another 3K for testing.”；ImageNet-1K/22K 的划分未在片段中说明。）
  - metrics：top-1 accuracy、top-5 accuracy、box AP、mask AP、mIoU（verified，top-5 accuracy 出现在表 4 的 ImageNet top-5 列。）
  - pretrainingCorpus：ImageNet-22K（表 1(b) 标题为 “(b) ImageNet-22K pre-trained models”，规模未在片段中给出）（verified，片段中未给出 ImageNet-22K 的具体规模；表 3 脚注也提到 ‡ indicates that the model is pre-trained on ImageNet-22K。）
  - downstreamExtraData：none（unclear，该引文只说明对比对象 Copy-paste 未使用外部数据，不能支持整篇论文级「未使用额外数据」的结论。）
  - dataAugmentation：未知（unverified，本次提供的片段中未找到数据增强的描述。）
  - pretrainedModel：none（Swin-T/S/B 在 ImageNet-1K 上从头训练，片段未明确说明初始化来源）、ImageNet-22K 预训练权重（Swin-B/Swin-L 用于 ImageNet-1K 分类与 ADE20K 分割）（unclear，片段只给出表 1(b) 的 ImageNet-22K 预训练模型标题与表 3 脚注 “‡ indicates that the model is pre-trained on ImageNet-22K”，未明确说明表 1(a) 各行是否从头训练。）
  - experimentalSettings：ImageNet-1K 分类：fine-tuning/从头训练（片段未明确），评估协议未在片段中说明、COCO 目标检测与实例分割：在 COCO 2017 上训练与评估，对比时只更换 backbone，其他设置不变、ADE20K 语义分割：以 UperNet [69] in mmseg [16] 为 base fram（unclear，片段未明确写出分类实验的评估协议类型（fine-tuning / zero-shot / few-shot / 从头训练）。）
  - computeResources：V100 GPU（用于吞吐量测量，具体数量与时长未给出）（verified，片段未给出训练/预训练所用算力与时长。）
- A ConvNet for the 2020s
  - datasets：ImageNet-1K、ImageNet-22K、COCO、ADE20K、ImageNet-A、ImageNet-R、ImageNet-Sketch、ImageNet-C、ImageNet-C̄（verified，ImageNet-1K/22K 为分类（预）训练与评估；COCO/ADE20K 为下游任务；其余为鲁棒性评估。）
  - dataSplits：ADE20K：validation（报告 validation mIoU）、COCO：未说明具体划分、ImageNet-1K：未说明具体划分（verified，仅 ADE20K 明确提到 validation；COCO 与 ImageNet-1K 的划分在片段中未说明。）
  - metrics：top-1 accuracy、mCE、corruption error、mIoU、AP_box、AP_box_50、AP_box_75、AP_mask、AP_mask_50、AP_mask_75（verified，检测/分割指标 AP 与 mIoU 见 Table 3 与 Table 7。）
  - pretrainingCorpus：ImageNet-1K、ImageNet-22K（verified，原文使用 ImageNet-22K 作为大规模预训练数据（非 21K）。）
  - downstreamExtraData：none（unclear，该句仅说明鲁棒性评估未做额外微调，不能支持整篇论文级的「无额外数据」结论。）
  - dataAugmentation：Mixup、Cutmix、RandAugment、Random Erasing、Stochastic Depth、Label Smoothing（verified，微调阶段（Table 6）mixup/cutmix 为 None，仅保留 randaugment 与 random erasing。）
  - pretrainedModel：none（ImageNet-1K trained models 从头训练）、ImageNet-22K 预训练权重（ImageNet-22K pre-trained models）（verified，下游任务使用 ImageNet 预训练权重初始化；分类主结果分 ImageNet-1K 训练与 ImageNet-22K 预训练两类。）
  - experimentalSettings：分类：从头训练（ImageNet-1K，300 epochs）或 ImageNet-22K 预训练后 ImageNet-1K 微调（30 epochs，384^2）、检测/分割：在 COCO/ADE20K 上微调（fine-tuning），Mask R-CNN / Cascade Mask R-CNN，3× sched（verified，分类主结果协议为从头训练或预训练+微调；下游为 fine-tuning。）
  - computeResources：未知（unverified，片段中未给出训练硬件数量与时长；仅提到吞吐量在 V100/A100 GPU 上测量。）

## 示例决策（演示用用户条件）

- 用户条件：{"background":"刚进入视觉方向的研究生/高年级本科生，学过深度学习基础课程，读过 CNN 与注意力机制的基本材料，但还没有系统做过视觉实验","interest":"想搞清楚 ImageNet 分类上这些方法到底能不能直接比准确率，以及自己应该先读哪几篇","time":"一学期，每周约 10 小时","compute":"实验室有 4 张 RTX 3090，可做小规模微调；没有大规模预训练资源","goal":"为课程/开题做一份「图像分类方法演进」的调研，需要判断哪些结果可比、哪些不能直接比"}
- 候选 p_arxiv_1512.03385：fit=conditional，算力已报告=true
  - [paper] 该论文是 ImageNet 分类上残差学习框架的原始工作，直接给出 top-1/top-5 error rate 与 10-crop / single-model 评测协议，是判断「哪些结果可比」的基准锚点之一。
  - [paper] 论文报告了 CIFAR-10 从头训练（from_scratch 阶段）的算力条目：两块 GPU、mini-batch 128、64k 迭代，这是材料中唯一与用户「小规模微调」之外可对照的同阶段训练证据；但该条目仅覆盖 CIFAR-10，不能外推到 ImageNet 从头训练。
  - [gap] 论文未报告 ImageNet 从头训练的 GPU 数量、显存、并行策略与训练时长，因此用户 4 张 RTX 3090 能否复现 ImageNet 规模训练属于可行性未验证。
  - 缺失信息：ImageNet 从头训练的 GPU 数量、显存、并行策略与训练时长未报告，无法确认在 4 张 RTX 3090 上的可运行性；论文未报告算力与训练时长（ImageNet 部分），无法确认可运行性
- 候选 p_arxiv_2010.11929：fit=conditional，算力已报告=true
  - [paper] ViT 的核心思路是把图像切成 patch 序列送入 Transformer encoder，并明确区分「从头训练」「自监督预训练」「微调」三种设置，正好对应用户要判断的「结果可比性」问题：不同预训练数据规模下的准确率不可直接横向比较。
  - [paper] 论文报告的算力条目全部属于 pretrain 阶段（TPUv3-core-days：ViT-H/14 2.5k、ViT-L/16 0.68k、ViT-L/16 (I21k) 0.23k；ViT-L/16 在 ImageNet-21k 上约 30 天），用户没有大规模预训练资源，因此该阶段不可复现；但该条目可作为「预训练成本量级」的引用证据，用于说明为何 ViT 的 ImageNet 准确率不能与从头训练的 CNN 直接比。
  - [paper] 论文自述 ViT 在较小数据集上比 ResNet 更容易过拟合，且自监督预训练 ViT-B/16 在 ImageNet 上 79.9%，仍落后监督预训练 4%，这是判断「可比性」时必须注意的适用边界。
  - 缺失信息：论文未报告微调阶段在单卡/小规模 GPU 上的显存与并行策略，无法确认 4 张 RTX 3090 上微调 ViT 的可行性；论文未报告 ImageNet 从头训练 ViT 的算力条目，无法确认该阶段可运行性
- 候选 p_arxiv_2012.12877：fit=conditional，算力已报告=true
  - [paper] DeiT 的核心思路是在 ImageNet 上直接训练无卷积视觉 Transformer，并用强数据增强、正则化与蒸馏 token 实现数据高效训练，是「不依赖大规模外部预训练也能得到可比 ImageNet 准确率」的代表，直接回应用户「哪些结果可比」的问题。
  - [paper] 论文报告的算力条目属于 finetune 阶段：DeiT-B 训练 300 epochs 为 2 节点 37 小时或单节点 53 小时，DeiT-S/Ti 在 4 GPU 上少于 3 天，384×384 微调为单节点 8 GPU 20 小时（25 epochs）。这是材料中与用户「4 张 RTX 3090 可做小规模微调」最接近的同阶段证据，但论文给的是节点/GPU 数量而非显存与并行策略，因此只能作为量级参考，不能断言资源已满足。
  - [paper] 论文自述在 CIFAR-10 上仅用自身数据训练不如 ImageNet 预训练（98.5% vs 99.1%），说明数据多样性会显著影响可比性，是调研中必须标注的适用边界。
  - 缺失信息：论文未报告训练时的显存占用与并行策略，无法确认 4 张 RTX 3090 上能否复现 DeiT-B 300 epochs；论文未报告从头训练阶段的独立算力条目，无法确认该阶段可运行性
- 候选 p_arxiv_2103.14030：fit=unknown，算力已报告=true
  - [paper] Swin Transformer 的核心思路是层级式 Transformer + 移位窗口注意力，是 ImageNet 分类演进中「宏观设计」的关键一环，用户调研方法演进时需要理解其与 ResNet、ViT 的结构差异。
  - [paper] 论文报告的算力条目仅属于 inference 阶段（V100 GPU 用于吞吐量测量，具体数量与时长未给出），不能用于判断训练或微调的资源门槛；用户若想复现其 ImageNet 分类训练，材料中没有同阶段算力证据。
  - [paper] 论文自述推理速度方面 ResNe(X)t 由高度优化的 Cudnn 函数实现，而本架构使用未完全优化的 PyTorch 内置函数，这意味着吞吐量对比本身存在实现差异，是判断「结果可比性」时的重要警示。
  - 缺失信息：论文未报告 ImageNet 分类训练/微调的算力与训练时长，无法确认可运行性；ImageNet-1K 分类是 fine-tuning 还是从头训练在片段中未明确；评估协议未在片段中说明
- 候选 p_arxiv_2201.03545：fit=unknown，算力已报告=false
  - [paper] ConvNeXt 的核心思路是以 ResNet-50 为起点、逐步引入 Swin Transformer 的宏观与微观设计，把标准 ConvNet 现代化，是「CNN vs Transformer 在 ImageNet 上是否可比」这一问题的直接对照材料。
  - [gap] 论文的算力条目状态为 unverified、阶段未说明、适用范围未说明，因此无法引用任何同阶段算力来判断用户 4 张 RTX 3090 能否复现其 ImageNet-1K 从头训练（300 epochs）或 ImageNet-22K 预训练后微调（30 epochs，384^2）。
  - [gap] 论文在附录中声明会讨论 limitations（§F），但提供的片段未包含该节内容，因此无法引用作者自述的适用边界。
  - 缺失信息：论文未报告算力与训练时长，无法确认可运行性；算力条目状态为 unverified、阶段未说明、适用范围未说明；提供的片段未包含 §F limitations 内容
- 1. p_arxiv_1512.03385｜paper：作为 ImageNet 分类的经典基准，先建立「从头训练 + top-1/top-5 error」这一可比性锚点，后续方法才能对照。
- 2. p_arxiv_2010.11929｜paper：在理解 CNN 基准后，读 ViT 才能看清「预训练规模不同导致准确率不可直接比」这一核心可比性问题。
- 3. p_arxiv_2012.12877｜paper：DeiT 是「不依赖大规模预训练也能得到可比 ImageNet 准确率」的关键节点，放在 ViT 之后读能直接回答「哪些结果可比」。
- 4. p_arxiv_2103.14030｜paper：Swin 是 Transformer 路线在分类/检测/分割上的宏观设计来源，也是 ConvNeXt 的对照对象，放在 DeiT 之后读可衔接演进脉络。
- 5. p_arxiv_2201.03545｜paper：ConvNeXt 把 CNN 与 Transformer 的设计要素拉到同一比较框架，放在最后读有助于收束「方法演进 + 可比性」两条线。
- 条件敏感性：若用户把目标从「调研可比性」改为「亲手复现某个 ImageNet 结果」，则只有 DeiT 的 finetune 阶段算力条目（4 GPU 少于 3 天 / 单节点 53 小时）在量级上接近 4 张 RTX 3090，其余方法会因缺少同阶段算力证据而更偏向 unknown；若用户获得大规模预训练资源，ViT 的 pretrain 阶段才会从不可复现变为可讨论。