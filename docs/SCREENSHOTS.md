# 走查截图说明（仅本地保留）

本仓库**不收录**界面走查截图（`docs/**/*.png`），原因：

- 截图是开发过程证据，体量较大（约 39 MB / 319 张）；
- 赛事要求的「AI 工具使用记录」提交的是**与 LearnBuddy 的真实对话记录**，不依赖仓库内截图；
- 因此截图只保留在作者本机；仓库里保留的是同一批走查的**文字记录**
  （各轮 `WALKTHROUGH.md`、`docs/STATUS.md`、`docs/VERIFICATION.md`），文字记录里写明了截图文件名与目录。

## 本地重新生成截图

```bash
npm run build
node scripts/ui-audit.mjs --out docs/ui-audit                          # 全站页面走查截图
node scripts/demo-walkthrough4.mjs --out docs/demo-walkthrough-v7-live # 两条真实路径走查（含截图）
```

目录命名：`docs/demo-walkthrough-v<N>[-live]/`（按轮次）、`docs/ui-audit*/`（界面走查）。
