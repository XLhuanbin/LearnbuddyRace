# ResearchPilot 系统性修复与实验可比性页重构（2026-10-13）

> 审查基线：HEAD `46bd2ae`。本轮按批次实施：**先数据与真实性（P1）→ 比较判定与证据语义 → 实验页信息结构 → 全站联动 → 资源边界**。
> 所有结论以**实跑**为准：未跑的我不会写成通过；跑不通的写清阻塞原因。
> 回归测试从 483 增至 **595 条，失败 0**。

## 1. 逐项状态（编号 → 状态 / 根因 / 变更文件 / 验证证据）

### 第一批：数据一致性与异步任务

| # | 状态 | 根因（修的是什么） | 主要变更 | 验证证据 |
|---|---|---|---|---|
| 1 | ✅ 已修 | `tx()` 在 `request.onsuccess` 就 resolve，而 `onsuccess` 只代表请求成功，事务仍可能 abort | `src/core/storage.ts`（等 `transaction.oncomplete`；error/abort 一律 reject；`settled` 守卫） | 测试 §38：模拟「请求成功 → 事务 abort」→ 调用方收到 reject 且数据未落库 |
| 2 | ✅ 已修 | 删除/撤销/切语料/清理分步写库，中途失败留下部分删除或部分恢复；切语料**完全不删关系**（悬挂关系） | `App.tsx`（全部改 `repo.applyAtomic`）、`corpus.ts`（新增 `collectScopeRemoval` / `danglingRelations`） | 测试 §38 跨表原子回滚；`verify:reload` 20/0、`verify:relations` 16/0 |
| 3 | ✅ 已修 | 初始化无 catch（失败表现得像空库）；案例加载无版本/范围校验；主体与配套产物分两次提交 | `App.tsx`（initState 三态 + 「重试恢复」；`loadSeq`+`corpusRef`；主体与 meta **同一事务**） | `verify:import` 空数据阶段；`verify:reload` 20/0 |
| 4 | ✅ 已修 | 分析产物只按 corpusId 归档，case/own 互串；切模式不清理、不使在途任务失效 | `corpus.ts`（`ScopeIdentity` / `scopeIdentityKey` / 新签名 `asScopedSnapshot`·`readScopedSnapshot`）、`App.tsx`（scopeKey effect） | 测试 §5/§42：切语料/切模式/论文集合变化时旧产物不复用；新增「只有 corpusId 的中间格式也不复用」 |
| 5 | ✅ 已修 | 抽取返回时不校验论文是否还在、内容是否变；用发起前的 `prev` 合并会覆盖等待期间的人工修正 | `App.tsx`（每篇版本号 `extractSeq`、墓碑 `removedPaperIds`、同篇互斥、提交前读 `methodsRef` 合并；重新解析使在途抽取失效） | 代码级断言 + `verify:relations`（人工修正保留） |
| 6 | ✅ 已修 | 去重与 busy 依赖渲染闭包：双击/双入口会重复导入或重复发起同一任务 | `App.tsx`（导入**串行队列**；`locks` 同步锁覆盖 relations/plan/divergence/extract/corpusLoad） | 测试 §38 并发 `appendUsage`；`verify:import` 阶段 B（同一 PDF 传两次只留一份） |
| 7 | ✅ 已修 | 关系编辑草稿是全局一份，切到 B 后保存会把 A 的草稿写到 B | `src/ui/Graph.tsx`（`editingId` 绑定 + `active` 变化退出编辑 + 保存前再核对 id） | 代码级：两处保存按钮都有 id 一致性闸门 |
| 8 | ✅ 已修 | `appendUsage` 是 read→push→整体 save，并发丢记录 | `storage.ts`（`txUpdateMeta` 同事务读改写 + 结构校验） | 测试 §38：三次并发 append 全部保留（旧实现只剩最后一条） |

### 第二批：比较判定、原文证据与人工修正

