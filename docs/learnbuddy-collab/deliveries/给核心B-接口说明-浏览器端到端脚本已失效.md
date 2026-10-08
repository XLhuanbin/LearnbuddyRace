# 给核心 B 的接口说明（三）：两份浏览器端到端脚本已失效，及对应验证记录已过期

- 发现者：核心 A（2026-10-08，用户要求「跑一下真实的浏览器端到端」时发现）
- 归属：00 文档第 34 行把「导入、刷新恢复、缓存迁移、语料隔离**和对应验证脚本**」划给核心 B
  ⇒ **核心 A 不修改这两份脚本**（本阶段也不做 UI），只提供诊断与精确修复清单
- 性质：**不是**核心 A 本轮改动引起的；自 `c647794`（2026-09-25）起就一直如此

---

## 1. 复现

```bash
npm run build                                   # 脚本依赖 dist/，必须先构建（本次构建指纹 977c356f5c）
node scripts/browser-flow-check.mjs --pdf samples/pdfs/2006.11239.pdf
```

实际输出（本次实测，exit=1）：

```text
=== S1 打开应用并在设置页填入接口（密钥不回显）===
  ✓ 应用加载完成
  ✗ 进入设置页（出现接口配置表单）
  ✗ 设置页有输入框（找到 0 个）
验证异常： Error: TypeError: Illegal invocation
    at Cdp.evaluate (scripts/browser-flow-check.mjs:124)
    at async main (scripts/browser-flow-check.mjs:242)
```

`Illegal invocation` 只是**下游症状**：脚本没找到设置入口 → 点击没发生 → 设置页没渲染 →
`inputs = 0` → 接着 `els[1]`（undefined）被喂给 `HTMLInputElement.prototype` 的 value setter 就抛了这个错。

## 2. 根因：导航改版，脚本仍在找已经不在的侧栏

- 脚本用 `document.querySelectorAll('button.nav')` 找「设置」「论文库」——那是**左侧栏**的按钮。
- 但 `c647794`「feat(ui): 工作页重构 — **目录导航/无侧栏** + 地图去卡片化 + 各页首屏精简」（2026-09-25）
  之后，`src/ui/mapChrome.tsx` 导出的 `AppSideNav` **已不再被任何地方 import**（`App.tsx` 只 import 了 `AppBrandBar`），
  侧栏成了死代码 ⇒ 页面上根本没有 `button.nav`。
- 现在导航在**顶栏**：`button.dirbtn`（「目录」）展开出 `button.diritem`，设置项是
  `['settings', '设置', 'settings']`（`mapChrome.tsx` 的 `DEV` 列表）。

## 3. 影响（这条比脚本本身更要紧）

两份验证记录是**过期证据**，不再对应当前界面：

| 记录文件 | 声称的验证 | 最后写入 |
| --- | --- | --- |
| `docs/BROWSER-FLOW-VERIFICATION.md` | 真实浏览器 + **真实模型调用**的端到端（上传→抽取→证据→保存→刷新恢复） | 2026-09-23（早于 `c647794`） |
| `docs/AUTH-ERROR-VERIFICATION.md` | 鉴权失败路径（本地 mock 401） | 2026-09-23（早于 `c647794`） |

也就是说：**这两份记录自 09-25 起就没有再被复现过**，而 `auth-error-check.mjs` 与
`browser-flow-check.mjs` 用的是同一批失效选择器（`button.nav`），所以两者都跑不通。
另外 `browser-flow-check.mjs` **不在 `package.json` 的 scripts 里**、也不在 01 文档的验收清单里，
因此很容易被漏掉（核心 A 自己在做上传走查时就先漏了它）。

## 4. 精确修复清单（供核心 B 参考，我未改动任何一行）

1. **设置入口**（`browser-flow-check.mjs:235`、`auth-error-check.mjs:211`）
   `[...document.querySelectorAll('button.nav')].find(x => x.textContent.includes('设置')).click()`
   → 改为先展开顶栏目录再点：先 `document.querySelector('button.dirbtn')`（不存在时退回任意「目录」按钮文本匹配），
   等 `button.diritem` 出现后再点文本含「设置」的那一项。
2. **论文库入口**（`auth-error-check.mjs:228`）：同上，`button.nav`('论文库') → `dirbtn` + `diritem`('论文集合')。
   注意标签已从「论文库」变成「**论文集合**」。
3. **「保存后侧栏显示已配置」**（`browser-flow-check.mjs:273`）：「模型接口已配置」这句现在只存在于
   **已死的 `AppSideNav`** 里，页面上没有等价文案。建议改断言为「论文库的『**未配置模型**』提示条消失」
   （该提示条在 `Library.tsx` 里只在未配置时渲染），或检查 `SaveConfig` 的门面状态。
4. **「刷新后侧栏未显示模型未配置」**（`browser-flow-check.mjs:418`）：同 3 的替换。
5. **`.paper-head`**：当前界面已无此类名，需按现在的上传/方法提取页容器类名替换
   （脚本里 S2/S3 依赖它定位论文卡）。
6. 修好后请**重新跑一次并更新那两份记录**（或在记录顶部明确标注「本节对应 09-23 的界面，已验证失效」），
   避免团队继续引用过期证据。

## 5. 核心 A 这边已经用命令行路径验过的部分（可作为对照，不代替浏览器端到端）

- 真实模型抽取/关系/分歧/决策：`node scripts/analyze.mjs --spec <spec> --out <独立目录>`，
  已用非预置论文（DDPM `samples/pdfs/2006.11239.pdf`）实跑：字段可核验 7/7、条件 5/9、
  4 条实验记录（引文已定位、行列已确认、无数值缺失）、跨语料比较命中任务/数据集/指标三条硬阻断；
  产物留在 `.build/`，不碰预置缓存。
- **缺的仍然是「浏览器里点一遍、由页面自己调模型」那一次**——那正是这两份脚本要负责的，现在跑不了。

## 6. 边界

核心 A 本轮**只写这份说明**：未改 `scripts/browser-flow-check.mjs`、`scripts/auth-error-check.mjs`、
`docs/BROWSER-FLOW-VERIFICATION.md`、`docs/AUTH-ERROR-VERIFICATION.md`、任何 UI 文件。
如果核心 B 决定由我来改这两份脚本（它们本质是「导入/刷新恢复」的验证），说一声即可 —— 修法清单已在上文，
但按 00 文档的归属应由你们先确认。
