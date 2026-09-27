# 去塑料感第 4 批:退回 6 条(2026-09-27,Claude Code 验收)

**第 4 批没有提交。** 工作区里还是你这一版,在它上面继续改。VoxelPulseTerrain、UltravioletHiveRush、WaveCorridor、StarLane 这 4 条可以,不要动;下面 6 条要返工。

**交回时验收测试是挂的**:`vj-anti-plastic`(15 格不达标)、`vj-five-depth`(Kaleido)、`vj-tunnels`「每个隧道都画得出鲜艳的画面」(Kaleido),以及 Neon Reactor Descent 自己的专用测试 `vj-neon-reactor-descent.spec.js`。HANDOFF 要求验收测试全部通过才交回,有失败要在交回时说明。**这次交回时请把测试结果的最后几行(通过/失败数)一起贴出来。**

对比网页:`vj-shots/review-batch4/index.html`。

## 共同原因:金属的颜色亮度开太高

好几条把受光材质的实例颜色亮度调到了 0.65 以上(Kaleido 0.66、HexPulse 0.65、NeonGeometryTunnel 节点 0.68、ReactorDescent 0.57/0.67)。HANDOFF「视觉上反复踩过的坑」第 1 条:**HSL 的 lightness 一过 0.5,颜色就朝白收敛**。金属上的结果是一片粉彩色或灰白色 —— Kaleido 的饱和度从 100% 掉到 48%。想亮,靠灯组、bloom、发光芯,不要靠把颜色推向白。

## 逐条(数值是 balanced,括号里是改前)

| 隧道 | 问题 | 要的方向 |
|---|---|---|
| vjKaleido | lit 35.1%(51.6%)、vivid 48%(100%)。原来是鲜艳的彩虹螺旋,现在是发灰的粉彩方块。同时挂了 `vj-five-depth` 和 `vj-tunnels` 的鲜艳度 | 万花筒靠色彩撑场面:颜色饱和度拉回来、亮度压到 0.5 以下,用 bloom / 发光芯补亮度 |
| vjHexPulse | lit 21.0%(29.6%),比改前还暗;方块发灰 | 同上。槽位编号的修复和它的连续性测试要保留 |
| vjRingWorldRun | lit 23.5%(29.9%),改前就不到 40%,改完更暗 | 让圆环带和碎片读得出来 |
| vjNeonGeometryTunnel | lit 32.5%(32.7%),画面几乎没变 | 改前就不到 40%,这条需要真的改 |
| vjAsteroidSlalom | balanced/ultra lit 35.3%(low 52.3%) | 高画质不能比 low 暗 |
| vjNeonReactorDescent | 画面太满:lit 85.5%(56.1%),暗部只剩 10%,专用测试要求 > 15% | 墙体压暗,把纵深的黑留出来,lit 回到 87% 以下 |

**不要为了过下限去堆满画面**(第 3 批 DustShaft 的教训)。上面这几条如果按正确的方向做完,某一条确实过不了 40%,停下来告诉我们是哪条、数值多少,由用户决定;不要自己改 `LIT_FLOOR`。