| # | 状态 | 根因 | 主要变更 | 验证证据 |
|---|---|---|---|---|
| 9 | ✅ 已修 | 完整性/比较/抽取三处未知值判据不同：双方 evalSplit 为空、verification 缺失、`未说明`/`—` 都被当成已知 | `experiments.ts`（`isUnknownValue` 唯一判据；缺 verification 不再默认通过） | 测试 §39：三条复现各有断言（含「缺元数据 → 表格行列算未知」） |
| 10 | ✅ 已修 | 归一化吞掉真实口径：mAP 阈值/对象、单位、数据集版本、复合来源、分辨率 | `experiments.ts`（`canonicalMetricName` 保留阈值+对象；`canonicalMetricUnit`+换算式；数据集别名顺序与 V2；复合来源拆分；`canonicalResolution` 完整保留） | 测试 §39：`mAP@0.5 ≠ mAP@0.5:0.95`、box≠mask、1K-V2≠1K、`1K + 21K` 保留、`224x384 ≠ 224`、%↔ratio 可换算、无换算关系硬阻断 |
| 11 | ✅ 已修 | `locateQuote` 的头部兜底按覆盖率 ≥0.9 升级为 `loose`→ 下游 `verified=true, coverage=1` 并替换引文 | `text.ts`（该路径**永远** `partial` + `unmatchedTail`）、`evidence.ts`（保留真实覆盖率与模型原引文；数字/否定词尾部显式提示） | 测试 §40：前 120 字 + 虚构尾部 → verified=false、coverage<1、引文不被替换 |
| 12 | ✅ 已修 | `similar` 过去只要求「指名一端 + 自指另一端」，基线句被判为原文明示相似关系 | `rules.ts`（`similar` 也必须有关系措辞；`RULES_VERSION` → **r3.4.0**） | 测试 §41：`against X as a baseline` 不通过；`Unlike…/most related` 仍通过 |
| 13 | ✅ 已修 | 结论分歧只查「论文数≥2 + commonScope」，`sides=[]`、无 claimType 也成立 | `divergenceRules.ts`（需两篇不同论文 + 各自明确主张 + 引文定位通过 + 共同范围 + claimType） | 测试 §6 新增 5 条（缺主张/缺类型/单方/引文不可定位 → 不认定为分歧） |
| 14 | ✅ 已修 | 集合维度用「与第一篇是否有交集」判据（**排列相关**）；一方协议识别不出会被说成「协议不同」；人工分项正则里是 0x08 退格字符 | `comparability.ts`（逐对判断；`splitConditionValues` 单一实现；协议未知→信息不足） | 测试 §39：6 种排列结论一致；`{A,B}/{A}/{B}` 判「不能直接比较」；协议未知→unknown |
| 15 | ✅ 已修 | 「勾选已核对」被当成「该条件已知」；重载/重分析按（模型+指标+数据集）匹配会错带 val→test；同模型同指标多条互相覆盖 | `types.ts`（`ExperimentConditionSupplement`）、`experiments.ts`（`withSupplements`/`experimentIdentityKey`/`tableBinding` 三档）、`reanalysis.ts`（身份匹配 + 一一对应发放）、`App.tsx`（补充必须带值+来源，定位校验 paperId+expId） | 测试 §42：只有标记不改变未知；val→test 不携带旧确认；两条记录一一对应不互相覆盖 |

### 第三批：实验可比性页重构

| # | 状态 | 做法 | 验证证据 |
|---|---|---|---|
| 16 | ✅ 已重做 | 主结果＝**实验对**的四类结论；每条结论同时给出关键差异/未知项/阻断项；单条记录的「条件完整」不再是主结果 | 截图 01/02/03/07；测试 §39 计数对象分开（论文/记录/实验对） |
| 17 | ✅ 已重做 | 同口径组键＝**任务+数据集(含版本)+划分+指标口径(含阈值/对象)+单位**；训练/预训练、分辨率、额外数据、蒸馏、测试时增强、推理方式全部进入判定；不把「只能结合条件讨论」的对升级成整组 | 测试 §39 分组隔离（4 组）；截图 03 条件矩阵 |
| 18 | ✅ 已重做 | 首屏：范围/计数 → 一句概况 → 四类结论卡 → 优先实验对主表（模型/口径/原始结果/结论/主因）；条件矩阵、证据、补充入口在展开层 | 截图 01（首屏直接回答「能否比较」）、06（补充入口） |
| 19 | ✅ 已改 | 只在「可直接比较」的对内画对照条并标注尺度与指标方向；其余状态**不并排**数字（明确写「仅供核对，不构成对照」）；数值解析区分 point/range/bound/approx；缺数值的记录仍可查看原因 | 截图 03（不构成对照的措辞）、07（对照条 + 尺度/方向）；测试 §39 数值解析 6 条 |
| 20 | ✅ 已改 | 状态按 `scopeKey`（含 mode）复位；「已选记录」不再用 `chartable.length` 冒充，改为真实的论文/记录/对计数；导出与本视图同源并写明范围/过滤；own 空范围给出上传入口 | 截图 10；`verify:import` 25/0 |

