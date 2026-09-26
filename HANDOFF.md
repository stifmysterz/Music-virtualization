# 交接状态 — 去塑料感第 0 轮完成,交给 ChatGPT 分批改造(2026-09-26)

**当前状态**:Claude Code 做完了"去塑料感 + 边角细滑"的工程底座和两条示范隧道,用户已看过对比网页并确认质感方向(https://claude.ai/artifact/8v3HSgout91esQ54AhoXUT)。设计文档 `docs/superpowers/specs/2026-09-25-vj-anti-plastic-design.md`,实施计划 `docs/superpowers/plans/2026-09-25-vj-anti-plastic-round0.md`。三份 `61.html` SHA256 一致(`665D59DC511F335D8555BFCD8F2658CD745E9E929466E51FDCA5A5DBA1FFF0AB`),全量 Playwright **292/292 通过(约 17 分钟;另有一位全新上下文的审查者看过整条分支,5 个重要问题已修复,见下方第 5 节)**。**下一步:ChatGPT 按下面的批次顺序改造其余 48 条,每批约 10 条;每批做完交回 Claude Code 验证。ChatGPT 改 `61.html` 期间 Claude Code 不动它。**

## 去塑料感改造:给 ChatGPT 的用法和规则

### 1. 工具(都在 `61.html` 里,直接调用)

| 预设 `vjMaterial(preset, opts)` | 用途 | balanced / ultra | low |
|---|---|---|---|
| `metal` | 门框、方块、结构件 | 金属 + 环境反射 | 金属 matcap |
| `liquidMetal` | 水银、镀铬、滴落的金属(金属组里要求清漆的 4 条用它) | 物理材质 + 清漆 | 金属 matcap |
| `satin` | 墙体、地形等大面积哑光 | 非金属、较粗糙 | 哑光 matcap |
| `glass` | 玻璃、晶体、碎片 | 清漆 + 半透明 | 玻璃 matcap + 半透明 |
| `neonCore` | 灯管芯、能量线、发光块 | 不受光自发光(靠 bloom) | 同左 |
| `neonHousing` | 灯管外壳、灯座 | 深色金属 | 深色金属 matcap |

- `opts` 可传 `color`、`opacity`、`side`、`metalness`、`roughness`、`envMapIntensity`、`additive`(只对 `neonCore`)。未知预设名会直接报错。
- 用了 `metal`/`liquidMetal`/`satin`/`glass`/`neonHousing` 的场景必须有 `vjLightRig(scene, …)`(至少 2 盏方向光 + 1 盏半球光)。
- `vjBevelBox(w, h, d, radius)`:按档位给倒角/圆角方块(low 44 面 / balanced 108 面 / ultra 300 面),同尺寸共用一份,半径会自动夹紧。**按实际尺寸建**,不要建单位方块再拉伸。**返回的几何是共享的,不能对它 rotate/translate/scale**(代码会直接报错)—— 要转就转 mesh 或实例。
- `vjPresetJitter(color, key, amount = 0.06)`:确定性的逐实例亮度微差。
- low 档的整体亮度倍率在 `VJ_MATCAP_LOOKS` 里(`gain`),受光档参数在 `VJ_LIT_LOOKS` 里 —— 改这两张表会影响所有用该预设的隧道,改之前先问 Claude Code。

### 2. 规则(每条都来自示范隧道里真实踩过的坑)

- **预设在 low 档也是有明暗的 matcap**:颜色用受光档的数值,不要再用 `vjTint` 的 low 分支(那是给不受光材质的)。
- **不等比拉伸的部件**:按实际尺寸建 `vjBevelBox`;细长部件用圆柱/胶囊(示范:NeonTubeRoom 的灯管芯是圆柱);会随脉冲不等比拉伸的发光块保留直角并用 `neonCore`。
- **世界编号**:槽位循环(`z = -i*SPACING + off - SPACING`)里,凡是按元素决定的外观 —— 强调色、有没有、交替色、`vjPresetJitter` 的 key —— 都用 `i + Math.floor(scroll / SPACING)`,再对槽位总数取模,**取模周期必须整除槽位总数**(示范:SpeedGates 25 扇门 / 每 5 扇强调;NeonTubeRoom 48 段 / 每 3 段一环 / 每 6 段换色)。用槽位编号 `i` 的话,每次退格外观都会留在原地:强调色频闪、元素原地回跳。
- **bloom 跟亮度一起调**:换成受光材质后,原来的 bloom 往往会把块与块之间的缝全部填亮(示范:ChromeFlow 从 1.15/0.5/0.55 收到 0.75/0.45/0.78 后缝才重新变黑)。
- **自己写的后处理 pass**,`dispose()` 必须释放全部材质和渲染目标(回收路径只调 `pass.dispose()`)。
- **InstancedMesh 设 `frustumCulled = false`**:r149 按底座几何在原点的包围球做视锥剔除,镜头运动选「flythrough」时整条实例化隧道会被剔掉消失(审查时实测 ChromeFlow、NeonTubeRoom 都会)。

### 3. 每批的验收流程

1. 把本批改造完的隧道名加进 `app/tests/vj-anti-plastic.spec.js` 的 `CONVERTED`(只增不减)。
2. 用到槽位编号决定外观的,在 `app/tests/vj-element-continuity.spec.js` 加用例(照 SpeedGates / NeonTubeRoom 的 `pick` 写)。
3. 在 `app/` 下跑:`npx playwright test tests/vj-anti-plastic.spec.js tests/vj-element-continuity.spec.js tests/vj-five-depth.spec.js tests/vj-tunnels.spec.js tests/vj-loop-integrity.spec.js tests/bg3d-performance-budget.spec.js tests/vj-material-presets.spec.js`。三档都要在 lit 40%~90%、饱和 > 50%、色相 > 5。
4. 拍对比图:`node scripts/vj-shots.js --out ../vj-shots/<批次名> --kinds <本批,逗号分隔> --crop 0.62,0.35`(改造前的图用同样命令在改造前拍一次,输出目录换个名字)。交回 Claude Code 做对比网页给用户看。

### 4. 批次顺序(每批约 10 条)

| 批次 | 隧道 |
|---|---|
| 1(Top 20 Premium) | vjLiquidGrid、vjNeonRibbon、vjPrismShards、vjFractalWell、vjTentacleTunnel、vjBioMembrane、vjVoidNebula、vjEventHorizon、vjDataBloom、vjNeonArches |
| 2(Top 20 Premium) | vjHorizonVoyage、vjHyperCube、vjCoasterRush、vjMercuryPool、vjWarpJump、vjSolarFlare、vjChromeTube、vjMetalTwist、vjLiquidSpine |
| 3(方块 / 结构) | vjCubeMatrix、vjGridMorph、vjCyborgCorridor、vjRaceTrack、vjSpeedGates、vjHoverCity、vjDerelictHall、vjCollapsedGrid、vjShatteredPanes、vjDustShaft |
| 4(方块 / 结构 + 线条) | vjAsteroidSlalom、vjRingWorldRun、vjVoxelPulseTerrain、vjNeonGeometryTunnel、vjUltravioletHiveRush、vjNeonReactorDescent、vjHexPulse、vjWaveCorridor、vjStarLane、vjKaleido |
| 5(有机 / 粒子 / 流体 / 金属) | vjPlasmaRings、vjCandyOrbs、vjLightWell、vjIonTrail、vjBlackGoldFluid、vjFoilCrumple、vjChromeBubbles、vjChromeDrips、vjRustPipes |

已完成:vjChromeFlow、vjNeonTubeRoom(示范)。金属组 7 条(ChromeTube、MetalTwist、ChromeDrips、FoilCrumple、ChromeBubbles、LiquidSpine、RustPipes)还受 `vj-tunnels.spec.js` 的"7 个金属 VJ"测试约束:金属度 0.6~0.78、粗糙度 0.1~0.5;ChromeTube/ChromeDrips/ChromeBubbles/LiquidSpine 要用 `liquidMetal`(清漆 ≥ 0.85)。

### 5. 本轮工程结果(Claude Code)

- **抗锯齿**:三档都加了 SMAA(与 FXAA 并排对比后用户选定),在调色之后、写 alpha 之前。low 档细光带的硬台阶从 30% 降到 2%。代价(本机集显,1350×681):low 8.1 → 13.5 ms、balanced 21.3 → 25.8 ms、ultra 28.9 → 35.2 ms(ChromeFlow)。🌌 3D 菜单里的「✨ 3D 抗锯齿」可以关(默认开,会记住)。
- **3D 像素比跟画质档走**:low 1 / balanced 1.5 / ultra 2(都不超过设备像素比)。以前 balanced/ultra 被 r149 的 EffectComposer 悄悄压回 CSS 尺寸(自带 MSAA 目标时它把像素比记成 1),low 反而按完整像素比渲染。现在画质档是一条真正的性能阶梯,Auto 降档也能省下分辨率开销。模拟 2 倍屏同一窗口:low 675×341 约 6 ms、balanced 1012×511 约 16 ms、ultra 1350×682 约 34 ms(ChromeFlow,SMAA 开)。
- **录制清晰度开关**:Tools 里的「🧊 录制时 3D」—— 默认"屏幕尺寸"(与以前一样快);"跟随录制画质"时 3D 层按录制帧渲染,成片最锐利但很重(本机集显录 4K 约 6~8 fps)。竖屏/方形舞台也不会超出录制帧;bloom 仍按屏幕等效尺寸计算,开关只让画面更锐,不改观感。1 像素的线在这个模式下会变成极细的线。
- **SpeedGates**:改成实例化(119 → 约 20 次 draw call),强调色按世界编号,修掉了橙色门原地频闪;门数 26 → 25。**它在 `vj-five-depth` 里 balanced/ultra 的 lit 只有 40.2%/40.4%,离 40% 下限很近** —— 第 3 批改造时留出余量。
- **NeonTubeRoom**:方环不再每次退格往回跳。
- 性能预算测试扩到 50 条 × 三档。

### 6. 已知问题(待用户决定,本轮未改)

- 27 条槽位循环隧道里的 `wz = i*SPACING - scroll` 不是元素的物理坐标:每次退格它对同一个元素跳 −SPACING,用 `wz` 驱动的摆动/旋转/波形在退格时有小幅阶跃。
- 部分灯光强度渐变按帧不按时间(例如 ChromeFlow 的 `rig.key.intensity += (…) * 0.12`),30fps 和 60fps 下快慢不同(CLAUDE.md §13)。
- VJ 自动轮换每次切换都会存一条撤销记录(上限 50),长时间开着会把手动操作挤出撤销历史。

---

## 上一轮记录:5 条 VJ 质感升级(2026-09-25)

上一轮的交接状态:本轮已由 Claude Code 审查、修复、全量验证并提交推送(commit `feat(vj): deepen five over-bright tunnels…`),之后又做了一轮工程修复(见下方"工程修复")。

## 工程修复(Claude Code,2026-09-25)

- **录制期间 Auto 画质不再调档。** 4K 录制本身会拉长帧时间,Auto 以前会把它当成"机器太慢"去降档,丢掉全部场景重建 —— 成片里卡一下、前后画质不一样。现在 `updateAdaptiveVjQuality` 在 `isRecording` 时不采样也不调档,停录后从干净窗口重新计。测试:`vj-adaptive-quality.spec.js` 第二条。
- **测试收尾不再留下 Electron 进程。** 录制中关闭会弹同步原生对话框(`showMessageBoxSync`),测试里没人点,`closeApp` 以前会永远等下去,进程留在后台抢 GPU。现在 `app/tests/helpers/close-app.js` 等 15 秒没退出就结束整棵进程树并打印 `closeApp: Electron (pid …) did not exit…` 警告。**全量输出里如果出现这行,说明对应那条测试没有正常关闭,要去查原因,不要忽略。** 测试:`close-app-helper.spec.js`(它故意触发一次,所以全量里固定会有这一行)。
- **修了一个长时间演出的内存泄漏。** 内嵌 three.js r149 的 `UnrealBloomPass.dispose()` 漏了亮部提取材质 `materialHighPassFilter`,它留在 three.js 的着色器缓存里并拽着 bloom 渲染目标的纹理 —— 每回收一个带 bloom 的场景就漏一个 ShaderMaterial + 一个 Texture,960 次自动轮换涨 1.9 MB 且不趋平。在 `vjDropCachedScene` 里补释放(没改第三方压缩代码)。修后同样 960 次只剩 V8 JIT 代码和浏览器计时条目的正常增长。测试:`vj-long-session-soak.spec.js`(自动轮换 + 预热 + 切档 480 次,数活着的 ShaderMaterial/Texture;去掉修复时它报 +316)。**以后新建效果如果自己写 pass,回收路径在 `vjDropCachedScene`,那里只会调 `pass.dispose()` —— 你的 pass 必须在 dispose 里释放全部材质和渲染目标。**
- **VJ 全循环测试从 6~7 分钟降到 1.3 分钟**(整个 `vj-tunnels.spec.js` 从 7~9 分钟降到 2.8 分钟,全量从 17~18 分钟降到 13 分钟)。中间 400 帧改用 harness 的 `advance()`:`renderBg3D` 全路径照跑,只跳过 GPU 绘制;测亮度改用只数亮像素的扫描。断言一条没动。新增一条测试保证 `advance()` 与逐帧真实渲染的场景状态逐位相同 —— **如果你在 render/pass 阶段改场景状态,这条会报错,那时要先想清楚再动它。**

## 本轮结果

ChatGPT 按下方任务说明完成了 5 条隧道的压暗、PBR 灯组和第二色相;Claude Code 审查时发现 **low 画质档退化**并修复。最终数值(`app/tests/vj-five-depth.spec.js`,目标区间 lit 40%~90%、vivid > 50%、hues > 5):

| kind | 改前 lit / hues(balanced) | 改后 low | 改后 balanced | 改后 ultra |
|---|---|---|---|---|
| `vjStarLane` | 99.9% / 39 | 52.4% | 53.6% | 46.5% |
| `vjSpeedGates` | 98.4% / 11 | 73.9% | 57.0% / 26 | 56.8% |
| `vjPlasmaRings` | 96.1% / 25 | 44.1% | 45.9% / 39 | 45.9% |
| `vjNeonTubeRoom` | 95.4% / **4** | 50.5% | 55.8% / 27 | 55.8% |
| `vjKaleido` | 94.4% / 39 | 44.9% | 49.2% / 39 | 49.4% |

Claude Code 在 ChatGPT 版本上额外做的修改:

1. **low 档修复(`vjSpeedGates`、`vjNeonTubeRoom`)**:这两条换成了 `vjStdMat` 受光材质,但 low 档下 `vjStdMat` 会退回不受光的 `vjSolidMat`,为受光档调的偏高亮度直接上屏。实测 low 档 SpeedGates lit 95.6%、vivid 只有 23%(整屏灰白),NeonTubeRoom lit 96.2%(背景被 bloom 染成紫雾)。修法是在 `update()` 里按 `material.isMeshStandardMaterial` 分支亮度曲线,受光档数值完全不变。
2. **`vjStarLane` 稳定性**:ChatGPT 版在不同测试顺序下 lit 落在 40.0%~46.6%,贴着 40% 下限会随机挂(实测一次 39.97%)。没有放宽阈值,而是把光带数从 1100 提到 1400(原版 1500),靠密度而不是加粗撑画面。
3. **测试扩展**:`vj-five-depth.spec.js` 原本只测默认 balanced 档,现在 low/balanced/ultra 三档都测,用 soft 断言一次报全。

画面实看(三档截图)确认:5 条都有真黑的纵深、色彩层次明显,balanced/ultra 下 SpeedGates 的金属门框有 key 灯高光。无缝循环不受影响 —— 改动全在颜色/材质/灯光/bloom 参数和逐帧推导的光带尺寸上,没有累积状态;`vj-loop-integrity`、`vj-tunnels` 全循环测试均通过。

**下一轮候选**(同一批诊断数据里还超 90% 的):`vjCandyOrbs`(97.4%)、`vjLightWell`(95.1%)、`vjRaceTrack`(90.6%)。另外 `vjPlasmaRings` 近景光环掠过镜头时会短暂占满画面一侧(坑 #5),属于既有构图问题,可一并处理。

---

## 本轮任务说明(存档)

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
8. **`vjStdMat` 在 low 档会退回不受光的 `vjSolidMat`,灯组全部失效。**给受光材质调的颜色亮度(靠金属/灯光压暗)在 low 档会直接上屏 —— 偏亮就朝白收敛、再被 bloom 糊成灰。把效果换成 `vjStdMat` 时,在 `update()` 里按 `material.isMeshStandardMaterial` 给不受光路径一条更暗的亮度曲线,并且**三档都要实测**(默认测试只跑 balanced)。上一轮加的 Auto 画质会在慢机器上主动降到 low,所以 low 档是真实用户会看到的画面。

## 循环/音频规范(照抄 CLAUDE.md 就够,这里是本项目的具体判据)

- 循环长度默认 8 或 16 拍,首尾位置/速度要闭合,不能有回收元素重新随机化、camera 跳变、粒子状态不连续。
- bass/mid/high 分别驱动不同视觉维度(缩放/形变 vs 几何运动/粒子 vs 高光/细粒子/光带),别把原始 FFT 值直接怼到每个属性上。
- 参考 `app/tests/vj-tunnels.spec.js` 里的判据:`lit` > 25%、高饱和像素占比 > 50%、色相档数 > 2、逐帧确认元素沿 z 往镜头飞、跑满一整圈画面不塌/不堆一处。改完这 5 条后重跑这条测试,确认它们的 `lit` 数字降到 90% 以下、`hues` 有提升,同时原有下限(25%/50%/2)不能被打破。

## 发布前验证(在 `app/` 目录下)

```bash
npx playwright test tests/vj-tunnels.spec.js   # 先看这 5 条改完的 lit/hues 打印和 PASS/FAIL
npx playwright test                             # 全量约 13 分钟(单 worker,Electron+WebGL 不能并发,workers 锁 1 是故意的)
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
