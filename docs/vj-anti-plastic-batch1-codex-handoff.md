# VJ 去塑料感第 1 批 — Codex 交接（2026-09-26）

已改造 `61.html` 的 10 条 Top 20 Premium 隧道：`vjLiquidGrid`、`vjNeonRibbon`、`vjPrismShards`、`vjFractalWell`、`vjTentacleTunnel`、`vjBioMembrane`、`vjVoidNebula`、`vjEventHorizon`、`vjDataBloom`、`vjNeonArches`。已加入 `app/tests/vj-anti-plastic.spec.js` 的 `CONVERTED`。

## 改动

- 实体分别换成金属、缎面或玻璃预设；适用方块改用共享倒角几何，并补受光灯组和实例化视锥设置。
- 保留光线、星核、等离子和拱门灯芯的发光身份。`vjPrismShards` 仅在 low 档叠一层自发光，以补足 matcap 的弱反射；balanced / ultra 只绘制玻璃碎片，避免透明层重叠造成软件渲染慢帧。
- 逐条调颜色、透明度与 bloom。`vjEventHorizon` 的吸积粒子覆盖率提高；`vjNeonArches` 加了可见灯芯；`vjVoidNebula` 的气团继续保持半透明背景。
- 没有新增按槽位编号决定的外观，所以本批没有增加连续性测试。

## 验证

- `vj-anti-plastic.spec.js` 的结构与三档画面测试均通过；10 条在三档的 lit 均为 40%–90%，vivid > 50%，hues > 5。
- `vj-tunnels.spec.js` 的全 50 条鲜艳度与前进方向测试通过。最后一次 `vjPrismShards` 为 lit 43.1%、vivid 94%。
- `bg3d-performance-budget.spec.js` 的 Top 20 Balanced 慢帧预算、全部 50 条三档预算均通过。
- 同一批最初的完整指定测试中，其余连续性、深度、循环、材质预设测试均通过。画面和性能调参后的相关测试已单独复跑通过。
- `replacement/61.html` 已从根目录同步，`verify-replacement.ps1` 通过，SHA256：`89512EE6361B3575A659373B00C72B29EB756B7463B81C7926E17C2EC34EAC69`。

## 对比图

- 改前：`vj-shots/batch1-before/`（三档各 10 张，全图和局部图共 60 张）。
- 改后：`vj-shots/batch1-after/`（相同设置，共 60 张；星云和碎片在最后调参后已重拍）。
- 截图命令使用 `--crop 0.62,0.35`，与 `HANDOFF.md` 的验收流程一致。

请 Claude Code 做这批的最终视觉审查及对比页面。本批未提交 Git commit；工作区同时有其他文件的并行改动，本批只涉及 `61.html`、`replacement/61.html`、`app/tests/vj-anti-plastic.spec.js` 和本交接文件。