### 第四批：全站联动

| # | 状态 | 主要变更 | 验证证据 |
|---|---|---|---|
| 21 | ✅ 已修 | `ResultPageView` / `MapNetworkView` / `Compare` 统一读 `effectiveField`；导出 JSON 与 Markdown 同源且保留 AI 原值；人工改写不继承「已核验」标签 | 代码级 + `verify:ui` |
| 22 | ✅ 已修 | `resultPaperId` 持久化 + 目标失效时给恢复入口；删除当前论文清目标；返回按钮补齐 `home/more/settings/status/version/future` 映射 | `verify:ui`、`verify:scope` 25/0 |
| 23 | ✅ 已修 | 上传页显式写出「本次队列 N 个文件 · 当前范围共 M 篇论文；批量分析只处理队列里的文件」；推荐与统计用同一 scope | 截图 10 所在流程的页面文案；`verify:import` |
| 24 | ✅ 已修 | 选择与当前有效对象求交集；只有 1 篇时禁用需要两篇的入口；搜索覆盖论文标题+方法名+别名；全选只作用当前可见项；`similar/unclear` 不画确定继承方向 | `verify:ui`（关系图方向/图例断言） |
| 25 | ✅ 已修 | 结果条件只读 `plan.profile`（不再写成当前表单条件）；示例按钮实际加载示例并反馈；重新载入示例不再直接 return | `verify:layout`（阅读路线页）、`verify:ui` |
| 26 | ✅ 已修 | 证据弹层加 `role=dialog`/焦点管理/Esc/关闭后焦点返回；缩放按钮有可访问名；连接支持键盘；label 与输入关联；**按需 hydrate 全文现在会落盘**（失败只记日志不谎称已缓存） | `verify:ui` 键盘断言；`hydrateAndPersist` |

### 第五批：模型接口与资源边界

| # | 状态 | 主要变更 | 验证证据 |
|---|---|---|---|
| 27 | ✅ 已修 | `client.ts`：`buildEndpoint`（URL API，正确处理 `/v1`、query、尾斜杠）+ 错误分类（config/request/ratelimit/server/timeout/canceled/response）+ 退避可被 abort 中断；如实写明「超时重试可能重复计费」，不假装有幂等 header | 子任务测试（`tests/resource-hardening.test.ts`） |
| 28 | ✅ 已修 | `pdfBrowser.ts`：字节预算、`%PDF-` 校验、页数早停、`finally destroy()`、取消、超长截断并在 warnings 里如实说明 | 同上 |
| 29 | ✅ 已修 | `cache.ts`：所有静态资源 fetch 走 `fetchWithTimeout`（15s 超时 + 可取消，错误带 `kind`）；`currentBuildId` 失败**不入缓存**（不再把一次瞬时失败钉成整会话的 `?v=dev`，从而命中 CDN 旧语料）；新增 `isCachedCorpusIndex` / `isCachedPaperText` **运行时结构校验**（替换纯类型断言），不通过就明确拒绝加载 | 测试 §43：缺 papers/methods/relations、方法缺 fields、关系缺两端 id、非对象 → 一律拒绝；两份真实缓存通过 |
| 30 | ✅ 已修 | `client.ts` 导出 `redactUrl`/`assertNoUrlCredentials`/`describeModelError`；`App.tsx#saveConfig` 拒绝 URL 带凭据、日志只打印脱敏地址 | `verify:ui`（设置页） |
| 31 | ✅ 已修（确有缺陷） | **入口级复现**：阅读路线 / 分歧构造模型输入时读的是 `m.conditions[dim].values`（抽取时快照），人工修正 `datasets`/`metrics` 后仍把旧值送给模型；`withEffectiveMethods` 只替换 `fields`、救不了它。⇒ 统一改走 `comparability.conditionOf()`（人工修正优先），并把「人工修正值，非原文核验」写进送模型的文本 | 测试 §43：真实调用 `generateDecision` 抓请求体 → 含 `NEW-DATASET-2`、不含 `OLD-DATASET-1`、含标注 |

