# 正式视觉语料：文件核对记录

- 核对时间：2026/9/18 17:39:32
- 文件目录：D:\AAA-Study\LearnbuddyRace\视觉经典论文
- 方法：用项目自身的 PDF 解析链路读取（与线上应用同一套代码），只统计与摘录首页，不做任何模型调用。
- **文件名里的年份不作为会议年份**；会议/年份以论文正文中的标记为准，逐篇记录。

## 汇总

| 文件 | 大小 | 页数 | 字符数 | 平均每页 | 文本层 | 正文出现的会议/年份标记 | arXiv |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01_ResNet_2015.pdf | 0.8 MB | 12 | 60672 | 5056 | 有（可解析） | 未发现 | 1512.03385 |
| 02_ViT_2020.pdf | 3.6 MB | 22 | 68282 | 3104 | 有（可解析） | ICLR 2021、arXiv 2010、arXiv 2003 | 2010.11929 |
| 03_DeiT_2020.pdf | 0.5 MB | 22 | 54237 | 2465 | 有（可解析） | arXiv 2012、arXiv 2006、arXiv 2008、arXiv 2010、ICLR 2020、arXiv 2004 | 2012.12877 |
| 04_Swin_Transformer_2021.pdf | 1.3 MB | 14 | 69574 | 4970 | 有（可解析） | arXiv 2012、arXiv 2004、arXiv 2006、arXiv 2011、CVPR 2018、ECCV 2020 | 2103.14030 |
| 05_ConvNeXt_2022.pdf | 0.7 MB | 15 | 73249 | 4883 | 有（可解析） | arXiv 2012 | 2201.03545 |

## 逐篇首页前若干行（用于人工核对标题与作者）

### 01_ResNet_2015.pdf

- 启发式识别标题：Deep Residual Learning for Image Recognition

```text
Deep Residual Learning for Image Recognition
Kaiming He Xiangyu Zhang Shaoqing Ren Jian Sun
Microsoft Research
{kahe, v-xiangz, v-shren, jiansun}@microsoft.com
Abstract
Deeper neural networks are more difficult to train. We
present a residual learning framework to ease the training
of networks that are substantially deeper than those used
previously. We explicitly reformulate the layers as learn-
ing residual functions with reference to the layer inputs, in-
stead of learning unreferenced functions. We provide com-
prehensive empirical evidence showing that these residual
networks are easier to optimize, and can gain accuracy from
considerably increased depth. On the ImageNet dataset we
```

### 02_ViT_2020.pdf

- 启发式识别标题：AN IMAGE IS WORTH 16X16 WORDS:

```text
Published as a conference paper at ICLR 2021
AN IMAGE IS WORTH 16X16 WORDS:
TRANSFORMERS FOR IMAGE RECOGNITION AT SCALE
Alexey Dosovitskiy
∗,†
, Lucas Beyer
∗
, Alexander Kolesnikov
∗
, Dirk Weissenborn
∗
,
Xiaohua Zhai
∗
```

### 03_DeiT_2020.pdf

- 启发式识别标题：understanding tasks, as initially demonstrated on image classification tasks.

```text
Training data-efficient image transformers
& distillation through attention
Hugo Touvron
?,†
Matthieu Cord
†
Matthijs Douze
?
Francisco Massa
?
Alexandre Sablayrolles
?
Herv´e J´egou
?
```

### 04_Swin_Transformer_2021.pdf

- 启发式识别标题：on ImageNet-1K) and dense prediction tasks such as object detection (58.7 box AP and 51.1 mask AP on COCO test- dev) and semantic segmentation (53.5 mIoU on ADE20K

```text
Swin Transformer: Hierarchical Vision Transformer using Shifted Windows
Ze Liu
†*
Yutong Lin
†*
Yue Cao
*
Han Hu
*‡
Yixuan Wei
†
Zheng Zhang Stephen Lin Baining Guo
Microsoft Research Asia
{v-zeliu1,v-yutlin,yuecao,hanhu,v-yixwe,zhez,stevelin,bainguo}@microsoft.com
```

### 05_ConvNeXt_2022.pdf

- 启发式识别标题：A ConvNet for the 2020s

```text
A ConvNet for the 2020s
Zhuang Liu
1,2*
Hanzi Mao
1
Chao-Yuan Wu
1
Christoph Feichtenhofer
1
Trevor Darrell
2
Saining Xie
1†
1
```

## 说明

- 「正文出现的会议/年份标记」只是文内字符串线索（例如页脚的 CVPR 2016），用于人工确认版本；
  本项目**不会**用它自动判定年份，年份仍以抽取结果与人工复核为准。
- 文本层不足的 PDF 会被解析环节直接拒绝，不会生成空结果。
