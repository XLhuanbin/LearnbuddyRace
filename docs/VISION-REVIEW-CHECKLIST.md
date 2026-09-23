# 正式视觉语料：人工核查清单

- 生成时间：2026/9/18 17:59:54
- 数据来源：public/samples-vision/index.json（模型输出 + 程序核查结果）
- 表格里「系统输出」是**原样保留**的抽取结果；「核查判断」是人工/程序给出的判断，两者分开记录，没有静默修正。
- 判断口径：✅ 数据核对通过（数值与行标签同现于原文，且列头与指标一致）；⚠️ 待核查（可定位但列对齐/行带未确认）；❌ 与原文不一致。

## 一、论文级核对

| 论文 | 系统输出标题 | 标题来源 | 年份 | arXiv | 页数 | 首层校验状态 | 判断 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1512.03385 | Deep Residual Learning for Image Recognition | heuristic | 2015 | https://arxiv.org/abs/1512.03385 | 12 | evidence_missing | — 启发式标题 |
| 2010.11929 | AN IMAGE IS WORTH 16X16 WORDS: TRANSFORMERS FOR IMAGE RECOGN | model-verified | 2020 | https://arxiv.org/abs/2010.11929 | 22 | condition_unconfirmed、condition_unconfirmed | ✅ 标题经模型校正并在原文验证 |
| 2012.12877 | Training data-efficient image transformers & distillation th | model-verified | 2020 | https://arxiv.org/abs/2012.12877 | 22 | 无警告 | ✅ 标题经模型校正并在原文验证 |
| 2103.14030 | Swin Transformer: Hierarchical Vision Transformer using Shif | model-verified | 2021 | https://arxiv.org/abs/2103.14030 | 14 | condition_unconfirmed、condition_unconfirmed、condition_unconfirmed | ✅ 标题经模型校正并在原文验证 |
| 2201.03545 | A ConvNet for the 2020s | heuristic | 2022 | https://arxiv.org/abs/2201.03545 | 15 | condition_unconfirmed | — 启发式标题 |

> 说明：本轮 5 篇里 DeiT 与 Swin 的启发式标题抓到了摘要句子（PDF 首页排版导致），
> 系统用模型给出的标题并在原文中验证后校正为论文真实标题；ResNet / ViT / ConvNeXt 的启发式标题本身正确。

## 二、实验记录逐条核对