## 2. 未解决项、未运行检查与真实阻塞原因

1. **子任务未按承诺交付**（已由主流程补齐）：派出的「资源边界」子任务只产出了 `client.ts`（+396 行）与
   `pdfBrowser.ts`（+201 行），约 1 小时后停止写盘，`cache.ts` / `docs/RESOURCE-HARDENING.md` / 独立测试文件均未产出。
   因此 #29、#31 由主流程自己实现，并把回归用例并入 `tests/core.test.ts` §43（**新测试文件不会被现有 runner 加载**，
   放独立文件等于没测）。
2. **`verify:layout` 本轮新增的 8 条失败已修**：根因是子任务新加的两处说明文字用了 `text-[11px]`，
   低于项目 12px 字号下限（`verify:layout` 的断言把这条守住）。已改为 `text-sm`/`text-xs`，现 89/0。
   该脚本仍有与页面数据绑定的断言，判定标准按项目约定「只看失败数是否为 0」。
3. **`verify:ui` 的两条断言按新页面契约更新**（`scripts/verify-desktop-ui.mjs`）：
   旧断言保护的是「实验详情可展开 / 比较规则提示」——本页已按要求重做信息结构，
   等价不变量改为「实验对可展开条件矩阵与证据」「四类结论都在页面上」「首屏写明不是排行榜/不做排名」。
   同时把「只看有证据关系」的断言改成「有隐藏才要求写明原因」：本轮按规程升规则版本并重算缓存后，
   10 条缓存关系全部带已定位引文，隐藏数自然为 0（数据状态变化，非行为回归）。
4. **「只看有证据关系」下隐藏数为 0 时状态行曾为空**：已改为显式显示「隐藏 0 条：当前收窄条件下没有被隐藏的关系」，
   让「筛选是否生效」可判断，同时与既有断言的不变量自洽（`verify:ui` 44/0）。
5. **窄屏顶部导航换行难看**（`视觉方法演进案例 / 返回论文集合` 在 390px 竖排）：
   这是**站级**窄屏问题（项目已知项），本页自身在 390px **无横向溢出**（实测 `scrollWidth == clientWidth == 390`）。未动。
6. **未运行**：`npm run e2e`、`scripts/browser-flow-check.mjs`（真实模型调用）、`scripts/auth-error-check.mjs`。
   原因：真实模型链路需要可用额度与人工介入，本轮未执行 ⇒ **不声明它们通过**。
   本轮所有浏览器结论都来自自建脚本 `.build/exp-shot.mjs`（真实 Chrome + 真实交互）与既有 `verify:*` 脚本。
7. **#28 的压缩炸弹风险如实说明**：本轮只做了字节预算、`%PDF-` 校验、页数早停、`destroy()` 与取消等**资源硬化**；
   **没有**声称存在或不存在具体的压缩炸弹漏洞（未做攻击性验证）。

## 3. 测试命令与实际结果

| 命令 | 实际结果 |
|---|---|
| `npm run typecheck` | ✅ 通过（0 错误） |
| `npm test` | ✅ **通过 605，失败 0**（基线 483 → 新增 122 条：§38–§43） |
| `npm run build` | ✅ 通过 |
| `npm run verify:ui` | ✅ 通过 **44，失败 0** |
| `npm run verify:layout` | ✅ 通过 **89，失败 0** |
| `npm run verify:import` | ✅ 通过 **26，失败 0** |
| `npm run verify:scope` | ✅ 通过 25，失败 0 |
| `npm run verify:reload` | ✅ 通过 20，失败 0 |
| `npm run verify:relations` | ✅ 通过 16，失败 0 |
| `npm run verify:mobile` | ✅ 通过 3，失败 0 |
| `.build/exp-shot.mjs`（自建：真实 Chrome + 真实交互，10 张截图） | ✅ 跑通，见 §4 |
| `npm run e2e` / `browser-flow-check.mjs` / `auth-error-check.mjs` | ⏳ 未运行（见 §2.6） |

