# VJ 隧道去塑料感 + 边角细滑 —— 设计

日期:2026-09-25
状态:待用户审阅

## 1. 目标

**用户原话**:所有 VJ 不要有塑料感,边角要细滑。

**讨论中确认的范围**:

- "边角细滑"两个都要:(a)画面上的锯齿要消掉;(b)物体本身的直角要有圆角/倒角,边上能吃到一条细高光。
- 分工:Claude Code 做工程底座,ChatGPT desktop 分批逐条调美术,每批 Claude Code 验证。
- low 画质档也要去塑料感,用便宜的做法;balanced/ultra 用真受光材质。每一档都不塑料,只是精细程度不同。
- 底座采用"共享材质库 + 工具",不做全局自动替换,也不逐条各写各的。

**成功标准**:

- 50 条 VJ 在 low / balanced / ultra 三档下都没有"平面色块"和"塑料区"(中等粗糙、非金属、无反射、整片同色)的表面;发光体保留发光。
- 画面边缘无明显锯齿,4K 录制下同样成立。
- 方块/结构类部件有圆角或倒角,边缘能接到高光。
- 不破坏:无缝循环、三档亮度/饱和度/色相判据、性能预算、内存不增长。
- 每批由用户看改前/改后对比后拍板通过。

## 2. 现状(2026-09-25 调查)

- 50 条 VJ 中 **36 条完全不受光**(`MeshBasicMaterial` / `vjSolidMat`),11 条受光(`vjStdMat` / `vjPhysMat`),3 条混合。受光的那部分在 low 档经 `vjStdMat` / `vjPhysMat` 退回 `vjSolidMat`,仍是平面色 —— 所以 low 档下实际上 50 条全是平面色。
- **35 条用直角 `BoxGeometry`**,没有一条用圆角/倒角。`buildBg3DVjChromeFlow` 的注释写"倒角方块",代码实际是 `BoxGeometry(1.5, 1.5, 3.2)`。
- **6 条用 1px 线**(`LineBasicMaterial` / `LineSegments`),最容易出锯齿。
- 抗锯齿只有 EffectComposer 的 MSAA:low=0、balanced=2、ultra=4(`bg3DMsaaSamples()`)。像素比上限 2,1080p 显示器/投影/LED 墙上是 1。
- 内嵌 three.js r149 **没有** `RoundedBoxGeometry`、`SMAAPass`、`FXAAShader`、`TAARenderPass`、`OutputPass`,需要自行内联。
- **录制时只有 2D 三层画布(`cv`/`cvFx`/`cvBack`)切到录制分辨率;3D/VJ 画布始终按舞台 CSS 尺寸 × 像素比(≤2)渲染**(`resize()` 在录制中也调用 `resizeBg3D(cssW, cssH)`,61.html:5168-5170),合成时由 `drawCaptureElement(bgThreeCanvas, …)` 放大贴进录制帧。1080p 显示器录 4K 时,VJ 层是约 1920×1080 被放大一倍 —— 成片里边缘偏软。

## 3. 设计

### 3.1 抗锯齿(全局,不需要美术判断)

- **不提高平时的 MSAA 倍数**:高分屏上像素比为 2 时,3D 画布本身就接近 4K 像素量,balanced 从 2× 提到 4× 的显存与填充成本对慢机器风险大;细线与着色器边缘本来也不在 MSAA 能处理的范围内。
- **三档都加一道后处理抗锯齿 pass**,位置:调色 pass(`__bg3dGrade`)之后、写 alpha 的 pass(`__bg3dAlpha`)之前 —— alpha 按最终 rgb 的最大通道算,必须在抗锯齿之后。
- 候选:FXAA(最便宜,细节略软)与 SMAA(细节保留更好,需要内联 area/search 查找纹理,成本略高)。**在 1080p 与 4K 录制下实测画面与帧时间后选定**,以截图对比交用户确认。
- 挂载方式与现有 grade/alpha pass 一致:由 `ensureBg3DComposer` 统一插入,所有 3D 背景与 VJ 共用;回收走 `vjDropCachedScene`,pass 的 `dispose()` 必须释放全部材质和渲染目标(参照 bloom `materialHighPassFilter` 泄漏的教训)。
- pass 的分辨率 uniform 必须跟随合成器尺寸(`composer.setSize`),包括窗口缩放与 3.2 的录制分辨率切换。