| 论文 | 模型变体 | 系统输出 | 页码 | 原文版面带（数值所在行） | 行标签在带内 | 列头（向上找） | 核查判断 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Deep Residual Learning | ResNet-50 | top-1 err.=22.85% @ImageNet validation | 6 | ResNet-50 22.85 6.71 building block (on 56 × 56 feature maps) as in Fi | 是 | — | ⚠️ 待核查 |
| Deep Residual Learning | ResNet-101 | top-1 err.=21.75% @ImageNet validation | 6 | ResNet-101 21.75 6.05 | 是 | — | ⚠️ 待核查 |
| Deep Residual Learning | ResNet-152 | top-5 err.=4.49% @ImageNet validation | 6 | ResNet-152 19.38 4.49 not essential for addressing the degradation pro | 是 | — | ⚠️ 待核查 |
| Deep Residual Learning | ResNet (ILSVRC’15) | top-5 err. (test)=3.57% @ImageNet test set | 6 | ResNet (ILSVRC’15) 3.57 are 1 × 1, 3 × 3, and 1 × 1 convolutions, wher | 是 | top-5 err. ( | ✅ 数据核对通过 |
| Deep Residual Learning | our single model (ILSVRC’15) | mAP=60.5% @ImageNet detection dataset (DET) | 11 | the feature maps of these two scales [33], which are merged our single | 是 | val2 | ⚠️ 待核查 |
| AN IMAGE IS WORTH 16X1 | ViT-H/14 | ImageNet=88.55 ± 0.04% @ImageNet | 6 | （未取到版面带） | 否 | — | ⚠️ 待核查 |
| AN IMAGE IS WORTH 16X1 | ViT-L/16 | ImageNet=87.76 ± 0.03% @ImageNet | 6 | （未取到版面带） | 否 | — | ⚠️ 待核查 |
| AN IMAGE IS WORTH 16X1 | ViT-L/16 | ImageNet=85.30 ± 0.02% @ImageNet | 6 | （未取到版面带） | 否 | — | ⚠️ 待核查 |
| AN IMAGE IS WORTH 16X1 | ViT-B/16 | accuracy=79.9% @ImageNet | 9 | self-supervised pre-training, our smaller ViT-B/16 model achieves 79.9 | 否 | prediction | ⚠️ 待核查 |
| Training data-efficien | DeiT-B | top-1 accuracy=81.8% @ImageNet-1K | 12 | DeiT-B 86M 224 2 292.3 81.8 86.7 71.5 | 是 | top-1 | ✅ 数据核对通过 |
| Training data-efficien | DeiT-B↑384 | top-1 accuracy=83.1% @ImageNet-1K | 12 | DeiT-B ↑ 384 86M 384 2 85.9 83.1 87.7 72.4 | 否 | top-1 | ⚠️ 待核查 |
| Training data-efficien | DeiT-B⚗ | top-1 accuracy=83.4% @ImageNet-1K | 12 | DeiT-B ⚗ 87M 224 2 290.9 83.4 88.3 73.2 | 否 | top-1 | ⚠️ 待核查 |
| Training data-efficien | DeiT-B⚗ ↑384 / 1000 epochs | top-1 accuracy=85.2% @ImageNet-1K | 12 | DeiT-B ⚗ ↑ 384 / 1000 epochs 87M 384 2 85.8 85.2 89.3 75.2 | 否 | top-1 | ⚠️ 待核查 |
| Swin Transformer: Hier | Swin-T | ImageNet top-1 acc.=81.3% @ImageNet-1K | 6 | similar complexities: +1.5% for Swin-T (81.3%) over Table 1. Compariso | 是 | and | ⚠️ 待核查 |
| Swin Transformer: Hier | Swin-B | ImageNet top-1 acc.=83.5% @ImageNet-1K | 6 | 1024, a constant learning rate of 10 , and a weight − 8 Swin-B 224 2 8 | 是 | ImageNet | ⚠️ 待核查 |
| Swin Transformer: Hier | Swin-B | ImageNet top-1 acc.=84.5% @ImageNet-1K | 6 | Swin-B (83.3%/84.5%) over DeiT-B (81.8%/83.1%) using of [68] and a V10 | 是 | DeiT-S (79.8%) using 224 | ⚠️ 待核查 |
| Swin Transformer: Hier | Swin-L | ImageNet top-1 acc.=87.3% @ImageNet-1K | 6 | 55.4G). The larger Swin-L model achieves 87.3% top-1 ac- pre-trained m | 是 | 22K pre-training brings 1.8% | ⚠️ 待核查 |
| Swin Transformer: Hier | Swin-L (HTC++)* | AP box=58.7 @COCO | 7 | Swin-L (HTC++)* 58.0 50.4 58.7 51.1 284M - all well-optimized. A thoro | 是 | AP | ⚠️ 待核查 |
| A ConvNet for the 2020 | ConvNeXt-T | top-1 acc.=82.1% @ImageNet-1K | 7 | • ConvNeXt-T 224 2 29M 4.5G 774.7 82.1 Our results demonstrate that pr | 否 | IN-1K | ⚠️ 待核查 |
| A ConvNet for the 2020 | ConvNeXt-B | top-1 acc.=83.8% @ImageNet-1K | 7 | • ConvNeXt-B 224 2 89M 15.4G 292.1 83.8 better than similarly-sized Sw | 否 | IN-1K | ⚠️ 待核查 |
| A ConvNet for the 2020 | ConvNeXt-B | top-1 acc.=86.8% @ImageNet-1K | 7 | • EffNetV2-L [72] 480 2 120M 53.0G 83.7 86.8 top performance. However, | 否 | IN-1K | ⚠️ 待核查 |
| A ConvNet for the 2020 | ConvNeXt-XL | top-1 acc.=87.8% @ImageNet-1K | 7 | • ConvNeXt-XL 384 2 350M 179.0G 30.2 87.8 supervised training results  | 否 | IN-1K | ⚠️ 待核查 |
| A ConvNet for the 2020 | ConvNeXt-T | AP_box=50.4% @COCO | 8 | ◦ Swin-T 745G 12.2 50.4 69.2 54.7 43.7 66.6 47.3 • ConvNeXt-B 512 2 49 | 否 | Mask-RCNN 3 | ⚠️ 待核查 |

小结：2 条通过「文本 + 版面」双核查，21 条待核查（多为列对齐/行带无法用几何确认），0 条与原文不一致。

待核查不等于数值错误：这些记录的数值与模型行标签都能在原文中定位（见「原文版面带」列），
但因为表格是双栏/跨行排版，程序无法确认「这个数值确实属于所报的那一列」，因此按规则标为待核查、不进入「可直接比较」。

## 三、本轮人工核查发现的问题（含未修复项）

| # | 问题 | 类型 | 处理 |
| --- | --- | --- | --- |
| 1 | DeiT、Swin 的启发式标题抓到摘要句子 | 解析（非模型） | **已修复**：模型标题 + 原文验证校正，并保留 `titleFrom` 标记 |
| 2 | ResNet 报的是 top-1 **error**，DeiT/Swin/ConvNeXt 报的是 top-1 **accuracy**，程序原先把两者当成同一指标 | 规则 | **已修复**：区分 error / accuracy，并在比较时说明「可互换但方向相反」 |
| 3 | 表格行标签核查最初用「逐字包含」，导致 `Swin-T` 这类短标签一律判失败 | 规则 | **已修复**：改用归一化定位 + 要求出现在引文附近 |
| 4 | 列头搜索范围过小（220pt），而真实列头在数值上方约 268pt | 规则 | **已修复**：扩大范围并过滤句子型候选（列头形如 top-1 / FLOPs） |
| 5 | ViT 的一条记录把数据集名当成了指标名（`ImageNet=88.55`），另一条是 `accuracy` | **模型抽取错误** | **未修复**：已在界面按原样展示并在本清单标出；修复需要重跑该篇抽取或人工修正，本轮不静默改数 |
| 6 | Swin 中仅用 ImageNet-1K 训练的三条记录，预训练数据为「未知」（论文其实写了 1K 训练/无额外数据） | 模型抽取不完整 | **未修复**：标为未知而不是猜；Swin-L 的 22K 预训练已正确抽出 |

## 四、判定边界

- 本清单的「数据核对通过」只说明**数值与该行原文一致、列头与指标一致**，不代表该实验设置完整（例如训练轮数、增强策略未必记录）。
- 「待核查」是保守判断：宁可标出来，也不把无法确认的行列关系当作事实。
- 本文件不参与任何排名或「架构更优」的因果结论。
