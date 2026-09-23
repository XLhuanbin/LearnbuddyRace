# ResearchPilot · 论文方法梳理智能体

粤港澳大湾区 AI Coding 创新大赛参赛作品（方向二：论文方法梳理智能体）。

面向「刚进入某个计算机研究领域的学生」：导入一批论文，得到**能回到原文**的方法对比、可比性判断、方法关系与个性化方法决策。

> 本作品的全部结构化结论都绑定原文证据：模型给出的每条引文都要在论文全文中重新定位校验，定位不到就降级为「待人工核对」或「未找到证据」。可比性判断与关系可信度由**规则**在结构化结果上计算，不使用未校准的模型置信度，也不对方法效果做排名。

---

## 一、五个核心能力

| 能力 | 说明 |
| --- | --- |
| **证据绑定** | 7 个方法字段 + 7 个实验条件维度，每条都带原文引文；点击可看论文名称、页码、章节与原文上下文。引文定位失败时不显示页码，改为展示实际匹配到的位置。字段状态四态：可核验 / 待人工核对 / 未找到证据 / 缺失。 |
| **不可比检测** | 按数据集、数据划分、指标、额外训练数据、预训练模型、实验设置、算力共 7 个维度做**规则化**判断，输出「可以直接比较 / 只能有限比较 / 当前不能直接比较」，并列出具体差异与缺失信息。条件不一致时禁止比较数值。 |
| **方法关系可信度** | 关系分三档：**原文明示**（有可定位的引文）/ **系统推断**（附推断理由）/ **待核查**（依据不足）。引文可定位但不含继承措辞时会被判为「关键词相似而非技术继承」并降级。支持人工修改、删除、新增关系，并保留 AI 原判定。 |
| **方法决策** | 输入基础、目标、时间、计算资源，输出候选方法（含匹配度）、阅读顺序、每条推荐的理由与依据来源、适用条件、缺失信息。论文未报告算力时明确说无法确认，不推测可运行性。 |
| **分歧与待调查问题** | 区分「结论分歧（条件一致）」「可由条件差异解释」「共同提到的局限」「当前材料未发现」。模型若把条件不一致的论文对判为结论分歧，系统会强制降级。同时列出「已检查的论文对」，说明没有为了展示而制造冲突。 |

外加一个**程序校验层**：字段缺失、未提供引文、引文无法定位、引文过短、页码不一致、页码无效、条件无法确认、关系被降级等问题都会逐条标出，并说明系统做了什么处理或需要人工做什么。

## 二、快速开始（本地）

```bash
npm install --registry=https://registry.npmmirror.com
npm run dev          # http://127.0.0.1:5173
npm run build        # 输出 dist/（含资源指纹注入，用于部署）
```

打开后：

1. 「设置」里填一个 OpenAI 兼容接口（baseUrl / API Key / 模型名），点「测试连接」。
2. 「论文库」导入带文本层的 PDF（可多选），或点「加载预置样例语料」查看已由真实模型离线完成的 5 篇论文分析。
3. 对论文点「抽取方法字段」→ 到「跨论文比较」「方法关系图」「方法决策」「分歧与待调查问题」继续。

**没有模型接口也能用**：预置语料包含 5 篇论文的字段、实验条件、关系、分歧与示例决策，界面全部明确标注为缓存结果。

## 三、重新生成语料（需要真实模型）

```bash
node samples/download-samples.mjs                 # 下载 5 篇样例论文
DEEPSEEK_API_KEY=sk-xxx npm run analyze           # 完整流水线：抽取 + 关系 + 分歧 + 示例决策
npm run analyze:report                            # 只用已有缓存重建报告，不调用模型
npm run variation                                 # 验证「推荐随用户条件变化」（需模型可用）
```

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 无（必填） | 模型接口密钥 |
| `RP_MODEL_BASE` | `https://api.deepseek.com` | OpenAI 兼容 baseUrl |
| `RP_MODEL` | `deepseek-chat` | 模型名 |

生成物：`public/samples/index.json`（字段 + 条件 + 关系 + 分歧 + 示例决策）、`public/samples/text/*.json`（逐篇全文）、`public/samples/REPORT.md`（含不可比检测矩阵与校验问题清单）。

脚本会先用 esbuild 把 `src/core` 打包成 Node 模块，**保证离线缓存与浏览器端实时分析共用同一套提示词与校验实现**。

## 四、验证入口

```bash
npm run typecheck   # 类型检查
npm test            # 核心回归测试（178 项）
npm run build && npm run e2e                          # 端到端走查（112 项）
node scripts/e2e-check.mjs --url <线上地址>            # 对已部署版本走查
```

