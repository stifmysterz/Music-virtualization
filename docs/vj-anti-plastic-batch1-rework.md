# 去塑料感第 1 批:返工两条(2026-09-26,Claude Code 验收后)

第 1 批 10 条里,8 条用户已验收通过,和这两条一起在 `main` 上提交了(见 HANDOFF.md)。**只返工下面两条,其余 8 条不要动。**

对比网页(改前/改后 × 三档,在图上按住看改前):`vj-shots/review-batch1/index.html`。返工完在 `app/` 下跑 `npm run review:vj -- --kinds vjVoidNebula,vjBioMembrane --tests --open`,会用 git 里的版本当「改前」重新拍一份。

## vjVoidNebula:星云没了,星核变成平涂色块

- **星云底色没了。** 改前整屏是紫色的星云雾,改后几乎全黑(气团 `neonCore` 不透明度 0.06、亮度 `0.12 + high*0.04`)。这条隧道叫 Void **Nebula**,星云是它的身份,要作为一层设计过的氛围回来,不是整屏发灰。lit 仍然要在 40%~90%。
- **星核是平涂色块。** `neonCore` 不受光,亮度又封顶在 0.48,近处的大星核是一整块均匀的颜色,没有「中心发亮、向外衰减到颜色」的光团感。
- **低面数看得出来。** 星核用 `SphereGeometry(1, 6, 5)`,近处的大星核边缘是明显的八边形(CLAUDE.md §2 点名禁止的廉价感)。段数要够,或者换成有径向渐变的做法。

## vjBioMembrane:balanced / ultra 下细胞膜看不见

- **膜的不透明度在 balanced/ultra 只有 0.015**(low 是 0.36),膜几乎完全消失,画面只剩一堆平涂的绿色细胞核。low 档的膜看得见,细胞感最强 —— **结果最低画质比高画质好看,这不能接受。** 高档位至少要和 low 一样看得出膜,最好更精致(玻璃的边缘反射、厚度感)。
- 如果当初压到 0.015 是为了把 lit 压回 90% 以下,改用 bloom、核的亮度或膜的颜色去控,不要靠让膜消失。
- 细胞核同样是平涂的 `neonCore` 色块,可以一起处理。

## 顺带要知道的(工程侧,Claude Code 已处理)

- **玻璃着色器现在启动时预热。** 玻璃预设冷编译一个变体约 0.4 s,第一次切到 PrismShards 会卡住一帧(验收时 `bg3d-performance-budget` 的 Top 20 测试因此失败,1155 ms)。Claude Code 加了启动预热 `VJ_WARM_GLASS_VARIANTS`,覆盖「双面 + 半透明 + 逐实例颜色 + Top 20 的两盏点光源」。**BioMembrane 的膜如果改成单面或不透明,`app/tests/vj-shader-warmup.spec.js` 会失败,报错里写明缺的变体 —— 照着在 `VJ_WARM_GLASS_VARIANTS` 里补一行。**
- **帧时间:** 换成受光材质后,FractalWell、BioMembrane、NeonRibbon 平稳帧慢了 30%~55%(本机集显 balanced:28 → 44 ms、28 → 40 ms、26 → 36 ms)。仍在预算内,返工时别再让 BioMembrane 变得更重。