> 首轮的三处失败都不是「页面坏了」，而是**断言绑定了旧契约或旧数据状态**，已逐条说明并修正（见 §2.2 / §2.3 / §2.4）：
> `verify:import` 25/1 → 26/0（页面补回换语料入口）；`verify:ui` 36/6 → 44/0（2 条数据状态 + 4 条旧页面断言）；
> `verify:layout` 81/8 → 89/0（新增文字违反 12px 字号下限）。

## 4. 页面截图（首屏如何回答「能否比较」）

截图目录：`.build/shots/`（脚本 `.build/exp-shot.mjs`，真实浏览器 + 真实交互，空闲端口 + 退出兜底 kill）

| 文件 | 展示的状态 |
|---|---|
| `exp-1440x900-01-首屏.png` | **首屏直接回答**：当前范围（案例/own）+ 论文 5 篇 / 实验记录 23 条 / **实验对 253 个**；一句概况「0 对可直接比较、0 对只能结合条件讨论、72 对信息不足、181 对不能直接比较；信息不足主要卡在 表格行列对应/测试时增强/评估划分/蒸馏 —— 补这些能解锁最多比较」；四类结论卡各带解释 |
| `exp-1440x900-02-四类结论.png` | 四类结论分区与计数（可点开筛选） |
| `exp-1440x900-03-不能直接比较-条件矩阵.png` | 「不能直接比较」实验对：条件矩阵逐维判定 + 「原始报告值（仅供核对，不构成对照）」 |
| `exp-1440x900-04-条件矩阵与证据.png` | 条件矩阵 + 原文证据（引文定位状态 / 表格行列待核查 / 查看原文上下文） |
| `exp-1440x900-05/06-信息不足-补充入口.png` | 「信息不足」的原因清单 + **补充入口**（必须填具体值与来源；「仅标记已核对」不参与判定） |
| `exp-1440x900-07-补充后结论升级.png` | **真实补充 5 项后，该对从「信息不足」升级为「只能结合条件讨论」**（条件差异 1：输入分辨率 224 vs 384），人工补充值以「人工补充」标签与原 AI 值并列展示 |
| `exp-390x844-08/09-窄屏*.png` | 窄屏 390×844（本页无横向溢出） |
| `exp-1440x900-10-own范围-空实验记录.png` | own 范围：真实上传一份 PDF（未配模型，解析成功但无实验记录）+ 上传入口 + 「解析成功 ≠ 分析成功」的说明 |

> 截图里的「0 对可直接比较 / 0 对只能结合条件讨论」是**这份语料的真实结论**（未知项太多，见常识）：
> 没有为了好看去补数据。它同时证明了页面不会给出假的正面结论。

## 4.1 追加变更（同日稍后，用户当场决定）：研究地图去掉两个重复入口

用户看到研究地图页头的三视图切换条（方法地图 / 关系与比较 / 阅读起点），指出右侧两项与独立页面重复。
核实后同意删除，并按用户选定方案实施（**不是简单删按钮，而是把唯一独有的能力先搬走**）：

| 被删的子视图 | 独有内容 | 承接方 |
|---|---|---|
| 关系与比较 | 两方法对照表 + **关系明细（全部 N 条）整表** | 对照 → 「跨论文比较」页；**整表已搬到「方法关系」页**（`Graph.tsx` 关系图下方新增「关系明细（N 条）」，含证据状态与「查看原文」） |
| 阅读起点 | 阅读顺序（= plan.steps）+ 值得继续调查的问题 + 生成入口 | 「阅读路线」页 + 「待调查问题」页 |

- `MapView.tsx`：删切换条与两个子视图分支、删整块「对照选择」状态（不留无人读写的死状态）、
  `SubView` 收成 `'map' | 'timeline'`；新增 `onGoGraph`；页头保留「跨论文比较 →／阅读路线 →」两个真实出口。
- `MapNetworkView.tsx`：三个入口改为**跳独立页**并改名 —— `onAddToCompare→onGoCompare`（文案从「加入对比队列」
  改为「去跨论文比较」，**不假装已加入**）、`onOpenRelations→onGoGraph`（「关系明细与依据」）、
  `onOpenStart→onGoDecision`（「阅读路线」）。
