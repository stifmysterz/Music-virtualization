# 第二步(色调映射 + sRGB)的调查结论

调查日期:2026-09-02

**结论先说:这一步不成立,已默认关闭。不是参数没调好,是前提不满足。**

---

## 原计划为什么行不通

原本的计划是设两个渲染器属性:

```js
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping    = THREE.ACESFilmicToneMapping;
```

运行时探针(Electron + Playwright,实测 `61.html`)证实**第一条设了等于没设**:

| 探测项 | 实测值 |
|---|---|
| `THREE.REVISION` | 149 |
| `renderer.outputEncoding` | 3000 = `LinearEncoding` |
| `'outputColorSpace' in renderer` | false(r149 还没有这个属性) |
| 最后一道 pass | `renderToScreen:true` **且 `isShaderMaterial:true`** |

`outputEncoding` 是靠 `encodings_fragment` 这个 shader chunk 注入实现的,
而 chunk **只会进内置材质,不会进裸 `ShaderMaterial`**。这个项目最后写到屏幕的
偏偏是自定义的 alpha pass(`BG3D_ALPHA_SHADER`)。

所以只能自己写一道 pass。做了:`BG3D_GRADE_SHADER` / `makeBg3DGradePass()`,
插在 alpha pass **之前**(alpha 要按调色后的 rgb 算,否则透明度和看到的亮度对不上)。

管线:`渲染 → bloom → 色调映射 → sRGB → alpha → 屏幕`

## 为什么不并进已有的 alpha pass

省一道全屏 blit 很诱人,但 alpha pass 会被 **「🪟 See Through」** 开关关掉。
合在一起的话,用户一关那个不相干的开关,整条色彩管线跟着关,画面莫名突变。
两个特性必须解耦。

---

## 实测结果:两种变换都在做二次处理

三方对比,同一条隧道、**同相位**(每次丢弃缓存场景重建,让 clock 从 0 开始):

| 隧道 | 档 | lit | vivid | 纯白削顶 |
|---|---|---|---|---|
| ChromeFlow | 关 | 61.6% | **94%** | 1.54% |
| | ACES | 65.0% | 91% | **0.00%** |
| | ACES+sRGB | 73.9% | **72%** | 0.00% |
| LiquidGrid | 关 | 73.7% | **92%** | 0.84% |
| | ACES | 81.4% | **76%** | 0.00% |
| | ACES+sRGB | 98.2% | **40%** ✗ | 0.00% |
| EventHorizon | 关 | 33.6% | 100% | 0.01% |
| | ACES | 31.0% | 100% | 0.00% |
| | ACES+sRGB | 58.3% | 100% | 0.00% |

目视(`vjLiquidGrid`):

- **关** — 纯黑背景,珠子是紫/蓝/洋红,有清楚的体积 ← 最好
- **ACES** — 黑场还在,线条辉光变柔,但**珠子褪成灰白**,体积感变弱
- **ACES+sRGB** — **黑场被抬成紫灰**,珠子成白团,整屏发雾

### 根因

ACES 和线性→sRGB **都假定输入是「线性、场景参考」的 HDR 值**。

而这 106 个效果的颜色是用 `Color.setHSL()` 直接写的,且 r149 的
`ColorManagement` 处于 legacy 模式(`ColorManagement.enabled` 是 `undefined`,
只有 `legacyMode`)。也就是说**那些数值本来就是显示参考的 sRGB 值**。

两种变换都是二次处理。要真正「补上正确色彩空间」,得把 106 个效果的配色
全部按线性空间重写 —— 那会作废你所有的手调结果。

---

## 现在的状态

- `🎞 Film Grade` 开关在 🌌 3D 菜单里,**默认关**
- 关掉时用 `pass.enabled = false`,EffectComposer 整个跳过这道 pass,**零开销**
- `vjSrgb` 内部变量默认 `false` 且**不给 UI** —— 它在这个代码库里就是错的
- 开关留着是为了两件事:你可以自己一眼看到上面的结论;将来若真做了线性重写,
  这里是现成的接入点

## 需要你决定的

ACES 单独用是一笔**交易**:消除高光削顶(1.54% → 0%),代价是饱和度
(LiquidGrid 92% → 76%)。

这笔交易该不该做是审美判断,不是技术判断 —— 这个产品的身份就是高饱和 EDM
色彩,`vj-tunnels.spec.js` 甚至把 `vivid > 0.5` 写成了硬标准。所以我没有替你决定,
设成默认关,你可以在菜单里当场来回切着看。