### 3.2 录制时按录制画质渲染 3D 层(用户 2026-09-25 决定)

- 录制期间 3D 画布的绘制缓冲 = 录制分辨率(与 2D 画布的 `W×H` 一致),CSS 显示尺寸不变:`resizeBg3D` 在 `recordingResolutionActive` 时把渲染器与各合成器的像素比设为 `W / 舞台CSS宽`;停止录制后恢复 `min(devicePixelRatio, 2)`。跟随现有"录制画质"选项(4K / 1440p / 1080p),慢机器由用户选低一档。
- 录制期间 MSAA 上限 2×(高分辨率下显存与填充成本),其余交给后处理抗锯齿;已缓存场景的合成器渲染目标在进入/退出录制时调整 samples 并重建,不重建场景。
- Auto 画质在录制期间已冻结(`e79223c`),不会因 4K 渲染变慢而中途降档。
- 进入录制是一次性的缓冲重建,不能在录制帧里造成黑帧或闪烁:切换发生在 `startRecording` 取流之前。
- 实测:VJ 在 4K / 1440p / 1080p 录制分辨率下的帧时间,与现状对比,结果写进 HANDOFF。

### 3.3 圆角 / 倒角几何:`vjBevelBox(w, h, d, radius)`

| 档位 | 形状 | 三角面/个(直角方块=12) |
|---|---|---|
| low | 单段倒角(每条边一刀斜面,平直法线) | 约 44 |
| balanced | 1 段圆角 | 约 108 |
| ultra | 2 段圆角 | 约 300 |

- 圆角实现参照 three.js `RoundedBoxGeometry`(MIT)内联移植;倒角为自写的切角盒。
- 按 `(w, h, d, radius, 档位)` 缓存,同尺寸共享一份几何体;切档时随场景回收,缓存不能跨档残留。
- 圆角/倒角必须配受光或 matcap 材质才看得见 —— 几何与材质一起换。
- **不等比拉伸规则**(写进 HANDOFF):很多效果用单位方块再按实例拉伸,圆角会随之变形。按实际尺寸建几何;或细长部件改用圆柱/胶囊;或保留直角,只靠抗锯齿与材质改善。

### 3.4 材质预设库:`vjMaterial(preset, opts)`

原则:每个预设都明确避开"塑料区";发光体保留发光,改为"发光芯 + 实体外壳"。

| 预设 | 用途 | balanced / ultra | low |
|---|---|---|---|
| `metal` | 门框、方块、结构件 | `MeshStandardMaterial` 金属 + 环境反射(沿用 `vjEnvMap()`)+ 边缘高光 | 金属 matcap |
| `satin` | 墙体、地形等大面积哑光 | 非金属、较粗糙、边缘逆光 | 哑光 matcap |
| `glass` | 玻璃、晶体、碎片 | `MeshPhysicalMaterial` 清漆 + 半透明 + 边缘反射 | 玻璃 matcap + 半透明 |
| `neonCore` | 灯管芯、能量线 | 不受光自发光(靠 bloom) | 同左 |
| `neonHousing` | 灯管外壳、灯座 | 深色金属,吃相邻灯管反光 | 深色金属 matcap |

