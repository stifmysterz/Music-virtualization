# Handoff to ChatGPT desktop — 升级现有 VJ 效果质感（2026-09-25）

写这份文档时:`main` 已同步到 `origin/main`(`3838c84`),工作树干净,`dist/` 已用最新源码重新打包并通过哈希核对。上一轮(视频混合模式 / VJ 自动切换与预热 / 自适应画质 / VJ 菜单搜索)已经 commit + 打包 + 验证 + 推送完毕。Claude Code 现在停手,`61.html` 交给你独占修改,不要两边同时改。做完后把改了哪些文件、跑了什么验证告诉用户,Claude Code 会用 `git diff` + 测试 + 三方哈希核对,不是假设你做对了。

## 这一轮做什么

**不新增效果,只升级现有 VJ 隧道的材质/打光/相机运镜质感。** 50 条里有 20 条已经进了 Top 20 Premium 编舞名单(`src/vj/premium-meta.json`),另有 7 条("金属"组:`vjChromeTube`、`vjMetalTwist`、`vjChromeDrips`、`vjFoilCrumple`、`vjChromeBubbles`、`vjLiquidSpine`、`vjRustPipes`)已经有真实 PBR 材质+环境反射测试锁着(`app/tests/vj-tunnels.spec.js` 里"7 个金属 VJ..."那条)。剩下没升级过的里,挑了 5 条画面偏亮、缺纵深或色调单一的,数据来自 `vj-tunnels.spec.js`"每个隧道都画得出鲜艳的画面"那条测试打印的 `lit`(高亮像素占比)/`hues`(色相档数)诊断行:

| kind | 当前 lit | 当前 hues | 问题 |
|---|---|---|---|
| `vjStarLane` | 99.9% | 39 | 亮度顶到天花板,完全没有暗部,隧道纵深感几乎没有 |
| `vjSpeedGates` | 98.4% | 11 | 同样顶到天花板,而且色相档数偏少,画面发单调 |
| `vjPlasmaRings` | 96.1% | 25 | 太亮糊成一片,vivid 只有 74%(全场景里偏低) |
| `vjNeonTubeRoom` | 95.4% | 4 | 亮度高且几乎是单一色相,整场看起来像一种颜色 |
| `vjKaleido` | 94.4% | 39 | 亮度顶到天花板,万花筒本该最靠色彩层次撑场面 |

CLAUDE.md 和下面"视觉上反复踩过的坑"第 4 条说得很清楚:`lit` 建议落在 40%~90%,不要冲到 100%。这 5 条现在全部超出这个区间,说明缺前后景明暗对比、材质没有暗部响应,纯靠自发光堆亮度。

**做法建议(不是强制,你按效果实际情况判断)**:
- 压暗背景/远景,把亮部留给近景高光和 bloom 命中的边缘,而不是让整个隧道自发光饱和度拉满。
- 参考 Top 20 Premium 或已有金属组的打光结构(2+ 方向光 + 1 hemisphere 补光,而不是纯 emissive)。
- `vjNeonTubeRoom` 和 `vjSpeedGates` 色相档数太少,可以加一条互补色的强调光带或分层配色,不必大改几何。
- 相机运镜如果目前只是匀速前进,可以按 CLAUDE.md 第 6 节加一点 banking/景深变化,让"这条隧道被认真设计过"的感觉更强,不必是大改。

**不要动的**:另外 25 条没提到的非 premium/非金属隧道(`vjHexPulse`、`vjWaveCorridor`、`vjCubeMatrix`、`vjGridMorph`、`vjCyborgCorridor`、`vjRaceTrack`、`vjHoverCity`、`vjCandyOrbs`、`vjLightWell`、`vjAsteroidSlalom`、`vjRingWorldRun`、`vjIonTrail`、`vjDerelictHall`、`vjShatteredPanes`、`vjDustShaft`、`vjCollapsedGrid`、`vjVoxelPulseTerrain`、`vjNeonGeometryTunnel`、`vjBlackGoldFluid`、`vjUltravioletHiveRush`、`vjNeonReactorDescent` 等)这轮先不碰,留到下一批。

## 必须保留(不能减少/破坏)

- 完整 2D Visualizer
- 现有 **61+ 个 3D 效果**(效果数量修改后不能少于修改前)
- 现有 VJ Loops,尤其是"金属组"7 条已经锁住的 PBR 材质测试判据(见上)不能被这次改动波及退步
- `source/`、`assets/`、`shaders/` 三个目录下的全部内容原样不动
- 无缝循环契约(depth-wrap/BPM phase)不能破——这轮是材质/打光/相机的调整,不是重做几何或运动逻辑

## 改这几条效果时——不要手改生成块

`61.html` 里有几段由脚本从 `src/` 下的"源数据"生成的代码块,用 `/* ..._START */ ... /* ..._END */` 标记包起来。手改这些块会被对应的 `*-source.spec.js` 测试拦下来(专门防止源数据和 `61.html` 漂移)。这轮改的是材质/灯光/相机,大概率不需要碰这些块;如果顺手把某条也纳入 Top 20 Premium 编舞或改了它的循环契约,才需要走下面的同步流程:

| 要做什么 | 改这个源文件 | 跑这个命令(在 `app/` 目录下) |
|---|---|---|
| 让某条 VJ 进 Top 20 Premium 编舞名单 | `src/vj/premium-meta.json` | `npm run sync:vj-premium-meta -- --write` |
| 注册它的无缝循环契约(depth-wrap/BPM phase) | `src/vj/loop-contract.js` | `npm run sync:vj-loop-contract -- --write` |
| 新增一个 VJ 隧道 kind(这轮用不上) | `src/vj/tunnel-registry.json` | `npm run sync:vj-registry -- --write` |

真正的效果实现代码(builder 函数本体、渲染逻辑、材质、shader)还是直接写在 `61.html` 里,只有**注册表/元数据**这几块走上面的同步流程。

## 视觉上反复踩过的坑(直接抄近路,别重新踩一遍)

1. **HSL 的 `lightness` 一过 0.5,颜色就朝白收敛**,饱和度设 1 也没用。嫌"不够鲜艳"要靠压 `lightness`(建议封顶在 0.55~0.6 左右),不是拉 `saturation`。
2. **WebGL 里 `LineBasicMaterial.linewidth` 无效,线永远是 1px。**想要"粗线"效果,只能在同样位置叠一层 `InstancedMesh` 实体块,纯线框路子在投影/录制上会显得单薄。
3. **bloom 的 threshold/radius 跟元素密度强相关。**密度堆高之后如果不收紧 threshold,画面会糊成一片白雾——先定密度,再调 bloom,顺序反了要返工。
4. **整屏太亮 = 没有暗部 = 没有纵深。**`lit`(高亮像素占比)建议落在 40%~90% 之间,不要冲到 100%,不然隧道感会糊掉。**这轮 5 条要改的就是这个问题。**
5. **近处元素被透视放大糊满屏是最常见的构图毛病。**沿 z 轴一直延伸到镜头跟前的元素,要做近处收缩,别让它们在快到镜头时占满视野。
6. **颜色管线是 sRGB legacy,直接用 `Color.setHSL()` 写的值就是最终显示值。**不要自己加 `outputEncoding` 或者额外做一次 gamma 转换——`renderer.outputEncoding` 在这套自定义 alpha pass 管线里本来就不生效,自己加只会造成二次 gamma(黑场被抬白、饱和度腰斩)。
7. **抗锯齿走的是 `EffectComposer` 的 `samples` render target**(low=0/balanced=2/ultra=4 挂在画质档上),不是 `WebGLRenderer({antialias:true})`——那个从来没生效过,不用管它。

## 循环/音频规范(照抄 CLAUDE.md 就够,这里是本项目的具体判据)

- 循环长度默认 8 或 16 拍,首尾位置/速度要闭合,不能有回收元素重新随机化、camera 跳变、粒子状态不连续。
- bass/mid/high 分别驱动不同视觉维度(缩放/形变 vs 几何运动/粒子 vs 高光/细粒子/光带),别把原始 FFT 值直接怼到每个属性上。
- 参考 `app/tests/vj-tunnels.spec.js` 里的判据:`lit` > 25%、高饱和像素占比 > 50%、色相档数 > 2、逐帧确认元素沿 z 往镜头飞、跑满一整圈画面不塌/不堆一处。改完这 5 条后重跑这条测试,确认它们的 `lit` 数字降到 90% 以下、`hues` 有提升,同时原有下限(25%/50%/2)不能被打破。

## 发布前验证(在 `app/` 目录下)

```bash
npx playwright test tests/vj-tunnels.spec.js   # 先看这 5 条改完的 lit/hues 打印和 PASS/FAIL
npx playwright test                             # 全量约 17-20 分钟(单 worker,Electron+WebGL 不能并发,workers 锁 1 是故意的)
```

如果改动波及要打包发布(`replacement/`、Replace ZIP),回到项目根目录:

```powershell
.\scripts\verify-protected-paths.ps1
.\scripts\verify-replacement.ps1
.\scripts\verify-replace-zip.ps1
```

`replacement/61.html` **不是自动同步的**,是从根目录 `61.html` 手动复制过去的(`cp 61.html replacement/61.html`),改完 `61.html` 记得同步,不然 `verify-replacement.ps1` 会报 `STALE REPLACEMENT`。

## 会浪费时间的坑

- 测完性能之前先 `taskkill //F //IM electron.exe`——自己遗留的 Electron 探针进程会抢 GPU,导致性能测试假性超时(上一轮真的踩过,VJ 全循环测试假性超时两次,清完残留进程就正常了)。
- 不要把 `npx playwright test` 强行改成并发跑,`playwright.config.js` 里 `workers: 1` 是刻意锁的,Electron+WebGL 并发会偶发超时。
- Canvas 2D 的 `ctx.filter` 是逐绘制调用生效的,不是设一次管一片——如果这次做的是 2D 层效果,批量模糊/滤镜前先把内容画到离屏 canvas,再一次性 `drawImage` 加 filter 贴回来,不要在循环里每次都套 filter。
- 改完材质/灯光后,如果这条隧道之前被 `vjSourceAllows`/预热逻辑或 VJ 自动切换路径引用过场景缓存(`bg3DScenes`),记得该测试组(`vj-adaptive-quality.spec.js`、`vj-beat-switch.spec.js`)也跑一下,确认没有被材质改动间接影响到缓存假设。
