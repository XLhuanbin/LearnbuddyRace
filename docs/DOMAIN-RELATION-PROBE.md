# 领域候选：方法关系线索预检（只用摘要，确定性）

- 生成时间：2026/9/18 15:06:48
- 方法：在每篇论文的 arXiv 摘要中检索「同领域其它方法名 + 关系措辞」的同现。
- 说明：**这只是线索**。本项目认证「原文明示」还要求句子指名被继承方法、具备对应关系措辞、并指向关系两端，
  且必须用全文（不是摘要）定位。因此下列结果只说明「值得进一步核实」，不代表已认证。

## 候选一：三维点云语义分割

### arXiv:1612.00593　PointNet: Deep Learning on Point Sets for 3D Classification and Segmen
- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）

### arXiv:1706.02413　PointNet++: Deep Hierarchical Feature Learning on Point Sets in a Metr
- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）

### arXiv:1801.07829　Dynamic Graph CNN for Learning on Point Clouds
- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）

### arXiv:1904.08889　KPConv: Flexible and Deformable Convolution for Point Clouds
- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）

### arXiv:1911.11236　RandLA-Net: Efficient Semantic Segmentation of Large-Scale Point Cloud
- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）

### arXiv:2012.09164　Point Transformer
- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）

### arXiv:2206.04670　PointNeXt: Revisiting PointNet++ with Improved Training and Scaling St
- 提到「Point Transformer」，命中措辞 [improve]：
  > …anding. Although the accuracy of PointNet++ has been largely surpassed by recent networks such as PointMLP and Point Transformer, we find that a large portion of the performance gain is due to improved training strategies, i.e. data augm…

### arXiv:2003.00492　PointASNL: Robust Point Clouds Processing using Nonlocal Neural Networ
- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）

小结：本组摘要中命中 1 处「方法名 + 关系措辞」同现。

## 候选二：低资源视觉表征与轻量模型

### arXiv:2002.05709　A Simple Framework for Contrastive Learning of Visual Representations
- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）

### arXiv:1911.05722　Momentum Contrast for Unsupervised Visual Representation Learning
- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）

### arXiv:2110.02178　MobileViT: Light-weight, General-purpose, and Mobile-friendly Vision T
- 提到「Transformer」，命中措辞 [outperforms]：
  > …k for mobile vision tasks? Towards this end, we introduce MobileViT, a light-weight and general-purpose vision transformer for mobile devices. MobileViT presents a different perspective for the global processing of information with…

### arXiv:1905.11946　EfficientNet: Rethinking Model Scaling for Convolutional Neural Networ
- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）

### arXiv:2010.11929　An Image is Worth 16x16 Words: Transformers for Image Recognition at S
- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）

小结：本组摘要中命中 1 处「方法名 + 关系措辞」同现。

## 候选三：检索增强生成的长文档问答

### arXiv:2005.11401　Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks
- 提到「retrieval」，命中措辞 [outperform]：
  > …ar been only investigated for extractive downstream tasks. We explore a general-purpose fine-tuning recipe for retrieval-augmented generation (RAG) -- models which combine pre-trained parametric and non-parametric memory for lang…

### arXiv:2007.01282　Leveraging Passage Retrieval with Generative Models for Open Domain Qu
- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）

### arXiv:2002.08909　REALM: Retrieval-Augmented Language Model Pre-Training
- 提到「retrieval-augmented」，命中措辞 [outperform]：
  > …propagating through a retrieval step that considers millions of documents. We demonstrate the effectiveness of Retrieval-Augmented Language Model pre-training (REALM) by fine-tuning on the challenging task of Open-domain Question Answering…

### arXiv:2112.04426　Improving language models by retrieving from trillions of tokens
- 摘要中未发现「同领域其它方法名 + 关系措辞」的同现（**摘要范围**内；结论需看全文）

### arXiv:2310.11511　Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Re
- 提到「retrieval-augmented」，命中措辞 [outperforms]：
  > …onses containing factual inaccuracies due to their sole reliance on the parametric knowledge they encapsulate. Retrieval-Augmented Generation (RAG), an ad hoc approach that augments LMs with retrieval of relevant knowledge, decreases such …

小结：本组摘要中命中 3 处「方法名 + 关系措辞」同现。

---

## 判定边界

- 摘要同现只是「线索」：摘要通常只有一两句，真正的继承关系陈述往往在方法或实验章节。
- 是否成立要看全文，并由项目的 `assessRelationEvidence` 逐条判定（第三方主语、是否指名、是否指向关系两端）。
- 本文件不构成任何「论文关系已确认」的结论。