# 样例论文来源、许可与用途

## 一、当前样例（开发流程验证用，非最终参赛领域）

仓库**不直接包含**论文 PDF。运行 `node samples/download-samples.mjs` 可从 arXiv 公开链接下载到本地。

| 论文 | arXiv ID | 链接 | 年份 | 用途 |
| --- | --- | --- | --- | --- |
| Attention Is All You Need | 1706.03762 | https://arxiv.org/abs/1706.03762 | 2017 | 开发流程验证样例 |
| BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding | 1810.04805 | https://arxiv.org/abs/1810.04805 | 2018 | 开发流程验证样例 |
| Language Models are Few-Shot Learners | 2005.14165 | https://arxiv.org/abs/2005.14165 | 2020 | 开发流程验证样例 |

**用途声明**：以上三篇用于验证 PDF 解析、真实模型抽取、原文证据定位、跨论文比较与方法关系图这条链路是否可用。它们**不代表最终参赛选题**，用户尚未确认细分领域。界面中对应论文与分析结果均带「预置样例 / 缓存分析结果」标记。

**许可说明**：论文版权归原作者所有，通过 arXiv 公开链接获取，仅用于本地解析与作品演示。作品不重新分发 PDF 文件本身；导出内容仅包含短引文片段（用于证据核对），并在导出文件中注明来源链接。

## 二、压缩包内 PDF 的可使用范围（待用户逐一确认）

正式参赛前需要把每个领域的样例论文按下列口径登记：

| 字段 | 说明 |
| --- | --- |
| 来源 | arXiv / 会议官网 / 作者主页 等具体链接 |
| 版本 | arXiv 版本号（v1/v2）或会议年份版本 |
| 许可 | 页面声明的许可（如 arXiv 的 CC 协议、或仅限个人阅读） |
| 是否随仓库分发 | 建议默认「否」，仅提供下载脚本与链接 |
| 是否用于演示视频 | 是/否，以及是否需要遮挡 |

## 三、第三方依赖与许可

| 依赖 | 版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| react / react-dom | 18.3.1 | MIT | 界面 |
| vite | 5.4.x | MIT | 构建工具 |
| @vitejs/plugin-react | 4.3.x | MIT | React 编译 |
| typescript | 5.x | Apache-2.0 | 类型检查 |
| pdfjs-dist | 4.10.x | Apache-2.0 | PDF 文本层解析 |
| esbuild | 0.21.x（vite 传递依赖） | MIT | 离线脚本打包 |

许可清单会在提交前用 `npm ls --all` 复核一次，确认没有引入 GPL/AGPL 类传染性许可。