- matcap 贴图用 canvas 程序生成并缓存,不新增外部资源(`assets/` 受保护)。
- 预设在三档下自己匹配亮度:改效果的人不再需要按 `isMeshStandardMaterial` 分支亮度(上一轮 low 档灰白问题的根治)。
- 支持逐实例颜色(`setColorAt`),并提供确定性的逐实例亮度/色偏微差,避免整片同色;确定性保证循环无缝。
- 预设材质带 `userData.vjPreset` 标记,供测试判定覆盖。
- 现有 `vjStdMat` / `vjPhysMat` / `vjSolidMat` 保留,未改造的隧道照常工作。
- 实施时需验证 r149 的 `MeshMatcapMaterial` 对 `instanceColor` 的支持;若不支持,low 档改用自写的最小 matcap ShaderMaterial。

## 4. 测试与验收

自动测试(每批都跑):

1. **预设覆盖棘轮**:测试内维护"已改造隧道"清单,清单内隧道的所有可见 mesh 材质必须带 `userData.vjPreset`;清单只增不减。
2. **三档画面判据**:已改造隧道在 low/balanced/ultra 下 lit 40%~90%、vivid > 50%、hues > 5(沿用 `vj-five-depth.spec.js` 的做法,soft 断言一次报全)。
3. **性能预算**:扩展 `bg3d-performance-budget.spec.js` 到 50 条 × 三档的三角面与绘制调用上限;抗锯齿 pass 加入前后的帧时间对比。
4. **抗锯齿**:pass 在三档中存在、位于 grade 与 alpha 之间;分辨率随窗口缩放与录制分辨率变化。
5. **录制分辨率**:录制期间 3D 绘制缓冲等于录制分辨率(4K / 1440p / 1080p 各测一次)、MSAA ≤ 2;退出录制后恢复原尺寸与原 samples;切换不产生黑帧(录制合成帧的 3D 区域非空)。
6. **回收**:`vj-long-session-soak.spec.js` 继续通过(新几何缓存、matcap 贴图、抗锯齿 pass 切档时回收干净)。
7. **原有测试全部保留**:循环无缝、z 推进方向、全循环不塌、金属组 PBR 判据等。

人工验收:每批生成一个对比网页(改前 / 改后 × 三档,外加边缘放大裁切),**用户确认通过才算该批完成**。

## 5. 推进顺序

**第 0 轮(Claude Code;期间 ChatGPT 不碰 `61.html`)**

1. 抗锯齿:实测 FXAA / SMAA,对比截图交用户选定。
2. 录制时按录制画质渲染 3D 层(3.2),实测三种录制分辨率下的帧时间。
3. `vjBevelBox` + 材质预设库 + 第 4 节测试。
4. 两条示范隧道:`vjChromeFlow`(方块金属,把注释里的倒角做成真的)与 `vjNeonTubeRoom`(发光芯 + 外壳,演示拉伸部件处理)。
5. 对比网页交用户看质感方向;**认可后才开始批量**。
6. HANDOFF.md 写入预设用法、拉伸规则、验收标准;全量测试通过后提交推送,交给 ChatGPT。

**第 1~5 轮(ChatGPT,每轮约 10 条)**

- 顺序:先 Top 20 Premium 中未改造的,再按视觉家族分组(方块/结构类、线条类、粒子/流体类……)。
- 每轮结束:Claude Code 验证(测试 + 三档截图 + 性能),用户看对比网页通过,再进下一轮。

## 6. 风险

- **整体观感变化大**:36 条从纯发光色块变成有实体材质,风格会明显改变。以两条示范隧道先定方向来控制风险。
- **亮度/色彩回退**:受光材质普遍比自发光暗,bloom 与颜色需要逐条重调;三档判据测试兜底。
- **性能**:圆角面数与受光计算增加 GPU 负担;以三角面预算测试与帧时间测量约束,low 档用便宜做法。
- **4K 录制**:抗锯齿 pass 与更多几何在 4K 下成本放大;抗锯齿选型时必须实测 4K。

## 7. 不在本次范围

- 不改 3D 背景(非 VJ 的 61+ 个效果);抗锯齿 pass 例外,它对全部 3D 层生效。
- 不升级 three.js 版本。
- 不新增 VJ 效果、不改运动/循环逻辑。