- `MapRelationsView.tsx` / `MapStartView.tsx`：不再被渲染，文件头写明「已停用 + 承接页面 + 恢复方式」。
- `scripts/e2e-check.mjs`：原断言「首屏必须有三个视图切换与一个阅读起点链接」→ 改为「标题 + 一句解释 +
  通往独立页面的出口」，并**反向断言**页面不再出现那两个视图名（防回归）。
- 用户另问「关系能不能像论文节点那样点一下就开」——**本来就支持**：关系连线可点开详情（引文/页码/理由/可否核验），
  键盘 Enter 同样可以；`verify:ui` 有对应断言，未重复开发。
- 复验：`npm test` 605/0 ｜ `typecheck` ✅ ｜ `build` ✅（app.js 970KB → 955KB）｜ `npm run e2e` **78/0** ｜
  `verify:ui` 44/0 ｜ `verify:layout` 89/0；截图 `.build/shots/map-01-去重后首屏.png`、
  `map-02-方法关系页-关系明细表.png`（脚本 `.build/map-shot.mjs`，含探针断言：地图页无「关系与比较/阅读起点」、
  方法关系页出现「关系明细（10 条）」且 10 行）。

## 4.2 追加修复（用户实测两个缺陷，2026-10-13 下午）

### 4.2.1 「提取卡住、反复点结果一样」——任务版本号是 NaN，每次首次抽取都被静默丢弃

- **入口级复现**（`.build/repro-extract.mjs`，真实 PDF + 真实模型）：页面从 t+0 就定格在
  「本轮分析已结束，还有步骤未完成 / 步骤 03 提取方法字段 (2/6) 33%」，点按钮只闪一下
  「正在深度分析方法论…」又回到原样 —— 与用户截图完全一致。
- **决定性证据**（加临时探针：应用日志同时进 console，用 CDP 抓）：
  ```
  模型调用 extract:p_8f9713 第 1 次：10700ms，输入 30874 字符，输出 7825 字符
  校验：字段有值 6/7、可核验 6/7；实验条件可核验 7/9
  抽取结果作废：期间该论文已被删除、重新解析或重新发起抽取（不写回…）
  ```
  **模型 10.7 秒就成功返回了**，结果却被判「已失效」丢掉。
- **根因**（一行代码把功能整个打死）：
  ```js
  const seq = ++extractSeq.current[paperId];              // 首次抽取时该键不存在 ⇒ ++undefined ⇒ NaN
  const stillLatest = () => extractSeq.current[paperId] === seq;  // NaN === NaN ⇒ 恒为 false
  ```
  ⇒ **每一次「首次抽取」都被判过期丢弃**（另两处自增用的是 `(值 ?? 0) + 1`，一直是对的）。
  而丢弃分支只 `delete 锁` + `return`，**没有把 job 推到终态** ⇒ 文件卡永远停在「提取中：…」、
  步骤 03 永远进行中 ⇒ 用户看到的就是「提取卡住，反复点一样」。
- **修复**：
  1. 新增 `src/core/taskSeq.ts` 作为唯一实现：`bumpSeq()`（显式从 0 起算）+ `seqIsCurrent()`（**NaN 一律判 false**），
     App 三处（抽取 / 重新解析 / 移除）全部改用；
  2. 三个作废分支统一走 `discard(reason)`：**同时把 job 置为 canceled 并写明原因**；
  3. 上传页把 canceled 如实显示（卡片「本次抽取已作废：…」、步骤 03 计入「本轮没成」并保留可点的重试）。
- **验证**：修复前永久停在 2/6 33%「提取中：校验…」；修复后 → **文件卡「已完成：字段与证据已生成」、
  进度 5/6 83%**（关系分析自动接上）；连点 3 次全部 `disabled`。回归：`tests/core.test.ts` §44（7 条）。
- **同时修的次要问题**（不是主因，但确实会造成状态混乱）：
  - `analyzeFiles` / `extractMany` 只有单篇锁、**没有批次锁** ⇒ 反复点击会起多个重叠批次，
    各批次 `finally { setPhase('done') }` 会在别的批次还在跑时把进度卡翻成「本轮分析已结束」。
    现在两条路径共用 `locks.current.batchExtract`，并在 `finally` 里保证释放；
  - `UploadFlowView` 引入 `busy = phase==='running' || 任一篇 job.running`，
    **进度卡标题、主按钮文案与禁用、移除文件、重跑提取、模型配置后的接续**全部改用 `busy`；
  - 新增**真实等待秒表**：`JobState.at` + 每秒 tick，卡片与进度卡显示「已等待 X 分 Y 秒（单次调用上限 180 秒）」。

