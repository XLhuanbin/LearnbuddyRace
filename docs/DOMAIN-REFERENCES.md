# 正式领域候选的书目核实记录

- 核实时间：2026/9/18 15:06:18
- 来源：arXiv 官方 API（`export.arxiv.org/api/query`），逐条比对编号与标题。
- 说明：本文件只记录**核实结果**。凡未出现在「已核实」清单中的论文，一律视为待核实，不得引用。

## 候选一：三维点云中的语义分割（同一任务、同一评测集、同一指标）

| 编号 | 标题（API 返回） | 首次提交 | 最新版本 | 核实 |
| --- | --- | --- | --- | --- |
| arXiv:1612.00593 | PointNet: Deep Learning on Point Sets for 3D Classification and Segmentation | 2016-12-02 | 2017-04-10 | ✅ 已核实 |
| arXiv:1706.02413 | PointNet++: Deep Hierarchical Feature Learning on Point Sets in a Metric Space | 2017-06-07 | 2017-06-07 | ✅ 已核实 |
| arXiv:1801.07829 | Dynamic Graph CNN for Learning on Point Clouds | 2018-01-24 | 2019-06-11 | ✅ 已核实 |
| arXiv:1904.08889 | KPConv: Flexible and Deformable Convolution for Point Clouds | 2019-04-18 | 2019-08-19 | ✅ 已核实 |
| arXiv:1911.11236 | RandLA-Net: Efficient Semantic Segmentation of Large-Scale Point Clouds | 2019-11-25 | 2020-05-01 | ✅ 已核实 |
| arXiv:2012.09164 | Point Transformer | 2020-12-16 | 2021-09-26 | ✅ 已核实 |
| arXiv:2206.04670 | PointNeXt: Revisiting PointNet++ with Improved Training and Scaling Strategies | 2022-06-09 | 2022-10-12 | ✅ 已核实 |
| arXiv:2003.00492 | PointASNL: Robust Point Clouds Processing using Nonlocal Neural Networks with Adaptive Sampling | 2020-03-01 | 2020-05-05 | ✅ 已核实 |

## 候选二：低资源条件下的视觉表征与轻量模型（训练成本可控，适合毕设复现）

| 编号 | 标题（API 返回） | 首次提交 | 最新版本 | 核实 |
| --- | --- | --- | --- | --- |
| arXiv:2002.05709 | A Simple Framework for Contrastive Learning of Visual Representations | 2020-02-13 | 2020-07-01 | ✅ 已核实 |
| arXiv:1911.05722 | Momentum Contrast for Unsupervised Visual Representation Learning | 2019-11-13 | 2020-03-23 | ✅ 已核实 |
| arXiv:2110.02178 | MobileViT: Light-weight, General-purpose, and Mobile-friendly Vision Transformer | 2021-10-05 | 2022-03-04 | ✅ 已核实 |
| arXiv:1905.11946 | EfficientNet: Rethinking Model Scaling for Convolutional Neural Networks | 2019-05-28 | 2020-09-11 | ✅ 已核实 |
| arXiv:2010.11929 | An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale | 2020-10-22 | 2021-06-03 | ✅ 已核实 |

## 候选三：检索增强生成中的长文档问答（文本域，抽取链路最成熟）

| 编号 | 标题（API 返回） | 首次提交 | 最新版本 | 核实 |
| --- | --- | --- | --- | --- |
| arXiv:2005.11401 | Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks | 2020-05-22 | 2021-04-12 | ✅ 已核实 |
| arXiv:2007.01282 | Leveraging Passage Retrieval with Generative Models for Open Domain Question Answering | 2020-07-02 | 2021-02-03 | ✅ 已核实 |
| arXiv:2002.08909 | REALM: Retrieval-Augmented Language Model Pre-Training | 2020-02-10 | 2020-02-10 | ✅ 已核实 |
| arXiv:2112.04426 | Improving language models by retrieving from trillions of tokens | 2021-12-08 | 2022-02-07 | ✅ 已核实 |
| arXiv:2310.11511 | Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection | 2023-10-17 | 2023-10-17 | ✅ 已核实 |

---

合计：已核实 18 条，待核实 0 条。

> 提醒：编号与标题核实通过**不代表**该论文与候选领域中的其它论文一定可比；
> 可比性仍需按任务、数据集版本与划分、指标逐项核对（本项目由程序按论文对判定）。