详细的状态与验证记录见 [`docs/STATUS.md`](docs/STATUS.md) 与 [`docs/VERIFICATION.md`](docs/VERIFICATION.md)，
未完成的验证项也一并列在 `docs/VERIFICATION.md` 末尾，不做隐藏。

## 五、目录结构

```
src/
  core/
    types.ts            数据模型（含实验条件、校验问题、关系可信度状态）
    text.ts             文本归一化与「引文→原文位置」定位
    evidence.ts         证据构建与校验（所有模型引文的唯一入口）
    comparability.ts    不可比检测规则（三档结论 + 依据 + 缺失信息）
    validate.ts         程序校验层（缺失 / 引文 / 页码 / 条件 / 关系降级）
    excerpt.ts          按章节优先裁剪原文，并注入页码标记
    compare.ts          比较矩阵与导出
    cache.ts            预置语料格式、加载与旧数据迁移
    storage.ts          IndexedDB 持久化 + 使用记录
    nodePipeline.ts     Node 侧离线流水线
    model/              client 模型客户端 / prompts 提示词 v2.1 / analyze 编排
  ui/                   Library / Compare / Graph / PlanView(决策) / Divergence / SettingsView
scripts/
  analyze.mjs           离线真实模型流水线（支持 --report-only 与 --decision-variation）
  revalidate.mjs        规则重算：把新规则应用到已有缓存，不调用模型
  pair-check.mjs        论文对级可比性核对（比较页与分歧页同源验证）
  import-verify.mjs     未预置论文的真实导入验证（不写入参赛语料）
  relation-candidates.mjs  关系证据候选检索（确定性，不调用模型）
  browser-flow-check.mjs   真实浏览器调用流程验证（含真实模型调用，密钥不回显）
  auth-error-check.mjs     鉴权失败路径验证（本地 mock，确定性）
  verify-refs.mjs          领域候选书目核实（arXiv API，不编造）
  domain-relation-probe.mjs 领域候选的方法关系线索预检（只用摘要，确定性）
  vision-corpus-init.mjs    正式视觉语料初始化（复制 PDF + 生成清单，不调用模型）
  vision-check-files.mjs    语料文件核对（标题/版本/文本层/页数）
  table-binding-check.mjs   实验表格行列关系的版面级核查（确定性）
  vision-review-checklist.mjs 生成人工可审阅的核查清单
  ui-audit.mjs              逐页截图审查（桌面 + 窄屏，不调用模型）
  demo-walkthrough.mjs      新用户演示路径实走（35 项断言 + 逐步截图）
  demo-walkthrough2.mjs     路径 A/B 实走（41 项断言 + 逐步截图，含空状态）
  verify-corpus-state.mjs   语料状态验收（A 空状态 / B 重复加载 / C 旧数据 + 切换往返）
  verify-collection-scope.mjs 研究地图集合范围回归（案例不得混入用户论文 / 历史 NLP 记录）
  demo-walkthrough3.mjs     新用户路径实走（宣传首页 → 结果 → 方法演进，37 项断言；已被 v4 取代）
  demo-walkthrough4.mjs     两条真实路径实走（体验案例 + 上传自己的 PDF，52 项断言）
  repro-duplicate-load.mjs  重复加载问题的复现脚本（诊断用）
  stamp-build.mjs       构建指纹注入（规避静态托管的 CDN 缓存）
  test.mjs / e2e-check.mjs
samples/                样例清单、下载脚本、来源与许可说明
docs/                   STATUS.md / VERIFICATION.md / CANVAS-REDESIGN-ROUND.md / METHOD-MAP-ROUND.md / POSITIONING-MAP-ROUND.md / INFO-ARCH-ROUND.md / CORPUS-STATE-FIX.md / VISUAL-REDESIGN-ROUND.md / UI-UX-ROUND.md / VISION-CASE-REPORT.md / VISION-REVIEW-CHECKLIST.md / VISION-CORPUS-FILES.md / EXPERIMENT-TABLE-CHECK.md / CORRECTNESS-FIXES.md / ROUND4-COMPLETION.md / ROUND5-AUDIT.md / ROUND6-COMPLETION.md / DOMAIN-CANDIDATES.md / REVALIDATION.md / DECISION-VARIATION.md / IMPORT-VERIFICATION.md / BROWSER-FLOW-VERIFICATION.md / AUTH-ERROR-VERIFICATION.md / RELATION-CANDIDATES.md
```