### 4.2.2 「切到待核查，地图变成一条竖着的线」——布局跟着筛选重排

- **根因**：`MapNetworkView` 的布局直接使用 `relations`，而 `MapView` 传进去的是**按可见性筛过**的关系。
  筛「待核查」时只剩 3 条 `similar`（一条有方向的边都没有）⇒ 深度分层把 5 个节点全算成第 0 层
  ⇒ 所有节点 `x` 相同、`y` 逐行排开 ⇒ **一条竖线**。筛选只该决定「画哪些连线」，不该决定「节点摆在哪」。
- **修复**：新增 `allRelations` prop（完整集合，仅供布局与节点半径），`MapView` 传
  `allRelations={view.relations}`；`relations`（筛过的）仍然只用于画线。
- **验证**（`.build/probe-map-layout.mjs`，直接读画布 `circle` 的 `cx`）：三档筛选下节点横坐标
  **完全一致 `[120,310]`**，而连线数按筛选正确变化 10 → 7 → 3。
- **回归守卫**：`scripts/verify-desktop-ui.mjs` 新增断言「切换待核查不改变节点位置」（现 46/0）。

## 5. 数据迁移与人工修正保留情况

- **规则版本**：`RULES_VERSION` r3.3.0 → **r3.4.0**（similar 措辞要求 + 分歧成立条件）。
  按项目规程对三份预置缓存执行 `node scripts/revalidate.mjs --out public/samples[-vision|-vision-core]`，
  结果写回并记录在 `docs/REVALIDATION.md`（视觉 10 条关系状态变化 0 条；vision-core 校验问题 7 → 5）。
- **人工修正保留**：
  - 字段修正（`overrides`）——案例加载仍按同 ID 合并（`mergeCachedMethods`），重分析只替换 AI 字段值；
  - 实验条件补充（`supplements`）——按 `experimentIdentityKey`（含划分/分辨率/单位）**一一对应**搬运；
    条件变了即失效（val→test 不再带旧确认）；同模型同指标的多条不再互相覆盖；
  - 「已核对」标记（`userSupplemented`）——语义收紧为**纯标注**，不再参与任何判定；
    旧数据里的标记仍会显示，但不会把未知值变成已知；
  - 人工关系（`userEdited`）——不在本轮改动范围内，`verify:relations` 16/0 复测通过。
- **旧缓存兼容**：分析产物快照升级为带 `scopeKey`；**只有 corpusId 的中间格式一律不复用**
  （宁可显示「尚未生成」，也不拿别的范围的结论冒充），有单测断言。
- **不确定项如实保留**：`verification` 缺失 → 按未确认处理；表格行列由人工声明时，会在结论里挂
  「人工声明、非程序核验」的注意事项。

## 6. 本轮新增的回归用例（能发现真实缺陷，非填充）

`tests/core.test.ts` §38–§43（+122 条断言）：
- IndexedDB：请求成功但事务 abort ⇒ reject 且不落库；跨表事务中途失败整体回滚；并发 `appendUsage` 不丢；坏结构按「没有」处理。
- 比较引擎：未知值词表（含**刻意不把 `none`/`无` 当占位**）；双方空划分；缺核验元数据；指标阈值/对象/单位换算/
  数据集版本/复合来源/分辨率；数值解析 6 种形态；计数对象分开；分组隔离；**排列不变性**；协议未知≠协议不同；
  表格行列三档（程序核验/人工声明/未确认）。
- 引文：前 120 字 + 虚构尾部 → partial、coverage<1、引文不被替换；完整命中仍通过。
- 关系：基线句不得认证相似；真措辞仍通过。
- 分歧：缺双方主张/缺类型/单方/引文不可定位 → 一律不认定为结论分歧。
- 人工补充与身份：值与来源必填；标记不改变未知；val→test 失效；多实验一一对应。
- 模型输入：真实调用 `generateDecision` 并**抓请求体**，断言用的是人工修正后的有效条件、且被标注为非原文核验。
- 缓存结构：`isCachedCorpusIndex` / `isCachedPaperText` 拒绝 4 类坏结构、接受两份真实缓存。
