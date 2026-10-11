# 论文集合页按草稿 6db41280 表格化（2026-10-11）

目标：把「论文集合」按草稿 `6db41280`（ResearchPilot - 论文库主页，v1）逐元素重做。

结论先行：**页面完成，全部验收绿** —— `npm test` 478/478、`e2e` 76/76、
`verify:ui` 40、`verify:layout` 79、`verify:scope` 25、`verify:import` 26、
`verify:reload` 20、`verify:relations` 16、`verify:mobile` 3、
`auth-error-check` 7、`browser-flow-check`（真实模型）51 —— **0 失败**。
连带清掉了此前遗留的「研究地图改版后验收脚本选择器失效」技术债（原 e2e 8 项失败 + verify:scope 2 项 + 两个脚本崩溃）。

---

## 一、版面（照草稿逐元素）

eyebrow「PAPER REPOSITORY」+ 4xl 衬线标题「论文集合」→ 右上三按钮
（跨论文比较 / 生成阅读路线 / 上传新论文，前两个接真实的「关系与比较」「阅读起点」页）→
四张统计卡 → 12 栏（9 + 3）：左＝白卡表格（全选 / 筛选 / 搜索 / 排序，表头 论文标题·方法族·创新度·操作），
右＝创新度分布（stat-bar）+ 智能路线规划（accent 底 CTA）+ 近期动态；页脚。

## 二、草稿编造内容 → 真实数据（逐条）

| 草稿 | 换成 |
| --- | --- |
| 「12 篇」 | 当前语料真实篇数（scope 计数，不用 `papers.length`） |
| 「平均创新评分 8.1」 | 真实 `assessment.innovation` 均值；未评估的篇数单独标注，不冒充 0 分 |
| 「待处理问题 04」 | **待核查关系**条数（这是我们真实能报的量），并改名以对齐语义 |
| 「最近分析时间 2小时前」 | 最近一次 `extractedAt` 的相对时间；无时间戳写「未知」 |
| 「核心作者 Vaswani et al.」 | **方法族**（真实家族判定；多页复用的同一个缺失，统一换法） |
| 「NEURIPS / NAACL」 | 真实来源标注（arXiv / PDF 上传 / 粘贴导入） |
| 「用户协议 / 隐私政策」页脚 | 真实入口（返回首页 / 偏好设置 / 研究地图）—— 我们没有那两个页面 |

## 三、按篇操作的迁移（表格化的代价，全部有去处）

行内只留「查看报告」；原先挂在展开行里的功能全部迁到**分析结果页**：

- **重新分析**（原「更多操作」）：结果页「本篇操作」，两步确认（提示消耗额度 / 保留原结果 / 人工修正不会被覆盖）
- **移除本篇**：结果页，两步确认；**撤销条从论文集合局部状态上收到 App 全局**（否则从结果页移除后无处撤销）
- **字段与人工修正 / 实验条件表 / 程序校验问题表**：结果页各自分区（实验条件与校验问题是本轮补迁的，
  表格化时曾漏掉——没有它们，结果页比旧展开区少了关键证据）
- **失败态可见**：结果页空态分支也要显示 job 失败原因（鉴权失败的可读提示不允许静默）

## 四、样式作用域（踩坑记录）

- 草稿 style 块 scope 到 `.libpage`，并加进 draft.css 既有的 preflight 补齐组（`:is(.uppage, .rspage, .mapnet, .libpage)`）
- **补齐块必须用 `:where()` 降特异性** —— 但还不够：本文件在 `@tailwind utilities` **之后**，
  同特异性时后写的赢。实测 `.content-card` 的背景把工具类 `bg-[var(--accent)]` 压成白色（「智能路线规划」卡变白卡）。
  ⇒ **不设 background**（草稿里每张卡都自带 bg 工具类），只留 border/padding/shadow
- 外壳加 `.main.libmain` 通栏（内容宽交给页面自己的 `max-w-[var(--content-max)] = 1280px`）

## 五、无障碍回归（新画布补回）

`MapNetworkView` 的节点原本不可键盘聚焦（旧地图有这能力）。已补：`tabIndex` + `role="button"` +
Enter/Space 选中 + `:focus-visible` 焦点环。顺带修了一个真 bug：
**三态筛选对画布不生效** —— `MapView` 传给新画布的是全量关系，画布自己又画了一遍；
改为传 `view.relations.filter(relVisible)`，与页头「当前显示 N 条」同一份筛选。

## 六、验收脚本同批迁移（11 份）

`.paper-title` / `.lrows .lrow` 作为**稳定钩子保留**（新表格行上原样带着这两个类），
改动的是流程断言：

| 脚本 | 改动 |
| --- | --- |
| e2e-check | 论文库段按新结构重写（统计卡 / 行结构 / 结果页字段与条件 / 本篇操作 / 两步确认）；地图段换 `#map-canvas svg g.cursor-pointer`，节点名断言代替已不存在的泳道 |
| verify-import-flow | 重新解析入口改到结果页（含刷新后分支） |
| verify-cache-reload-safety / verify-scope-flow | 查看详情→查看报告；移除两步确认改到结果页；连线计数从 `path[marker-end]` 改为 `line`（similar/unclear 的边没有箭头） |
| verify-desktop-ui | 地图段按新画布重写；键盘断言保留（节点已可聚焦） |
| auth-error-check | 上传后走 查看报告→分析方法字段；按钮文案加「开始梳理脉络」 |
| browser-flow-check | 抽取 / 字段面板 / 证据 / 人工修正 / 重新分析 全部改走结果页；「恰好一次调用」的日志计数判据换成「结果页如实标注本次实时分析」 |

**仍然红的老脚本（非本轮引入，也不在本轮范围）**：`demo-walkthrough` / `demo-walkthrough2` / `demo-walkthrough4`
—— 它们断言的是两轮之前的首页与地图（「首屏两个 CTA」「泳道命名」等），早在 v8 首页与新画布落地时就已过期；
这是历史走查脚本，不是验收入口（验收入口见 `docs/VERIFICATION.md`）。要不要修，留待用户决定。

## 七、验证数字（本机实跑）

| 项目 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | **478/478** |
| `npm run build` | 通过，构建指纹 `4d7e1ddb76` |
| `npm run e2e` | **76/76**（含此前 8 项地图失败，已全部修复） |
| `verify:ui` | **40/40**（此前崩溃） |
| `verify:layout` | **79/79** |
| `verify:scope` | **25/25**（此前 23/25） |
| `verify:import` | **26/26** |
| `verify:reload` | **20/20** |
| `verify:relations` | **16/16** |
| `verify:mobile` | **3/3**（此前崩溃） |
| `auth-error-check` | **7/7** |
| `browser-flow-check`（真实模型） | **51/51** |