## 六、能力边界（重要）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 带文本层 PDF 解析 | 可用 | 浏览器与 Node 均已实测；超过 120 页会截断并提示 |
| 扫描件 / OCR | **不支持** | 会明确报错并提示改用「粘贴论文文本」入口 |
| 真实模型抽取 | 可用（需自备接口） | 无接口时不会伪造结果，只报告缺项 |
| 原文证据校验 | 可用 | 引文必须在全文中定位；失败降级并展示实际匹配位置 |
| 不可比检测 | 可用 | 规则计算，可逐条查看依据；不做排名 |
| 关系人工修正 | 可用 | 保留 AI 原判定，可恢复 |
| 本地持久化 | 可用 | IndexedDB，刷新可恢复；无服务端数据库 |
| 服务端后端 / 多用户 | **不支持** | 部署通道仅支持纯前端静态站点 |
| 自动全网检索论文 | **不支持** | 论文来源为上传或样例缓存 |
| 失败经验库 / 自动实验 | **未开发** | 不属于首版范围，且当前没有真实实验记录可依据 |

## 七、部署

```bash
npm run build
# 把 dist/ 作为静态站点目录发布
```

两个实测注意事项：

1. 部署通道为纯前端静态托管，**线上版本不含任何密钥**；实时分析需访问者自行填写接口（浏览器直连）。
2. 静态托管的 CDN 会按 URL 缓存资源，而本项目的构建目录无法清空（环境限制）导致文件名固定。
   因此构建脚本会注入内容哈希查询串（`app.js?v=<hash>`），避免访问者看到旧版本。

## 八、协作开发（给队友）

### 环境

- Node 20+（开发使用 22.x 验证），npm 建议加国内镜像：`npm install --registry=https://registry.npmmirror.com`
- 无需后端、无需数据库；数据存在浏览器 IndexedDB，刷新可恢复

### 常用命令

```bash
npm install --registry=https://registry.npmmirror.com   # 安装依赖
npm run dev                 # 本地开发
npm run typecheck           # 类型检查
npm test                    # 核心逻辑回归（218 项，全部离线可跑）
npm run build && npm run e2e    # 构建 + 无头 Chrome 端到端走查
npm run analyze             # 真实模型全量重跑（需自备密钥，见下）
```

### 提交前请自查

1. `npm run typecheck && npm test` 必须通过；
2. **不要提交密钥**：模型地址与密钥只在浏览器「设置」里填写（本机存储），脚本通过环境变量读取
   （`DEEPSEEK_API_KEY` / `RP_MODEL_BASE` / `RP_MODEL`），仓库里不得出现任何明文密钥；
3. **不要提交论文 PDF**：`samples/pdfs/` 已被忽略，PDF 版权归原作者，用 `samples/download-samples.mjs` 获取；
4. **不要提交 `node_modules/`、`dist/`、`.build/`**：已在 `.gitignore`；
5. 改动涉及规则或提示词时，同步更新 `docs/STATUS.md` 与 `docs/VERIFICATION.md`，并递增 `RULES_VERSION` / `PROMPT_VERSION`。

### 真实性约定（评审会看，务必遵守）

- 关键字段与结论必须绑定**能在全文中定位**的原文片段；定位失败降级为「待人工核对」，**不伪造页码与引文**；
- 明确区分「论文作者陈述 / 系统推断 / 用户修正」；不使用未校准的置信度百分比；
- 判断不了就标「仍需确认 / 信息不足」——**不要为了界面好看而编造关系、推荐或研究结论**；
- 预置语料一律标注为「缓存案例」，不得伪装成实时分析；上传自己的论文走同一条流水线。

## 九、许可与第三方来源

- 本项目以 **MIT License** 发布，见根目录 `LICENSE`（版权署名 XLhuanbin，如需改为团队名称直接改该文件即可）。
- 第三方依赖（React、Vite、pdfjs-dist、esbuild 等）为 MIT / Apache-2.0 等宽松许可，通过 npm 安装、不随仓库分发；
  完整清单见 `package.json` 与 `package-lock.json`（`npm ls --depth=0` 可查看）。
- **论文正文与 PDF 不随仓库分发**：`samples/pdfs/` 已被忽略，PDF 版权归原作者，用 `samples/download-samples.mjs` 自行获取；
  仓库内 `public/samples*/` 只含**结构化分析结果与原文片段引文**（用于证据定位），不含论文全文。
- **界面走查截图不随仓库分发**（仅作者本地保留），说明见 `docs/SCREENSHOTS.md`。
