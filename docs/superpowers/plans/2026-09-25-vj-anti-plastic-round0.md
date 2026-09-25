# VJ 去塑料感 · 第 0 轮(底座)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 VJ 层打好"去塑料感 + 边角细滑"的工程底座——后处理抗锯齿、录制按录制画质渲染 3D 层、按档位切换的倒角/圆角几何、按档位切换的材质预设库、验收测试和对比工具——并用两条示范隧道确认质感方向,然后交给 ChatGPT 分批改造其余隧道。

**Architecture:** 第三方代码(three.js r149 的 FXAA/SMAA/RoundedBoxGeometry)原样移植到 `src/three/addons-r149.js`,由同步脚本写进 `61.html` 的生成块,测试防漂移(沿用 `scene-cache` 的模式)。其余新代码直接写在 `61.html`,挂在现有的合成器(`ensureBg3DComposer`)、场景回收(`vjDropCachedScene`)、画质切换(`setVjQualityTier`)和录制分辨率(`enterRecordingResolution`)钩子上。每个预设/几何工具内部按 `vjQuality` 自己处理三档,改效果的人不再写档位分支。

**Tech Stack:** Electron 44 + 内嵌 three.js r149(legacy sRGB 管线)+ Playwright(`_electron`)测试,单文件 `61.html`。

**Spec:** `docs/superpowers/specs/2026-09-25-vj-anti-plastic-design.md`

## Global Constraints

- `source/`、`assets/`、`shaders/` 三个目录一字不动。
- three.js 保持 r149,不升级;第三方代码只能经 `src/three/addons-r149.js` → `npm run sync:three-addons` 进入 `61.html`,不许手改生成块。
- 运行时不引入任何外部依赖或网络资源;`npm pack three@0.149.0` 只在开发机上用于生成 vendored 文件。
- 颜色管线是 sRGB legacy:`setHSL` 写的就是显示值,不加 `outputEncoding`、不做额外 gamma。
- 动画必须基于 dt(CLAUDE.md §13)。
- 现有 61+ 个 3D 背景与 50 条 VJ 数量不变;无缝循环、z 推进方向、全循环不塌等现有测试必须继续通过。
- Playwright `workers: 1` 不改;跑性能相关测试前先 `taskkill //F //IM electron.exe`。
- 每个任务提交时同步 `replacement/61.html`(`cp 61.html replacement/61.html`);Replace ZIP 与 `dist/` 只在 Task 12 重建——中间任务里 `replace-zip-freshness.spec.js`、`build-output.spec.js` 失败是预期的,其余测试必须通过。
- 所有命令默认在 `app/` 目录执行,另有说明的除外。
- 代码注释只写"为什么",一行为主。提交信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。
- 本轮期间 ChatGPT desktop 不改 `61.html`。

## Review Focus

- **录制中窗口缩放**:`resize()` 在录制中也会调 `resizeBg3D(cssW, cssH)`;3D 绘制缓冲必须仍等于录制分辨率,不能被打回屏幕尺寸。→ Task 4 测试 B。
- **录制中切画质档**:切档会重建全部场景和合成器;新合成器也必须是录制像素比、MSAA ≤ 2,停录后恢复原倍数。→ Task 4 测试 C。
- **low 档录制**:low 档本来没有 MSAA,录制时不能被"限到 2"反而升成 2。→ Task 4 测试 D。
- **关掉"透出背景"**:alpha pass 被禁用时,抗锯齿 pass 成为最后一道启用的 pass,必须直接画到屏幕、照常出图。→ Task 3 测试 2。
- **SMAA 查找贴图还没解码完就建了 pass**:贴图异步解码,解码完成前那几帧没有抗锯齿;解码完成后必须自动生效,而不是一直无效。→ Task 3 测试 5。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `app/scripts/vj-shots.js`(新建) | 截图 + 指标工具:指定隧道 × 画质档 × 抗锯齿模式 × 录制分辨率,输出整帧 PNG、放大 3 倍的边缘裁切 PNG、`metrics.json`(lit/vivid/hues/帧时间)。对比网页和每批验收都用它。 |
| `app/scripts/vendor-three-r149-addons.js`(新建) | 从解压的 `three@0.149.0` 包生成 `src/three/addons-r149.js`,可复现。 |
| `src/three/addons-r149.js`(生成) | FXAA / SMAA / RoundedBoxGeometry 的 r149 原版代码,包成全局 `THREE_R149_ADDONS`。 |
| `app/scripts/sync-three-addons.js`(新建) | 把上面的文件同步进 `61.html` 生成块 / 校验是否漂移。 |
| `61.html`(修改) | 抗锯齿 pass、录制分辨率、`vjBevelBox`、`vjMaterial`、SpeedGates 实例化、两条示范隧道。 |
| `app/tests/three-addons-source.spec.js`(新建) | 生成块同步 + 移植代码能在应用里运行。 |
| `app/tests/bg3d-post-aa.spec.js`(新建) | 抗锯齿 pass 的位置、分辨率、效果、边界情况。 |
| `app/tests/bg3d-recording-resolution.spec.js`(新建) | 录制时 3D 层分辨率、MSAA 上限、首帧非空、复原。 |
| `app/tests/vj-bevel-box.spec.js`(新建) | 倒角/圆角几何的面数、尺寸、法线、缓存、回收。 |
| `app/tests/vj-material-presets.spec.js`(新建) | 预设在三档下的材质类型、标记、matcap 逐实例颜色、微差确定性。 |
| `app/tests/vj-element-continuity.spec.js`(新建) | 槽位循环里"按槽位编号取属性"导致的强调色频闪 / 元素凭空出现。 |
| `app/tests/vj-anti-plastic.spec.js`(新建) | 已改造隧道棘轮清单:预设覆盖、灯组、倒角使用、三档画面判据。 |
| `app/tests/bg3d-performance-budget.spec.js`(修改) | 预算扩到 50 条 × 三档。 |
| `app/package.json`(修改) | `verify:three-addons` / `sync:three-addons`,并入 `predist`。 |
| `.gitignore`(修改) | 忽略 `vj-shots/`。 |
| `HANDOFF.md`(修改) | 交给 ChatGPT 的用法、规则、验收流程与批次顺序。 |

---

### Task 1: 截图 / 指标工具 + 改造前基线

**Files:**
- Create: `app/scripts/vj-shots.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 现有全局 `enableBg3D`、`renderBg3D`、`seedBg3DBuilds`、`vjDropCachedScene`、`vjSpeedBassSmooth`、`bg3DRenderer`、`recordQuality`、`enterRecordingResolution`、`exitRecordingResolution`、`composeCaptureFrame`;若存在则用 `setBg3DPostAA`(Task 3 起)。
- Produces: 命令 `node scripts/vj-shots.js --out <dir> --kinds a,b [--tiers low,balanced,ultra] [--aa off|fxaa|smaa] [--record 4k|1440p|1080p] [--measure] [--crop fx,fy] [--crops-only]`,输出 `<dir>/<tier>-<kind>.png`、`<dir>/<tier>-<kind>-crop.png`、`<dir>/metrics.json`(数组,每项 `{tier, kind, aa, record, width, height, lit, vivid, hues, frameMs}`)。

- [ ] **Step 1: 写工具**

```js
#!/usr/bin/env node
'use strict';
/* 截图 + 指标。对比网页和每批验收都用它:
   node scripts/vj-shots.js --out ../vj-shots/baseline --kinds vjChromeFlow,vjNeonTubeRoom
     [--tiers low,balanced,ultra] [--aa off|fxaa|smaa] [--record 4k|1440p|1080p]
     [--measure] [--crop 0.62,0.35] [--crops-only]
   每张图都是固定种子、全新建场景、固定音频输入下的第 42 帧,不同批次之间可直接对比。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');
const { closeApp } = require('../tests/helpers/close-app');

const APP_DIR = path.join(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const flag = name => process.argv.includes(`--${name}`);

const out = path.resolve(arg('out', path.join(APP_DIR, '..', 'vj-shots', 'latest')));
const kinds = (arg('kinds', '') || '').split(',').filter(Boolean);
const tiers = arg('tiers', 'low,balanced,ultra').split(',');
const opts = {
  aa: arg('aa', null),
  record: arg('record', null),
  measure: flag('measure'),
  cropsOnly: flag('crops-only'),
  crop: arg('crop', '0.5,0.5').split(',').map(Number),
};
if (!kinds.length) { console.error('--kinds is required'); process.exit(2); }

function capture({ tier, kind, aa, record, measure, cropsOnly, crop }) {
  document.getElementById('intro')?.classList.add('hidden');
  const sel = document.getElementById('vjQualitySel');
  if (sel.value !== tier) { sel.value = tier; sel.dispatchEvent(new Event('change')); }
  if (aa && typeof setBg3DPostAA === 'function') setBg3DPostAA(aa);
  if (record) { recordQuality = record; enterRecordingResolution(); }
  vjDropCachedScene(kind);
  seedBg3DBuilds(0x5EED);
  vjSpeedBassSmooth = 0;
  enableBg3D(kind);
  for (let i = 0; i < 42; i++) renderBg3D(0.5, 0.4, 0.3, 1);
  const gl = bg3DRenderer.getContext();
  let frameMs = null;
  if (measure) {
    const t = [];
    for (let i = 0; i < 30; i++) { const a = performance.now(); renderBg3D(0.5, 0.4, 0.3, 1); gl.finish(); t.push(performance.now() - a); }
    t.sort((x, y) => x - y);
    frameMs = +t[15].toFixed(2);
    renderBg3D(0.5, 0.4, 0.3, 1);
  }
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let lit = 0, vivid = 0; const hues = new Set();
  for (let i = 0; i < w * h; i++) {
    const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 40) continue;
    lit++;
    if ((mx - mn) / mx > 0.5) { vivid++; hues.add(Math.round(Math.atan2(g - b, r - g) * 6)); }
  }
  // 3D 层是自定义 alpha 管线:不把 alpha 强制成 255,看图器会把透明像素垫成白底,误判成过曝
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  const full = document.createElement('canvas'); full.width = w; full.height = h;
  full.getContext('2d').putImageData(img, 0, 0);
  // 录制模式裁的是成片合成帧 —— 3D 层被放大进成片时发软,只有这里看得出来
  const src = record ? composeCaptureFrame() : full;
  const CW = 220, CH = 124;
  const sx = Math.round(src.width * crop[0] - CW / 2), sy = Math.round(src.height * crop[1] - CH / 2);
  const zoom = document.createElement('canvas'); zoom.width = CW * 3; zoom.height = CH * 3;
  const zc = zoom.getContext('2d'); zc.imageSmoothingEnabled = false;
  zc.drawImage(src, sx, sy, CW, CH, 0, 0, CW * 3, CH * 3);
  if (record) exitRecordingResolution();
  return {
    tier: vjQuality, kind, aa: typeof bg3DPostAA === 'string' ? bg3DPostAA : 'n/a', record,
    width: w, height: h, lit: +(lit / (w * h)).toFixed(4), vivid: +(vivid / Math.max(1, lit)).toFixed(4),
    hues: hues.size, frameMs,
    full: cropsOnly ? null : full.toDataURL('image/png').split(',')[1],
    crop: zoom.toDataURL('image/png').split(',')[1],
  };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-shots-'));
  let app = null, win = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await win.waitForFunction(() => (document.getElementById('cv')?.width || 0) > 300, null, { timeout: 30000 });
    const metrics = [];
    for (const tier of tiers) for (const kind of kinds) {
      const r = await win.evaluate(capture, { tier, kind, ...opts });
      if (r.full) fs.writeFileSync(path.join(out, `${tier}-${kind}.png`), Buffer.from(r.full, 'base64'));
      fs.writeFileSync(path.join(out, `${tier}-${kind}-crop.png`), Buffer.from(r.crop, 'base64'));
      delete r.full; delete r.crop;
      metrics.push(r);
      console.log(JSON.stringify(r));
    }
    fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(metrics, null, 2));
  } finally {
    await closeApp(app, win);
    fs.rmSync(userData, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
```

- [ ] **Step 2: 忽略输出目录**

在仓库根目录 `.gitignore` 的 `# Node / Electron` 段末尾加一行:

```
vj-shots/
```

- [ ] **Step 3: 拍改造前基线(三组)**

```bash
taskkill //F //IM electron.exe 2>/dev/null
node scripts/vj-shots.js --out ../vj-shots/baseline --kinds vjChromeFlow,vjNeonTubeRoom,vjStarLane,vjWaveCorridor,vjSpeedGates --crop 0.62,0.35
node scripts/vj-shots.js --out ../vj-shots/baseline-measure --kinds vjChromeFlow,vjNeonTubeRoom --measure --crops-only
node scripts/vj-shots.js --out ../vj-shots/baseline-rec --kinds vjChromeFlow,vjNeonTubeRoom --tiers balanced,ultra --record 4k --measure --crops-only --crop 0.62,0.35
```

Expected:每条命令逐行打印 JSON;`../vj-shots/baseline/` 下有 15 张整帧 + 15 张裁切 + `metrics.json`。`balanced`/`vjNeonTubeRoom` 的 `lit` 应在 0.52~0.60(`vj-five-depth.spec.js` 同条件下是 55.8%)——差得多说明工具的采样条件不对,先修工具。

- [ ] **Step 4: 看两张图确认**

用 Read 工具打开 `../vj-shots/baseline/balanced-vjChromeFlow.png` 和 `../vj-shots/baseline-rec/balanced-vjChromeFlow-crop.png`:前者是正常画面(黑底、无白底),后者是 4K 成片里放大的边缘,应能看出发软。

- [ ] **Step 5: Commit**

```bash
cd .. && git add .gitignore app/scripts/vj-shots.js
git commit -m "$(cat <<'EOF'
chore(tools): add vj-shots for seeded VJ screenshots, edge crops and metrics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 移植 three r149 的 FXAA / SMAA / RoundedBoxGeometry

**Files:**
- Create: `app/scripts/vendor-three-r149-addons.js`
- Create: `src/three/addons-r149.js`(由脚本生成)
- Create: `app/scripts/sync-three-addons.js`
- Create: `app/tests/three-addons-source.spec.js`
- Modify: `61.html`(在 `/* THREE_SCENE_CACHE:END */` 后插入生成块标记)
- Modify: `app/package.json`

**Interfaces:**
- Produces: 全局 `THREE_R149_ADDONS = { FXAAShader, SMAAPass, RoundedBoxGeometry, smaaImages: { area, search }, smaaReady }`。`smaaImages` 是解码一次、所有 SMAA pass 共用的查找图;`smaaReady` 是它们解码完成的 Promise。
- 命令:`npm run sync:three-addons`(写入)、`npm run verify:three-addons`(校验)。

- [ ] **Step 1: 写失败测试**

`app/tests/three-addons-source.spec.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');
const ROOT = path.join(APP_DIR, '..');
const SOURCE = path.join(ROOT, 'src', 'three', 'addons-r149.js');
const TARGET = path.join(ROOT, '61.html');
const SYNC = path.join(APP_DIR, 'scripts', 'sync-three-addons.js');
const verify = (root = ROOT) => spawnSync(process.execPath, [SYNC, '--root', root], { encoding: 'utf8' });

test('r149 附加件源文件与 standalone 同步,漂移时校验失败', () => {
  const current = verify();
  expect(current.status, current.stderr || current.stdout).toBe(0);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-three-addons-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'src', 'three'), { recursive: true });
    fs.copyFileSync(SOURCE, path.join(tempRoot, 'src', 'three', 'addons-r149.js'));
    fs.writeFileSync(path.join(tempRoot, '61.html'),
      fs.readFileSync(TARGET, 'utf8').replace('this.needsSwap = true;', 'this.needsSwap = false;'));
    const stale = verify(tempRoot);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr + stale.stdout).toContain('61.html is stale');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('移植代码在应用里可用:圆角面数正确,SMAA 接在合成链中间能出图', async () => {
  const dir = newUserDataDir('three-addons');
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const r = await win.evaluate(async () => {
      document.getElementById('intro')?.classList.add('hidden');
      const A = THREE_R149_ADDONS;
      const tris = s => new A.RoundedBoxGeometry(1.5, 1.5, 3.2, s, 0.22).index.count / 3;
      await A.smaaReady;
      enableBg3D('vjChromeFlow');
      const s = bg3DScenes.vjChromeFlow, size = bg3DRenderer.getDrawingBufferSize(new THREE.Vector2());
      const p = new A.SMAAPass(size.x, size.y);
      s.composer.insertPass(p, s.composer.passes.findIndex(q => q.__bg3dAlpha));
      for (let i = 0; i < 3; i++) renderBg3D(0.5, 0.4, 0.3, 1);
      const gl = bg3DRenderer.getContext();
      return { keys: Object.keys(A).sort(), tris1: tris(1), tris2: tris(2), glErr: gl.getError(),
               needsSwap: p.needsSwap, imagesDecoded: A.smaaImages.area.complete && A.smaaImages.search.complete };
    });
    expect(r.keys).toEqual(['FXAAShader', 'RoundedBoxGeometry', 'SMAAPass', 'smaaImages', 'smaaReady']);
    expect(r.tris1).toBe(108);
    expect(r.tris2).toBe(300);
    expect(r.glErr).toBe(0);
    expect(r.needsSwap, 'SMAA 后面还有 alpha pass,必须交换缓冲').toBe(true);
    expect(r.imagesDecoded).toBe(true);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx playwright test tests/three-addons-source.spec.js --reporter=list`
Expected: 两条都 FAIL(`sync-three-addons.js` 不存在;页面里 `THREE_R149_ADDONS is not defined`)。

- [ ] **Step 3: 写 vendor 脚本**

`app/scripts/vendor-three-r149-addons.js`:

```js
#!/usr/bin/env node
'use strict';
/* 从解压好的 three@0.149.0 包生成 src/three/addons-r149.js:
     cd <tmp> && npm pack three@0.149.0 && tar -xzf three-0.149.0.tgz
     node scripts/vendor-three-r149-addons.js <tmp>/package [--only fxaa|smaa]
   只做机械改写:去掉 import/export,依赖改从全局 THREE 取,整体包进一个 IIFE。 */
const fs = require('fs');
const path = require('path');

const pkg = process.argv[2];
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
if (!pkg) { console.error('usage: vendor-three-r149-addons.js <three-package-dir> [--only fxaa|smaa]'); process.exit(2); }
const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
if (version !== '0.149.0') throw new Error(`expected three@0.149.0, got ${version}`);

const withFxaa = only !== 'smaa', withSmaa = only !== 'fxaa';
const files = [
  ...(withFxaa ? ['shaders/FXAAShader.js'] : []),
  ...(withSmaa ? ['shaders/SMAAShader.js', 'postprocessing/SMAAPass.js'] : []),
  'geometries/RoundedBoxGeometry.js',
];
const strip = (src, rel) => {
  let s = src.replace(/\r\n/g, '\n');
  s = s.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\n/gm, '');
  s = s.replace(/^export\s*\{[^}]*\};\n?/gm, '');
  if (/^\s*(import|export)\b/m.test(s)) throw new Error(`unhandled import/export in ${rel}`);
  return s.trim();
};
const body = files.map(rel => {
  let s = strip(fs.readFileSync(path.join(pkg, 'examples', 'jsm', rel), 'utf8'), rel);
  if (rel === 'postprocessing/SMAAPass.js') {
    const before = s;
    s = s.replace('this.needsSwap = false;',
      '// PATCH(sub-remix): upstream assumes SMAA is the last pass; the alpha pass follows it here.\n\t\tthis.needsSwap = true;');
    if (s === before) throw new Error('SMAAPass needsSwap patch did not apply');
  }
  return `// ---- three@0.149.0 examples/jsm/${rel} ----\n${s}`;
}).join('\n\n');

const smaaTail = withSmaa ? `
// Decode SMAA's lookup images once and share them: each SMAAPass would otherwise decode its own copy
// asynchronously and render un-antialiased until that finishes.
const smaaImages = { area: new Image(), search: new Image() };
smaaImages.area.src = SMAAPass.prototype.getAreaTexture();
smaaImages.search.src = SMAAPass.prototype.getSearchTexture();
const smaaReady = Promise.all([smaaImages.area.decode(), smaaImages.search.decode()]);
` : '';
const exportsList = ['RoundedBoxGeometry', ...(withFxaa ? ['FXAAShader'] : []), ...(withSmaa ? ['SMAAPass', 'smaaImages', 'smaaReady'] : [])];
const text = `/* Vendored from three@0.149.0 (MIT License, Copyright © 2010-2023 three.js authors).
   Generated by app/scripts/vendor-three-r149-addons.js — do not edit by hand. */
const THREE_R149_ADDONS = (() => {
const { BoxGeometry, LinearFilter, NearestFilter, ShaderMaterial, Texture, UniformsUtils, Vector2, Vector3, WebGLRenderTarget } = THREE;
// The bundled THREE does not export Pass / FullScreenQuad; recover them from ShaderPass.
const Pass = Object.getPrototypeOf(THREE.ShaderPass);
const FullScreenQuad = (() => {
  const probe = new THREE.ShaderPass({ uniforms: {}, vertexShader: 'void main(){ gl_Position = vec4(0.0); }', fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }' });
  const Quad = probe.fsQuad.constructor;
  probe.dispose();
  return Quad;
})();

${body}
${smaaTail}
return { ${exportsList.join(', ')} };
})();
`;
const out = path.join(__dirname, '..', '..', 'src', 'three', 'addons-r149.js');
fs.writeFileSync(out, text);
console.log(`vendor-three-r149-addons: wrote ${path.relative(process.cwd(), out)} (${text.length} bytes, ${exportsList.join(', ')})`);
```

- [ ] **Step 4: 生成 `src/three/addons-r149.js`**

```bash
T="$LOCALAPPDATA/Temp/three149"; mkdir -p "$T" && (cd "$T" && npm pack three@0.149.0 --silent && tar -xzf three-0.149.0.tgz)
node scripts/vendor-three-r149-addons.js "$T/package"
node --check ../src/three/addons-r149.js && echo SYNTAX_OK
```

Expected: `wrote ../src/three/addons-r149.js (…, RoundedBoxGeometry, FXAAShader, SMAAPass, smaaImages, smaaReady)` 和 `SYNTAX_OK`。

- [ ] **Step 5: 写同步脚本**

`app/scripts/sync-three-addons.js`(与 `sync-scene-cache.js` 同构):

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const START = '/* THREE_R149_ADDONS:START */';
const END = '/* THREE_R149_ADDONS:END */';
const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : path.resolve(__dirname, '..', '..');
const sourcePath = path.join(root, 'src', 'three', 'addons-r149.js');
const targetPath = path.join(root, '61.html');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n').trimEnd();
const target = fs.readFileSync(targetPath, 'utf8');
const start = target.indexOf(START), end = target.indexOf(END);

if (start < 0 || end < start) {
  console.error('three-addons: generated block markers are missing or malformed');
  process.exitCode = 1;
} else {
  const expected = `${START}\n/* Generated from src/three/addons-r149.js. Do not edit this block by hand. */\n${source}\n${END}`;
  const actual = target.slice(start, end + END.length).replace(/\r\n/g, '\n');
  if (args.includes('--write')) {
    fs.writeFileSync(targetPath, target.slice(0, start) + expected + target.slice(end + END.length));
    console.log('three-addons: synchronized 61.html from src/three/addons-r149.js');
  } else if (actual !== expected) {
    console.error('three-addons: 61.html is stale; run npm run sync:three-addons');
    process.exitCode = 1;
  } else {
    console.log('three-addons: source and standalone 61.html are synchronized');
  }
}
```

- [ ] **Step 6: 加生成块标记和 npm 脚本**

`61.html`:用 Edit 把唯一的 `/* THREE_SCENE_CACHE:END */` 替换成

```
/* THREE_SCENE_CACHE:END */
/* THREE_R149_ADDONS:START */
/* THREE_R149_ADDONS:END */
```

`app/package.json` 的 `scripts` 里加(紧跟 `sync:scene-cache` 之后):

```json
"verify:three-addons": "node scripts/sync-three-addons.js",
"sync:three-addons": "node scripts/sync-three-addons.js --write",
```

并把 `predist` 里的 `&& npm run verify:replacement` 改成 `&& npm run verify:three-addons && npm run verify:replacement`。

- [ ] **Step 7: 同步并跑测试**

```bash
npm run sync:three-addons && npm run verify:three-addons
npx playwright test tests/three-addons-source.spec.js tests/scene-cache-source.spec.js --reporter=list
```

Expected: 同步与校验成功;4 条测试全部 PASS。

- [ ] **Step 8: Commit**

```bash
cd .. && cp 61.html replacement/61.html
git add 61.html replacement/61.html src/three/addons-r149.js app/scripts/vendor-three-r149-addons.js app/scripts/sync-three-addons.js app/tests/three-addons-source.spec.js app/package.json
git commit -m "$(cat <<'EOF'
feat(three): vendor r149 FXAA, SMAA and RoundedBoxGeometry as a synced block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 后处理抗锯齿 pass(FXAA / SMAA 可切换,供对比)

**Files:**
- Modify: `61.html`(`makeBg3DAlphaPass` 之后新增;`ensureBg3DComposer` 插入 AA pass)
- Create: `app/tests/bg3d-post-aa.spec.js`

**Interfaces:**
- Consumes: `THREE_R149_ADDONS`(Task 2)。
- Produces: 全局 `bg3DPostAA`(`'smaa' | 'fxaa' | 'off'`)、`makeBg3DAAPass(): Pass | null`、`setBg3DPostAA(mode: string): void`;pass 标记 `pass.__bg3dAA === true`;位置:grade pass 之后、alpha pass 之前。

- [ ] **Step 1: 写失败测试**

`app/tests/bg3d-post-aa.spec.js`:

```js
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const APP_DIR = path.join(__dirname, '..');

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(async () => { document.getElementById('intro')?.classList.add('hidden'); await THREE_R149_ADDONS.smaaReady; });
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
}
const MODES = ['smaa', 'fxaa'];

test('三档 × 两种模式:恰好一道 AA pass,位于调色之后、写 alpha 之前,出图正常', async () => {
  test.setTimeout(120_000);
  await withApp('post-aa-order', async win => {
    const rows = await win.evaluate(modes => {
      const out = [];
      for (const tier of ['low', 'balanced', 'ultra']) {
        const sel = document.getElementById('vjQualitySel'); sel.value = tier; sel.dispatchEvent(new Event('change'));
        for (const mode of modes) {
          setBg3DPostAA(mode);
          enableBg3D('vjChromeFlow');
          for (let i = 0; i < 3; i++) renderBg3D(0.5, 0.4, 0.3, 1);
          const passes = bg3DScenes.vjChromeFlow.composer.passes;
          const gl = bg3DRenderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
          const buf = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          let lit = 0; for (let i = 0; i < buf.length; i += 4) if (Math.max(buf[i], buf[i + 1], buf[i + 2]) >= 40) lit++;
          out.push({ tier, mode, count: passes.filter(p => p.__bg3dAA).length,
            aa: passes.findIndex(p => p.__bg3dAA), grade: passes.findIndex(p => p.__bg3dGrade),
            alpha: passes.findIndex(p => p.__bg3dAlpha), glErr: gl.getError(), lit: lit / (w * h) });
        }
      }
      return out;
    }, MODES);
    for (const r of rows) {
      const tag = `${r.tier}/${r.mode}`;
      expect.soft(r.count, `${tag}: AA pass 数量`).toBe(1);
      expect.soft(r.aa, `${tag}: AA 必须紧挨在 alpha 前`).toBe(r.alpha - 1);
      expect.soft(r.aa, `${tag}: AA 必须在调色之后`).toBeGreaterThan(r.grade);
      expect.soft(r.glErr, `${tag}: GL error`).toBe(0);
      expect.soft(r.lit, `${tag}: 画面空了`).toBeGreaterThan(0.2);
    }
  });
});

test('off 时没有 AA pass;关掉透出背景时 AA 成为最后一道 pass 仍照常出图', async () => {
  await withApp('post-aa-edges', async win => {
    const r = await win.evaluate(() => {
      setBg3DPostAA('off');
      enableBg3D('vjChromeFlow');
      const offCount = bg3DScenes.vjChromeFlow.composer.passes.filter(p => p.__bg3dAA).length;
      setBg3DPostAA('smaa');
      bg3DSeeThrough = false; applyBg3DSeeThrough();
      enableBg3D('vjChromeFlow');
      for (let i = 0; i < 3; i++) renderBg3D(0.5, 0.4, 0.3, 1);
      const enabled = bg3DScenes.vjChromeFlow.composer.passes.filter(p => p.enabled);
      const gl = bg3DRenderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let lit = 0; for (let i = 0; i < buf.length; i += 4) if (Math.max(buf[i], buf[i + 1], buf[i + 2]) >= 40) lit++;
      bg3DSeeThrough = true; applyBg3DSeeThrough();
      return { offCount, lastIsAA: !!enabled[enabled.length - 1].__bg3dAA, lit: lit / (w * h) };
    });
    expect(r.offCount).toBe(0);
    expect(r.lastIsAA).toBe(true);
    expect(r.lit).toBeGreaterThan(0.2);
  });
});

test('AA 的分辨率跟着合成器尺寸走', async () => {
  await withApp('post-aa-size', async win => {
    const r = await win.evaluate(modes => modes.map(mode => {
      setBg3DPostAA(mode);
      enableBg3D('vjChromeFlow');
      resizeBg3D(800, 450);
      const pr = bg3DRenderer.getPixelRatio();
      const p = bg3DScenes.vjChromeFlow.composer.passes.find(q => q.__bg3dAA);
      const res = mode === 'smaa' ? p.materialEdges.uniforms.resolution.value : p.material.uniforms.resolution.value;
      const got = { mode, x: res.x, y: res.y, want: [1 / (800 * pr), 1 / (450 * pr)] };
      resizeBg3D();
      return got;
    }), MODES);
    for (const m of r) {
      expect(m.x, m.mode).toBeCloseTo(m.want[0], 8);
      expect(m.y, m.mode).toBeCloseTo(m.want[1], 8);
    }
  });
});

test('同一帧上 AA 明显减少硬台阶(low 档 StarLane:细光带最容易出锯齿)', async () => {
  test.setTimeout(120_000);
  await withApp('post-aa-effect', async win => {
    const r = await win.evaluate(modes => {
      const sel = document.getElementById('vjQualitySel'); sel.value = 'low'; sel.dispatchEvent(new Event('change'));
      // 相邻像素亮度差 > 16 算边缘,> 96 算硬台阶;抗锯齿把一步跳变拆成几小步
      const hardRatio = () => {
        const gl = bg3DRenderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const b = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
        const L = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) L[i] = 0.299 * b[i * 4] + 0.587 * b[i * 4 + 1] + 0.114 * b[i * 4 + 2];
        let edges = 0, hard = 0;
        for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
          const i = y * w + x;
          for (const d of [Math.abs(L[i + 1] - L[i]), Math.abs(L[i + w] - L[i])]) if (d > 16) { edges++; if (d > 96) hard++; }
        }
        return hard / Math.max(1, edges);
      };
      const frame = mode => {
        setBg3DPostAA(mode);
        vjDropCachedScene('vjStarLane'); seedBg3DBuilds(0xA11A5); vjSpeedBassSmooth = 0;
        enableBg3D('vjStarLane');
        for (let i = 0; i < 30; i++) renderBg3D(0.5, 0.4, 0.3, 1);
        return hardRatio();
      };
      const out = { off: frame('off') };
      for (const m of modes) out[m] = frame(m);
      return out;
    }, MODES);
    console.log(`hard-step ratio  off=${r.off.toFixed(4)}  smaa=${r.smaa.toFixed(4)}  fxaa=${r.fxaa.toFixed(4)}`);
    expect(r.off, '基准帧本身应该有明显锯齿,否则这条测不出东西').toBeGreaterThan(0.1);
    for (const m of MODES) expect(r[m], m).toBeLessThan(r.off * 0.25);
  });
});

test('SMAA pass 用的是共享的已解码查找图,解码完成后贴图已上传', async () => {
  await withApp('post-aa-smaa-ready', async win => {
    const r = await win.evaluate(() => {
      setBg3DPostAA('smaa');
      enableBg3D('vjChromeFlow');
      renderBg3D(0.5, 0.4, 0.3, 1);
      const p = bg3DScenes.vjChromeFlow.composer.passes.find(q => q.__bg3dAA);
      return { shared: p.areaTexture.image === THREE_R149_ADDONS.smaaImages.area && p.searchTexture.image === THREE_R149_ADDONS.smaaImages.search,
               uploaded: p.areaTexture.version > 0 && p.searchTexture.version > 0 };
    });
    expect(r.shared).toBe(true);
    expect(r.uploaded).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx playwright test tests/bg3d-post-aa.spec.js --reporter=list`
Expected: 全部 FAIL,`setBg3DPostAA is not defined`。

- [ ] **Step 3: 实现 AA pass**

在 `61.html` 的 `function makeBg3DAlphaPass(){ … }` 结束之后插入:

```js
/* ---------- 后处理抗锯齿 ----------
   MSAA 只管几何边缘;1px 线、着色器画出的边、bloom 之后的高光边都要靠这一道。
   放在调色之后、写 alpha 之前:alpha 按最终 rgb 算,必须在平滑之后。 */
let bg3DPostAA = 'smaa';   // 'smaa' | 'fxaa' | 'off' —— Task 5 定下最终方案
function makeBg3DAAPass(){
  if(bg3DPostAA === 'off') return null;
  const size = ensureBg3DRenderer().getDrawingBufferSize(new THREE.Vector2());
  const w = Math.max(1, size.x), h = Math.max(1, size.y);
  let p;
  if(bg3DPostAA === 'smaa'){
    const A = THREE_R149_ADDONS;
    p = new A.SMAAPass(w, h);
    [p.materialEdges, p.materialWeights, p.materialBlend].forEach(m => { m.blending = THREE.NoBlending; });
    p.areaTexture.image = A.smaaImages.area;
    p.searchTexture.image = A.smaaImages.search;
    const upload = () => { p.areaTexture.needsUpdate = true; p.searchTexture.needsUpdate = true; };
    if(A.smaaImages.area.complete && A.smaaImages.search.complete) upload(); else A.smaaReady.then(upload);
  }else{
    p = new THREE.ShaderPass(THREE_R149_ADDONS.FXAAShader);
    p.material.blending = THREE.NoBlending;
    // ShaderPass.setSize 在 r149 是空实现;FXAA 需要 1/像素 尺寸
    p.setSize = (sw, sh) => p.material.uniforms.resolution.value.set(1 / Math.max(1, sw), 1 / Math.max(1, sh));
    p.setSize(w, h);
  }
  p.__bg3dAA = true;
  return p;
}
function setBg3DPostAA(mode){
  if(!['smaa', 'fxaa', 'off'].includes(mode) || mode === bg3DPostAA) return;
  bg3DPostAA = mode;
  Object.keys(bg3DScenes).forEach(vjDropCachedScene);
  if(bg3DKind) enableBg3D(bg3DKind);
}
```

在 `ensureBg3DComposer` 里,grade 插入块(`if(!passes.some(p=>p.__bg3dGrade)){ … }`)之后、`if(!passes.length || !passes[passes.length-1].__bg3dAlpha) …` 之前加:

```js
  if(!passes.some(p=>p.__bg3dAA)){
    const aa = makeBg3DAAPass();
    if(aa){
      const ai = passes.findIndex(p=>p.__bg3dAlpha);
      if(ai >= 0) s.composer.insertPass(aa, ai); else s.composer.addPass(aa);
    }
  }
```

- [ ] **Step 4: 跑测试确认通过,并跑回归**

```bash
taskkill //F //IM electron.exe 2>/dev/null
npx playwright test tests/bg3d-post-aa.spec.js tests/vj-long-session-soak.spec.js tests/bg3d-performance-budget.spec.js tests/vj-five-depth.spec.js tests/vj-quality-tiers.spec.js tests/vj-highlight-headroom.spec.js --reporter=list
```

Expected: 全部 PASS;第 4 条打印的 `hard-step ratio` 里 off 约 0.30,smaa、fxaa 都在 0.03 以下。soak 测试的 ShaderMaterial / Texture 前后计数仍相等(SMAA 的材质和渲染目标随场景回收)。

- [ ] **Step 5: Commit**

```bash
cd .. && cp 61.html replacement/61.html
git add 61.html replacement/61.html app/tests/bg3d-post-aa.spec.js
git commit -m "$(cat <<'EOF'
feat(bg3d): post-process anti-aliasing pass between grade and alpha

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 录制时按录制画质渲染 3D 层

**Files:**
- Modify: `61.html`(`resizeBg3D`、`bg3DMsaaSamples`、`enterRecordingResolution`、`exitRecordingResolution`)
- Create: `app/tests/bg3d-recording-resolution.spec.js`

**Interfaces:**
- Consumes: 全局 `recordingResolutionActive`、`W`、`H`、`recordQuality`、`musicState`。
- Produces: `bg3DTargetPixelRatio(stageW: number): number`、`applyBg3DMsaaSamples(): void`;`bg3DMsaaSamples()` 在录制中返回 `min(档位倍数, 2)`。

- [ ] **Step 1: 写失败测试**

`app/tests/bg3d-recording-resolution.spec.js`:

```js
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const APP_DIR = path.join(__dirname, '..');

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => document.getElementById('intro')?.classList.add('hidden'));
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
}
// 页面内:当前 3D 状态快照
const STATE = `() => {
  const s = bg3DScenes[bg3DKind], size = bg3DRenderer.getDrawingBufferSize(new THREE.Vector2());
  return { W, H, bufW: size.x, bufH: size.y, pr: bg3DRenderer.getPixelRatio(), samples: s.composer.renderTarget1.samples };
}`;

test('录制时 3D 缓冲 = 录制分辨率、MSAA ≤ 2、第一帧合成里 3D 不是空的;停录后复原', async () => {
  test.setTimeout(120_000);
  await withApp('rec-res', async win => {
    const r = await win.evaluate(stateSrc => {
      const state = eval(stateSrc);
      const sel = document.getElementById('vjQualitySel'); sel.value = 'ultra'; sel.dispatchEvent(new Event('change'));
      enableBg3D('vjChromeFlow'); renderBg3D(0.5, 0.4, 0.3, 1);
      const before = state();
      const rows = [];
      for (const q of ['4k', '1440p', '1080p']) {
        recordQuality = q;
        enterRecordingResolution();
        const st = state();
        const cap = composeCaptureFrame();
        const d = captureCtx.getImageData(Math.floor(cap.width * 0.3), Math.floor(cap.height * 0.3), Math.floor(cap.width * 0.4), Math.floor(cap.height * 0.4)).data;
        let lit = 0; for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) >= 40) lit++;
        rows.push({ q, ...st, capLit: lit / (d.length / 4) });
        exitRecordingResolution();
      }
      return { before, rows, after: state() };
    }, STATE);
    for (const row of r.rows) {
      expect.soft(Math.abs(row.bufW - row.W), `${row.q}: 3D 缓冲宽度`).toBeLessThanOrEqual(1);
      expect.soft(row.samples, `${row.q}: 录制时 MSAA 上限`).toBeLessThanOrEqual(2);
      expect.soft(row.capLit, `${row.q}: 第一帧合成里 3D 区域是空的`).toBeGreaterThan(0.05);
    }
    expect(r.after).toEqual(r.before);
  });
});

test('录制中窗口缩放不会把 3D 缓冲打回屏幕尺寸', async () => {
  await withApp('rec-res-resize', async win => {
    const r = await win.evaluate(stateSrc => {
      const state = eval(stateSrc);
      enableBg3D('vjChromeFlow');
      recordQuality = '4k'; enterRecordingResolution();
      resize();
      const during = state();
      exitRecordingResolution();
      return during;
    }, STATE);
    expect(Math.abs(r.bufW - r.W)).toBeLessThanOrEqual(1);
  });
});

test('录制中切画质档:新合成器也是录制分辨率且 MSAA ≤ 2,停录后恢复档位倍数', async () => {
  await withApp('rec-res-tier', async win => {
    const r = await win.evaluate(stateSrc => {
      const state = eval(stateSrc);
      setVjQualityTier('ultra'); enableBg3D('vjChromeFlow');
      recordQuality = '1440p'; enterRecordingResolution();
      setVjQualityTier('balanced'); setVjQualityTier('ultra');
      const during = state();
      exitRecordingResolution();
      return { during, after: state() };
    }, STATE);
    expect(Math.abs(r.during.bufW - r.during.W)).toBeLessThanOrEqual(1);
    expect(r.during.samples).toBeLessThanOrEqual(2);
    expect(r.after.samples).toBe(4);
  });
});

test('low 档录制时 MSAA 仍然是 0,不会被"限到 2"反而升上去', async () => {
  await withApp('rec-res-low', async win => {
    const r = await win.evaluate(stateSrc => {
      const state = eval(stateSrc);
      setVjQualityTier('low'); enableBg3D('vjChromeFlow');
      recordQuality = '4k'; enterRecordingResolution();
      const during = state();
      exitRecordingResolution();
      return { during, after: state() };
    }, STATE);
    expect(r.during.samples).toBe(0);
    expect(r.after.samples).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx playwright test tests/bg3d-recording-resolution.spec.js --reporter=list`
Expected: 第 1、2、3 条 FAIL(录制时 `bufW` 仍是屏幕宽度、ultra 的 samples 仍是 4);第 4 条可能已 PASS。

- [ ] **Step 3: 实现**

在 `61.html` 的 `function resizeBg3D(stageW, stageH){` 之前插入:

```js
function bg3DTargetPixelRatio(stageW){
  // 录制时按录制分辨率渲染(跟 2D 画布的 W 对齐),而不是渲染屏幕尺寸再被放大进成片
  if(recordingResolutionActive) return W / Math.max(1, stageW);
  return Math.min(window.devicePixelRatio || 1, 2);
}
```

把 `resizeBg3D` 改成:

```js
function resizeBg3D(stageW, stageH){
  const availW = Math.max(1, stageW || visualStage.clientWidth || window.innerWidth - PANEL_SAFE_ZONE);
  const availH = Math.max(1, stageH || visualStage.clientHeight || window.innerHeight - DOCK_SAFE_ZONE);
  const pr = bg3DTargetPixelRatio(availW);
  if(bg3DRenderer){
    if(bg3DRenderer.getPixelRatio() !== pr) bg3DRenderer.setPixelRatio(pr);
    bg3DRenderer.setSize(availW, availH, false);
  }
  const canvasEl = document.getElementById('bgThree');   // resize() runs once at page load, before the bgThreeCanvas const below is initialized — look it up fresh instead
  if(canvasEl){ canvasEl.style.left = '0px'; canvasEl.style.top = '0px'; canvasEl.style.width = availW + 'px'; canvasEl.style.height = availH + 'px'; }
  Object.values(bg3DScenes).forEach(s=>{
    if(s.camera){ s.camera.aspect = availW/availH; s.camera.updateProjectionMatrix(); }
    if(s.composer){ s.composer.setPixelRatio(pr); s.composer.setSize(availW, availH); }
  });
}
```

把 `bg3DMsaaSamples` 改成并在其后新增 `applyBg3DMsaaSamples`:

```js
function bg3DMsaaSamples(){
  if(vjQuality === 'low') return 0;
  const tier = vjQuality === 'ultra' ? 4 : 2;
  // 录制时 3D 层可能是 4K:多重采样限 2×,其余交给后处理抗锯齿
  return recordingResolutionActive ? Math.min(tier, 2) : tier;
}
function applyBg3DMsaaSamples(){
  const samples = bg3DMsaaSamples();
  Object.values(bg3DScenes).forEach(s=>{
    const c = s.composer;
    if(!c) return;
    [c.renderTarget1, c.renderTarget2].forEach(rt=>{
      // samples 只在分配时读取:改完 dispose,下一次渲染按新倍数重建,不用重建场景
      if(rt && rt.samples !== samples){ rt.samples = samples; rt.dispose(); }
    });
  });
}
```

`enterRecordingResolution` 在 `recordingResolutionActive = true;` 之后追加:

```js
  applyBg3DMsaaSamples();
  resizeBg3D();
  // 改缓冲尺寸会清空 WebGL 画布;马上补画一帧,startRecording 接着合成的第一帧里 3D 才不是空的
  renderBg3D(musicState.bass, musicState.mid, musicState.high, 0);
```

`exitRecordingResolution` 在 `resetEffectLayoutCaches();` 之后追加:

```js
  applyBg3DMsaaSamples();
```

- [ ] **Step 4: 跑测试确认通过,并跑录制相关回归**

```bash
taskkill //F //IM electron.exe 2>/dev/null
npx playwright test tests/bg3d-recording-resolution.spec.js tests/record-resolution.spec.js tests/recording-indicator.spec.js tests/unified-output-stage.spec.js tests/canvas-boundary.spec.js tests/record-picker-cancel.spec.js tests/bg3d-performance-budget.spec.js tests/vj-adaptive-quality.spec.js --reporter=list
```

Expected: 全部 PASS。

- [ ] **Step 5: 实测三种录制分辨率的帧时间**

```bash
for q in 4k 1440p 1080p; do node scripts/vj-shots.js --out ../vj-shots/rec-$q --kinds vjChromeFlow,vjNeonTubeRoom --tiers balanced,ultra --record $q --measure --crops-only --crop 0.62,0.35; done
```

把每个 `metrics.json` 里的 `frameMs`,连同 `../vj-shots/baseline-rec/metrics.json`(改造前:3D 按屏幕尺寸渲染),整理成一张表,暂存到 `../vj-shots/rec-frame-times.md`(Task 12 写进 HANDOFF)。用 Read 打开 `../vj-shots/rec-4k/balanced-vjChromeFlow-crop.png`,与 `../vj-shots/baseline-rec/balanced-vjChromeFlow-crop.png` 对比:改造后边缘应明显更锐利。

- [ ] **Step 6: Commit**

```bash
cd .. && cp 61.html replacement/61.html
git add 61.html replacement/61.html app/tests/bg3d-recording-resolution.spec.js
git commit -m "$(cat <<'EOF'
feat(recording): render the 3D layer at the chosen recording resolution

The VJ layer used to render at stage size and get upscaled into 4K
exports, softening every edge. Match the 2D canvas resolution while
recording, cap MSAA at 2x there, and draw one frame right after the
resize so the first composed frame is not empty.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 抗锯齿选型(**用户关口**)

**Files:**
- Modify(按用户选择):`src/three/addons-r149.js`(重新生成)、`61.html`、`app/tests/bg3d-post-aa.spec.js`、`app/tests/three-addons-source.spec.js`

**Interfaces:**
- Produces: 最终的 `bg3DPostAA` 取值集合 `['<选中的模式>', 'off']`。

- [ ] **Step 1: 拍对比素材**

```bash
taskkill //F //IM electron.exe 2>/dev/null
for aa in off fxaa smaa; do node scripts/vj-shots.js --out ../vj-shots/aa-$aa --kinds vjStarLane,vjWaveCorridor,vjChromeFlow,vjNeonTubeRoom --tiers low,balanced --aa $aa --measure --crop 0.62,0.35; done
for aa in fxaa smaa; do node scripts/vj-shots.js --out ../vj-shots/aa-$aa-rec4k --kinds vjStarLane,vjChromeFlow --tiers balanced --aa $aa --record 4k --measure --crops-only --crop 0.62,0.35; done
```

- [ ] **Step 2: 做对比网页**

先加载 `artifact-design` skill(Artifact 工具要求)。在 `../vj-shots/aa-compare/index.html` 写页面:每条隧道一节,每节按档位一行,三列并排显示 `off / FXAA / SMAA` 的放大裁切图(`<tier>-<kind>-crop.png`,`image-rendering: pixelated`),下面一张表列出 1080p 与 4K 录制下的 `frameMs`。图片用相对路径 `aa-off/…`、`aa-fxaa/…`、`aa-smaa/…`,发布时通过 Artifact 的 `files` 映射到对应 PNG。发布后把链接给用户。

- [ ] **Step 3: 请用户选择**

用 AskUserQuestion 问"抗锯齿用哪一种?",选项 `FXAA` / `SMAA`,每个选项的 description 写上在对比页里看到的区别(清晰度、残留锯齿、帧时间)。**得到回答之前不做后续步骤。**

- [ ] **Step 4: 按选择收尾(选 SMAA)**

```bash
node scripts/vendor-three-r149-addons.js "$LOCALAPPDATA/Temp/three149/package" --only smaa && npm run sync:three-addons
```

`61.html`:`makeBg3DAAPass` 删掉 `else{ … FXAAShader … }` 分支(`bg3DPostAA` 非 `'off'` 时一律走 SMAA);`setBg3DPostAA` 的合法值改为 `['smaa', 'off']`;注释 `Task 5 定下最终方案` 改为 `'smaa' | 'off'`。
测试:`bg3d-post-aa.spec.js` 的 `const MODES = ['smaa'];`;`three-addons-source.spec.js` 的期望 keys 改为 `['RoundedBoxGeometry', 'SMAAPass', 'smaaImages', 'smaaReady']`。

- [ ] **Step 4(替代): 按选择收尾(选 FXAA)**

```bash
node scripts/vendor-three-r149-addons.js "$LOCALAPPDATA/Temp/three149/package" --only fxaa && npm run sync:three-addons
```

`61.html`:`let bg3DPostAA = 'fxaa';  // 'fxaa' | 'off'`;`makeBg3DAAPass` 删掉 `if(bg3DPostAA === 'smaa'){ … }` 分支;`setBg3DPostAA` 合法值改为 `['fxaa', 'off']`。
测试:`bg3d-post-aa.spec.js` 的 `const MODES = ['fxaa'];`,删除最后一条"SMAA pass 用的是共享的已解码查找图"测试,`withApp` 里去掉 `await THREE_R149_ADDONS.smaaReady;`;`three-addons-source.spec.js` 第二条测试改为只校验 `keys` 为 `['FXAAShader', 'RoundedBoxGeometry']` 与圆角面数(删除 SMAA 相关的建 pass、`needsSwap`、`imagesDecoded` 断言以及 `await A.smaaReady`),第一条测试里的漂移注入改为 `.replace('const FXAAShader', 'const FXAAShaderX')`。

- [ ] **Step 5: 跑测试**

```bash
npx playwright test tests/bg3d-post-aa.spec.js tests/three-addons-source.spec.js tests/vj-long-session-soak.spec.js --reporter=list
```

Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
cd .. && cp 61.html replacement/61.html
git add 61.html replacement/61.html src/three/addons-r149.js app/tests/bg3d-post-aa.spec.js app/tests/three-addons-source.spec.js
git commit -m "$(cat <<'EOF'
feat(bg3d): settle on <FXAA|SMAA> for post anti-aliasing per side-by-side review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

(提交前把标题里的 `<FXAA|SMAA>` 换成用户选中的那个。)

---

### Task 6: 倒角 / 圆角几何 `vjBevelBox`

**Files:**
- Modify: `61.html`(在 `function vjTint(` 之前新增;改 `vjDropCachedScene`、`setVjQualityTier`)
- Create: `app/tests/vj-bevel-box.spec.js`

**Interfaces:**
- Consumes: `THREE_R149_ADDONS.RoundedBoxGeometry`、`vjQuality`。
- Produces: `vjBevelBox(w: number, h: number, d: number, radius: number): THREE.BufferGeometry`(共享、带 `userData.vjShared = true`;low = 单段倒角 44 面,balanced = 1 段圆角 108 面,ultra = 2 段圆角 300 面;半径自动夹紧到半边长以内)、`vjChamferBoxGeometry(w, h, d, bevel)`、`vjClearBevelCache()`。

- [ ] **Step 1: 写失败测试**

`app/tests/vj-bevel-box.spec.js`:

```js
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const APP_DIR = path.join(__dirname, '..');

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => document.getElementById('intro')?.classList.add('hidden'));
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
}

test('按档位切换精细度;尺寸准确、法线朝外、半径超过半边长时自动夹紧', async () => {
  await withApp('bevel-shape', async win => {
    const r = await win.evaluate(() => {
      const inspect = g => {
        g.computeBoundingBox();
        const size = g.boundingBox.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(4));
        const pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;
        const tris = idx ? idx.count / 3 : pos.count / 3;
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cr = new THREE.Vector3(), nv = new THREE.Vector3();
        let inward = 0, badNormal = 0, nan = 0;
        for (let t = 0; t < tris; t++) {
          const ii = [0, 1, 2].map(k => idx ? idx.getX(t * 3 + k) : t * 3 + k);
          a.fromBufferAttribute(pos, ii[0]); b.fromBufferAttribute(pos, ii[1]); c.fromBufferAttribute(pos, ii[2]);
          if ([a, b, c].some(v => !Number.isFinite(v.x + v.y + v.z))) { nan++; continue; }
          cr.subVectors(b, a).cross(c.clone().sub(a));
          if (cr.length() < 1e-9) continue;
          const centroid = a.clone().add(b).add(c).divideScalar(3);
          if (cr.dot(centroid) <= 0) inward++;
          for (const i of ii) { nv.fromBufferAttribute(nor, i); if (Math.abs(nv.length() - 1) > 1e-3 || nv.dot(centroid) <= 0) badNormal++; }
        }
        return { tris, size, inward, badNormal, nan };
      };
      const out = {};
      for (const tier of ['low', 'balanced', 'ultra']) {
        setVjQualityTier(tier);
        out[tier] = inspect(vjBevelBox(1.5, 1.5, 3.2, 0.22));
      }
      out.clamped = inspect(vjBevelBox(0.2, 0.2, 5, 0.5));
      return out;
    });
    expect(r.low).toEqual({ tris: 44, size: [1.5, 1.5, 3.2], inward: 0, badNormal: 0, nan: 0 });
    expect(r.balanced).toEqual({ tris: 108, size: [1.5, 1.5, 3.2], inward: 0, badNormal: 0, nan: 0 });
    expect(r.ultra).toEqual({ tris: 300, size: [1.5, 1.5, 3.2], inward: 0, badNormal: 0, nan: 0 });
    expect(r.clamped.size).toEqual([0.2, 0.2, 5]);
    expect(r.clamped.inward + r.clamped.badNormal + r.clamped.nan).toBe(0);
  });
});

test('同尺寸同档位共用一份;切档时清缓存并释放旧几何;场景回收不释放共享几何', async () => {
  await withApp('bevel-cache', async win => {
    const r = await win.evaluate(() => {
      setVjQualityTier('balanced');
      const g1 = vjBevelBox(1, 1, 2, 0.1), g2 = vjBevelBox(1, 1, 2, 0.1);
      let disposedOnTier = 0; g1.addEventListener('dispose', () => disposedOnTier++);
      // 场景回收:挂一个用共享几何的 mesh,回收后几何不能被 dispose
      const shared = vjBevelBox(2, 2, 2, 0.2);
      let disposedOnDrop = 0; shared.addEventListener('dispose', () => disposedOnDrop++);
      const scene = new THREE.Scene(); scene.add(new THREE.Mesh(shared, new THREE.MeshBasicMaterial()));
      bg3DScenes.__bevelTest = { scene, camera: new THREE.PerspectiveCamera(), composer: null };
      vjDropCachedScene('__bevelTest');
      const afterDrop = disposedOnDrop;
      setVjQualityTier('ultra');
      const g3 = vjBevelBox(1, 1, 2, 0.1);
      return { sameObject: g1 === g2, shared: g1.userData.vjShared === true, afterDrop, disposedOnTier, freshAfterTier: g3 !== g1 };
    });
    expect(r).toEqual({ sameObject: true, shared: true, afterDrop: 0, disposedOnTier: 1, freshAfterTier: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx playwright test tests/vj-bevel-box.spec.js --reporter=list`
Expected: FAIL,`vjBevelBox is not defined`。

- [ ] **Step 3: 实现**

在 `61.html` 的 `function vjTint(` 之前插入:

```js
/* ---------- 倒角 / 圆角方块 ----------
   直角方块边上接不到高光,是「廉价 CG」最直接的来源。按档位给精细度:
   low 单段倒角(44 面)、balanced 1 段圆角(108 面)、ultra 2 段圆角(300 面)。
   同尺寸同档位共用一份;共享几何带 vjShared,场景回收时不释放,切档时统一清。 */
const vjBevelGeoCache = new Map();
function vjBevelSegments(){ return vjQuality === 'low' ? 0 : (vjQuality === 'ultra' ? 2 : 1); }
function vjBevelBox(w, h, d, radius){
  // r149 的 RoundedBoxGeometry 不夹紧半径:超过半边长时几何会翻折
  const r = Math.min(radius, Math.min(w, h, d) / 2 * 0.999);
  const seg = vjBevelSegments();
  const key = `${w}|${h}|${d}|${r}|${seg}`;
  let g = vjBevelGeoCache.get(key);
  if(!g){
    g = seg === 0 ? vjChamferBoxGeometry(w, h, d, r) : new THREE_R149_ADDONS.RoundedBoxGeometry(w, h, d, seg, r);
    g.userData.vjShared = true;
    vjBevelGeoCache.set(key, g);
  }
  return g;
}
function vjClearBevelCache(){
  vjBevelGeoCache.forEach(g => g.dispose());
  vjBevelGeoCache.clear();
}
/* 单段倒角:26 个面 = 6 个主面 + 12 条斜边 + 8 个角,平直法线,每个斜面都能单独接一道光 */
function vjChamferBoxGeometry(w, h, d, bevel){
  const H = [w / 2, h / 2, d / 2];
  const b = Math.min(bevel, Math.min(H[0], H[1], H[2]) * 0.999);
  const pos = [], nor = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  const V = c => new THREE.Vector3(c[0], c[1], c[2]);
  const coord = (axis, sign, inset) => sign * (H[axis] - (inset ? b : 0));
  const emit = (pts, dir) => {
    n.set(dir[0], dir[1], dir[2]).normalize();
    e1.subVectors(pts[1], pts[0]); e2.subVectors(pts[2], pts[0]);
    if(e1.cross(e2).dot(n) < 0) pts.reverse();
    const tris = pts.length === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]];
    for(const t of tris) for(const k of t){ pos.push(pts[k].x, pts[k].y, pts[k].z); nor.push(n.x, n.y, n.z); }
  };
  for(let sx = -1; sx <= 1; sx++) for(let sy = -1; sy <= 1; sy++) for(let sz = -1; sz <= 1; sz++){
    const s = [sx, sy, sz], nz = [0, 1, 2].filter(i => s[i] !== 0);
    if(nz.length === 1){
      const a = nz[0], [u, v] = [0, 1, 2].filter(i => i !== a);
      const corner = (su, sv) => { const c = [0, 0, 0]; c[a] = coord(a, s[a], false); c[u] = coord(u, su, true); c[v] = coord(v, sv, true); return V(c); };
      emit([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], s);
    }else if(nz.length === 2){
      const [a, c2] = nz, e = [0, 1, 2].find(i => s[i] === 0);
      const ridge = (fullAxis, se) => { const c = [0, 0, 0]; c[a] = coord(a, s[a], fullAxis !== a); c[c2] = coord(c2, s[c2], fullAxis !== c2); c[e] = coord(e, se, true); return V(c); };
      emit([ridge(a, -1), ridge(a, 1), ridge(c2, 1), ridge(c2, -1)], s);
    }else if(nz.length === 3){
      const tip = axis => V([0, 1, 2].map(i => coord(i, s[i], i !== axis)));
      emit([tip(0), tip(1), tip(2)], s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
```

`vjDropCachedScene` 里把 `if(o.geometry) o.geometry.dispose();` 改成:

```js
    if(o.geometry && !o.geometry.userData?.vjShared) o.geometry.dispose();
```

`setVjQualityTier` 里,在 `Object.keys(bg3DScenes).forEach(vjDropCachedScene);` 之后、`if(bg3DKind) enableBg3D(bg3DKind);` 之前加:

```js
  vjClearBevelCache();   // 几何精细度跟档位走,旧档的共享几何不能留给新档
```

- [ ] **Step 4: 跑测试**

```bash
npx playwright test tests/vj-bevel-box.spec.js tests/vj-long-session-soak.spec.js tests/vj-quality-tiers.spec.js --reporter=list
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
cd .. && cp 61.html replacement/61.html
git add 61.html replacement/61.html app/tests/vj-bevel-box.spec.js
git commit -m "$(cat <<'EOF'
feat(vj): tier-aware shared bevel/rounded box geometry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 材质预设库 `vjMaterial`

**Files:**
- Modify: `61.html`(在 `vjBevelBox` 代码块之后新增)
- Create: `app/tests/vj-material-presets.spec.js`

**Interfaces:**
- Consumes: `vjEnvMap()`、`vjQuality`。
- Produces: `VJ_MATERIAL_PRESETS = ['metal', 'satin', 'glass', 'neonCore', 'neonHousing']`、`vjMaterial(preset: string, o?: {color, opacity, side, metalness, roughness, envMapIntensity, additive}): THREE.Material`(带 `userData.vjPreset`)、`vjMatcapTexture(paint: 'metal'|'satin'|'glass'): THREE.CanvasTexture`(缓存)、`VJ_MATCAP_LOOKS`(low 档每个预设的 matcap 与增益,Task 11 校准)、`vjPresetJitter(color: THREE.Color, key: number, amount?: number): THREE.Color`(确定性亮度微差,默认 ±6%)。

- [ ] **Step 1: 写失败测试**

`app/tests/vj-material-presets.spec.js`:

```js
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const APP_DIR = path.join(__dirname, '..');

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => document.getElementById('intro')?.classList.add('hidden'));
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
}

test('每个预设在三档下是预期的材质类型,都带预设标记,受光的都有环境反射', async () => {
  await withApp('presets-types', async win => {
    const r = await win.evaluate(() => {
      ensureBg3DRenderer();   // 受光预设的环境贴图要用渲染器生成
      const out = {};
      for (const tier of ['low', 'balanced', 'ultra']) {
        setVjQualityTier(tier);
        out[tier] = Object.fromEntries(VJ_MATERIAL_PRESETS.map(p => {
          const m = vjMaterial(p);
          return [p, { type: m.type, tag: m.userData.vjPreset, env: !!m.envMap }];
        }));
      }
      let threw = false; try { vjMaterial('plastic'); } catch (_e) { threw = true; }
      return { out, threw };
    });
    const lowShaded = { type: 'MeshMatcapMaterial', env: false };
    expect(r.out.low).toEqual({
      metal: { ...lowShaded, tag: 'metal' }, satin: { ...lowShaded, tag: 'satin' }, glass: { ...lowShaded, tag: 'glass' },
      neonCore: { type: 'MeshBasicMaterial', tag: 'neonCore', env: false }, neonHousing: { ...lowShaded, tag: 'neonHousing' },
    });
    for (const tier of ['balanced', 'ultra']) {
      expect(r.out[tier]).toEqual({
        metal: { type: 'MeshStandardMaterial', tag: 'metal', env: true },
        satin: { type: 'MeshStandardMaterial', tag: 'satin', env: true },
        glass: { type: 'MeshPhysicalMaterial', tag: 'glass', env: true },
        neonCore: { type: 'MeshBasicMaterial', tag: 'neonCore', env: false },
        neonHousing: { type: 'MeshStandardMaterial', tag: 'neonHousing', env: true },
      });
    }
    expect(r.threw, '未知预设必须报错,不能悄悄退回默认材质').toBe(true);
  });
});

test('low 档 matcap 支持逐实例颜色;matcap 贴图按种类缓存', async () => {
  await withApp('presets-matcap', async win => {
    const r = await win.evaluate(() => {
      ensureBg3DRenderer();
      setVjQualityTier('low');
      const scene = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera(40, 2, 0.1, 50); cam.position.set(0, 0, 8);
      const mesh = new THREE.InstancedMesh(vjBevelBox(1.5, 1.5, 1.5, 0.2), vjMaterial('metal'), 2);
      vjPut(mesh, 0, -1.5, 0, 0, 0.4, 0.5, 0, 1, 1, 1); vjPut(mesh, 1, 1.5, 0, 0, 0.4, 0.5, 0, 1, 1, 1);
      mesh.setColorAt(0, new THREE.Color(1, 0.1, 0.1)); mesh.setColorAt(1, new THREE.Color(0.1, 0.2, 1));
      vjFlush(mesh); scene.add(mesh);
      const rt = new THREE.WebGLRenderTarget(200, 100);
      bg3DRenderer.setRenderTarget(rt); bg3DRenderer.setClearColor(0x000000, 1); bg3DRenderer.clear(); bg3DRenderer.render(scene, cam);
      const px = new Uint8Array(200 * 100 * 4); bg3DRenderer.readRenderTargetPixels(rt, 0, 0, 200, 100, px);
      bg3DRenderer.setRenderTarget(null); bg3DRenderer.setClearColor(0x000000, 0); rt.dispose();
      let red = 0, blue = 0;
      for (let y = 0; y < 100; y++) for (let x = 0; x < 200; x++) {
        const i = (y * 200 + x) * 4, R = px[i], B = px[i + 2];
        // 金属 matcap 主体偏暗,只有地平线和高光处亮 —— 阈值按「看得出颜色」取,不按「够亮」取
        if (x < 100 && R > 30 && R > B * 2) red++;
        if (x >= 100 && B > 30 && B > R * 2) blue++;
      }
      return { red, blue, cached: vjMatcapTexture('metal') === vjMatcapTexture('metal') };
    });
    expect(r.red, '左边实例应该是红色').toBeGreaterThan(100);
    expect(r.blue, '右边实例应该是蓝色').toBeGreaterThan(100);
    expect(r.cached).toBe(true);
  });
});

test('逐实例微差是确定性的,幅度在 ±amount 以内', async () => {
  await withApp('presets-jitter', async win => {
    const r = await win.evaluate(() => {
      const f = k => vjPresetJitter(new THREE.Color(0.5, 0.5, 0.5), k, 0.06).r / 0.5;
      const a = [...Array(200).keys()].map(f), b = [...Array(200).keys()].map(f);
      return { same: a.every((v, i) => v === b[i]), min: Math.min(...a), max: Math.max(...a), distinct: new Set(a.map(v => v.toFixed(3))).size };
    });
    expect(r.same).toBe(true);
    expect(r.min).toBeGreaterThanOrEqual(0.94 - 1e-9);
    expect(r.max).toBeLessThanOrEqual(1.06 + 1e-9);
    expect(r.distinct).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx playwright test tests/vj-material-presets.spec.js --reporter=list`
Expected: FAIL,`VJ_MATERIAL_PRESETS is not defined`。

- [ ] **Step 3: 实现**

在 `61.html` 的 `vjChamferBoxGeometry` 函数之后插入:

```js
/* ---------- 材质预设库 ----------
   每个预设都明确避开「塑料区」(中等粗糙、非金属、无反射、整片同色):
   要么真金属带环境反射,要么哑光面靠逆光勾轮廓,要么玻璃,要么真正的发光体。
   档位由预设自己处理:low 用 matcap(一次贴图查找就有明暗和高光),受光档用 PBR。 */
const VJ_MATERIAL_PRESETS = ['metal', 'satin', 'glass', 'neonCore', 'neonHousing'];
const VJ_LIT_LOOKS = {
  metal:       { metalness: 0.72, roughness: 0.22, envMapIntensity: 0.6 },
  satin:       { metalness: 0.05, roughness: 0.62, envMapIntensity: 0.25 },
  glass:       { metalness: 0.0,  roughness: 0.08, envMapIntensity: 0.9, opacity: 0.45 },
  neonHousing: { metalness: 0.85, roughness: 0.3,  envMapIntensity: 0.5, color: 0x2a2e36 },
};
// gain:low 档 matcap 的整体亮度倍率,由示范隧道的三档画面判据校准(Task 11)
const VJ_MATCAP_LOOKS = {
  metal:       { paint: 'metal', gain: 1.0 },
  satin:       { paint: 'satin', gain: 1.0 },
  glass:       { paint: 'glass', gain: 1.0 },
  neonHousing: { paint: 'metal', gain: 0.35 },
};
const vjMatcapCache = {};
function vjMatcapTexture(paint){
  if(vjMatcapCache[paint]) return vjMatcapCache[paint];
  const S = 256, R = S / 2, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.save(); g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
  const radial = (x, y, r0, r1, stops) => {
    const gr = g.createRadialGradient(x, y, r0, x, y, r1);
    stops.forEach(([t, c]) => gr.addColorStop(t, c));
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  };
  if(paint === 'metal'){
    radial(R * 0.8, R * 0.7, 0, R * 1.3, [[0, '#6a6e76'], [0.6, '#2a2c32'], [1, '#0b0c0f']]);
    // 一条亮地平线 —— 跟 vjEnvMap 一样,这是「这是金属」最关键的线索
    const band = g.createLinearGradient(0, R * 0.80, 0, R * 1.05);
    band.addColorStop(0, 'rgba(235,240,250,0)'); band.addColorStop(0.5, 'rgba(235,240,250,0.9)'); band.addColorStop(1, 'rgba(235,240,250,0)');
    g.fillStyle = band; g.fillRect(0, R * 0.80, S, R * 0.25);
    radial(R * 0.62, R * 0.52, 0, R * 0.3, [[0, 'rgba(255,255,255,0.95)'], [1, 'rgba(255,255,255,0)']]);
    radial(R, R, R * 0.8, R, [[0, 'rgba(150,175,210,0)'], [1, 'rgba(150,175,210,0.6)']]);
  }else if(paint === 'satin'){
    radial(R * 0.7, R * 0.6, 0, R * 1.4, [[0, '#e6e6e6'], [0.55, '#8a8a8a'], [1, '#2e2e2e']]);
    radial(R, R, R * 0.78, R, [[0, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0.45)']]);
  }else{
    radial(R, R, 0, R, [[0, '#101216'], [0.7, '#1c2026'], [1, '#9fb4cc']]);
    radial(R * 0.6, R * 0.45, 0, R * 0.22, [[0, 'rgba(255,255,255,0.95)'], [1, 'rgba(255,255,255,0)']]);
    radial(R * 1.35, R * 1.4, 0, R * 0.2, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
  }
  g.restore();
  return (vjMatcapCache[paint] = new THREE.CanvasTexture(cv));
}
function vjMaterial(preset, o){
  if(!VJ_MATERIAL_PRESETS.includes(preset)) throw new Error(`unknown VJ material preset: ${preset}`);
  o = o || {};
  const lit = VJ_LIT_LOOKS[preset] || {};
  const color = o.color !== undefined ? o.color : (lit.color !== undefined ? lit.color : 0xffffff);
  const opacity = o.opacity !== undefined ? o.opacity : (lit.opacity !== undefined ? lit.opacity : 1);
  const side = o.side !== undefined ? o.side : THREE.FrontSide;
  let m;
  if(preset === 'neonCore'){
    m = new THREE.MeshBasicMaterial({ color, side, transparent: opacity < 1 || !!o.additive, opacity,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !o.additive });
  }else if(vjQuality === 'low'){
    const look = VJ_MATCAP_LOOKS[preset];
    m = new THREE.MeshMatcapMaterial({ matcap: vjMatcapTexture(look.paint), color: new THREE.Color(color).multiplyScalar(look.gain),
      side, transparent: opacity < 1, opacity });
  }else{
    const Ctor = preset === 'glass' ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    m = new Ctor({ color, side, transparent: opacity < 1, opacity,
      metalness: o.metalness !== undefined ? o.metalness : lit.metalness,
      roughness: o.roughness !== undefined ? o.roughness : lit.roughness });
    if(preset === 'glass'){ m.clearcoat = 1; m.clearcoatRoughness = 0.06; }
    m.envMap = vjEnvMap();
    m.envMapIntensity = o.envMapIntensity !== undefined ? o.envMapIntensity : lit.envMapIntensity;
  }
  m.userData.vjPreset = preset;
  return m;
}
/* 确定性的逐实例亮度微差,避免整片同色的塑料感。key 必须是元素的「世界编号」
   (槽位编号 + 已退格次数,取模槽位总数),不能用槽位编号 —— 否则每次退格花纹都会跳。 */
function vjPresetJitter(c, key, amount){
  const a = amount === undefined ? 0.06 : amount;
  const h = Math.sin(key * 12.9898 + 78.233) * 43758.5453;
  return c.multiplyScalar(1 + a * (2 * (h - Math.floor(h)) - 1));
}
```

- [ ] **Step 4: 跑测试**

```bash
npx playwright test tests/vj-material-presets.spec.js tests/vj-long-session-soak.spec.js --reporter=list
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
cd .. && cp 61.html replacement/61.html
git add 61.html replacement/61.html app/tests/vj-material-presets.spec.js
git commit -m "$(cat <<'EOF'
feat(vj): tier-aware material presets with matcap fallback on low

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: SpeedGates 实例化 + 强调色按世界编号 + 预算扩到 50 条 × 三档

**Files:**
- Modify: `61.html`(整体替换 `buildBg3DVjSpeedGates`;`BG3D_PERFORMANCE_BUDGET` 加 `low`)
- Create: `app/tests/vj-element-continuity.spec.js`
- Modify: `app/tests/bg3d-performance-budget.spec.js`

**Interfaces:**
- Produces: `app/tests/vj-element-continuity.spec.js` 的 `zTrack` 页面函数(Task 10 追加 NeonTubeRoom 用例);`BG3D_PERFORMANCE_BUDGET.low`。

背景:这些隧道用"槽位"循环——元素走过一个间距后全体退一格,由后面的槽位接上。位置因此无缝,但凡是用**槽位编号**决定的外观(SpeedGates 的 `i%5===0` 强调色),每次退格都会留在原地:橙色门往前一格就弹回来,约每 3 帧频闪一次。元素的世界编号是 `i + Math.floor(scroll / SPACING)`;取模周期必须整除槽位总数,否则每圈循环首尾对不上,所以门数从 26 改为 25(`ACCENT_EVERY = 5`)。另外 26 扇门 × 4 根独立 Mesh 是 119 次 draw call,超过 80 的预算。

- [ ] **Step 1: 写失败测试(连续性 + 预算)**

`app/tests/vj-element-continuity.spec.js`:

```js
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const APP_DIR = path.join(__dirname, '..');

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => document.getElementById('intro')?.classList.add('hidden'));
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
}

/* 页面内:逐帧推进(只算状态、不画),用 z 把相邻两帧的同一个元素配对。
   z 是槽位循环里唯一对物理元素连续的坐标。统计两类跳变:
     pops  —— 隧道中段凭空出现的元素(没有上一帧的对应者)
     flips —— 配上对的元素,强调/普通类别变了 */
function zTrack({ kind, frames, dt }) {
  seedBg3DBuilds(0x2717); vjDropCachedScene(kind); vjSpeedBassSmooth = 0; enableBg3D(kind);
  const s = bg3DScenes[kind];
  const pick = {
    // SpeedGates:上横梁(每扇门一根),强调色 = 偏红
    vjSpeedGates: () => {
      const bars = s.scene.children.find(o => o.isInstancedMesh && o.geometry.parameters?.width === 30);
      const m = new THREE.Matrix4(), c = new THREE.Color(), out = [];
      for (let i = 0; i < bars.count; i += 2) { bars.getMatrixAt(i, m); bars.getColorAt(i, c); out.push({ z: m.elements[14], cls: c.r > c.b ? 1 : 0 }); }
      return out;
    },
    // NeonTubeRoom:方环(每个可见环取一个),类别 = 偏青还是偏品红
    vjNeonTubeRoom: () => {
      const rings = s.scene.children.find(o => o.isInstancedMesh && o.geometry.parameters?.width === 0.7);
      const m = new THREE.Matrix4(), c = new THREE.Color(), seen = new Map();
      for (let i = 0; i < rings.count; i++) {
        rings.getMatrixAt(i, m);
        if (Math.abs(m.determinant()) < 1e-6) continue;
        const z = m.elements[14], key = Math.round(z * 10);
        if (!seen.has(key)) { rings.getColorAt(i, c); seen.set(key, { z, cls: c.g > c.r ? 1 : 0 }); }
      }
      return [...seen.values()];
    },
  }[kind];
  const stub = [bg3DRenderer, s.composer].filter(Boolean);
  const saved = stub.map(t => Object.getOwnPropertyDescriptor(t, 'render'));
  stub.forEach(t => { t.render = () => {}; });
  let pops = 0, flips = 0, pairs = 0;
  try {
    for (let i = 0; i < 10; i++) renderBg3D(0.5, 0.4, 0.3, dt);
    let prev = pick();
    for (let f = 0; f < frames; f++) {
      renderBg3D(0.5, 0.4, 0.3, dt);
      const cur = pick();
      for (const e of cur) {
        let best = null, bestD = 1.5;
        for (const p of prev) { const d = Math.abs(p.z - e.z); if (d < bestD) { bestD = d; best = p; } }
        if (!best) { if (e.z > -200 && e.z < 13) pops++; continue; }
        pairs++;
        if (best.cls !== e.cls) flips++;
      }
      prev = cur;
    }
  } finally {
    stub.forEach((t, i) => { if (saved[i]) Object.defineProperty(t, 'render', saved[i]); else delete t.render; });
  }
  return { kind, pops, flips, pairs };
}

for (const kind of ['vjSpeedGates']) {
  test(`${kind}: 按槽位编号取的外观不能在每次退格时跳变`, async () => {
    await withApp(`continuity-${kind}`, async win => {
      const r = await win.evaluate(zTrack, { kind, frames: 160, dt: 0.25 });
      console.log(JSON.stringify(r));
      expect(r.pairs, '没配上对,测试本身有问题').toBeGreaterThan(500);
      expect(r.pops, '隧道中段凭空出现的元素').toBe(0);
      expect(r.flips, '同一个元素的强调色在相邻两帧之间变了').toBe(0);
    });
  });
}
```

`app/tests/bg3d-performance-budget.spec.js` 在文件末尾追加:

```js
test('全部 50 条 VJ 在三档画质下都不超过 draw-call / triangle 预算', async () => {
  test.setTimeout(300_000);
  await withApp('bg3d-budget-all', async win => {
    const rows = await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      const out = [];
      for (const tier of ['low', 'balanced', 'ultra']) {
        const sel = document.getElementById('vjQualitySel'); sel.value = tier; sel.dispatchEvent(new Event('change'));
        for (const kind of VJ_TUNNEL_KINDS) {
          enableBg3D(kind); renderBg3D(0.5, 0.4, 0.3, 1);
          out.push({ tier, ...bg3DPerformanceSnapshot(), budget: BG3D_PERFORMANCE_BUDGET[tier] });
        }
      }
      return out;
    });
    for (const r of rows) {
      expect.soft(r.calls, `${r.tier}/${r.kind}: draw calls`).toBeLessThanOrEqual(r.budget.maxDrawCalls);
      expect.soft(r.triangles, `${r.tier}/${r.kind}: triangles`).toBeLessThanOrEqual(r.budget.maxTriangles);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx playwright test tests/vj-element-continuity.spec.js tests/bg3d-performance-budget.spec.js --reporter=list`
Expected: 连续性测试 FAIL(`flips` > 0,并且 `bars` 为 undefined 时直接报错——两者都说明是旧实现);预算测试 FAIL 于 `BG3D_PERFORMANCE_BUDGET[tier]` 在 low 档为 undefined,以及 `vjSpeedGates` 的 draw calls 约 122 > 80。

- [ ] **Step 3: 实现**

`BG3D_PERFORMANCE_BUDGET` 里 `balanced:` 之前加一行:

```js
  low:      Object.freeze({maxCachedScenes:BG3D_SCENE_CACHE_LIMIT, maxDrawCalls:80, maxTriangles:1500000}),
```

整体替换 `function buildBg3DVjSpeedGates(){ … }`:

```js
function buildBg3DVjSpeedGates(){
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x06000f, 0.0075);
  const camera = new THREE.PerspectiveCamera(86, window.innerWidth/Math.max(1,window.innerHeight), 0.1, 400);
  const lights = vjLightRig(scene,{keyColor:0x9bdcff,keyI:1.4,rimColor:0xff638e,rimI:1.2,fillI:0.45});

  /* 强调色按世界编号(槽位 + 已退格次数)取:按槽位取的话每次退格都留在原地,橙色门会原地频闪。
     门数 25 能被 5 整除,一圈循环首尾的强调色位置才对得上。 */
  const GATES = 25, SPACING = VJ_LEN/GATES, ACCENT_EVERY = 5;
  const mat = vjStdMat({metalness:0.68,roughness:0.32,envMapIntensity:0.24,side:THREE.DoubleSide});
  // 四条边各进一个 InstancedMesh:以前 26×4 个独立 Mesh 是 119 次 draw call
  const hBars = new THREE.InstancedMesh(new THREE.BoxGeometry(30, 1.7, 1.7), mat, GATES*2);
  const vBars = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 19, 1.7), mat, GATES*2);
  [hBars, vBars].forEach(m => { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); });
  const H_OFF = [[0, 9.5], [0, -9.5]], V_OFF = [[-14.2, 0], [14.2, 0]];
  const gateM = new THREE.Matrix4(), localM = new THREE.Matrix4(), barM = new THREE.Matrix4();
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();

  const { composer } = createBg3DBloom(scene, camera, 1.35, 0.42, 0.46);
  let scroll = 0, clock = 0;
  return { scene, camera, composer, update(bass, mid, high, dt){
    clock += dt*0.016; scroll += vjSpeed(bass, dt)*1.45;
    const off = scroll % SPACING, wraps = Math.floor(scroll / SPACING);
    const lit = mat.isMeshStandardMaterial;
    for(let i=0;i<GATES;i++){
      const z = -i*SPACING + off - SPACING, wz = i*SPACING - scroll;
      const k = 1 + bass*0.22 + 0.12*Math.sin(wz*0.1 + clock*4);
      gateM.compose(
        p.set(Math.sin(wz*0.03 + clock*0.8)*4.5*(0.4+mid), Math.cos(wz*0.041 + clock*0.6)*2.8*(0.4+mid), z),
        q.setFromEuler(e.set(0, 0, wz*0.014 + clock*0.25)),
        sc.set(k, k, 1));
      // 越靠近镜头越亮 —— 门迎面压过来时会「点亮」
      const near = Math.max(0, 1 - Math.abs(z)/70);
      const accent = ((i + wraps) % ACCENT_EVERY + ACCENT_EVERY) % ACCENT_EVERY === 0;
      const hue = ((accent ? 0.06 : 0.58) + wz*0.002 + clock*0.04 + 1)%1;
      // low 档退回不受光材质,颜色直接上屏 —— 沿用受光档的亮度会朝白收敛再被 bloom 糊成灰
      if(lit) VJ_C.setHSL(hue, 0.9, 0.4 + near*0.28 + high*0.08);
      else VJ_C.setHSL(hue, 1, 0.12 + near*0.3 + high*0.06);
      for(let b=0;b<2;b++){
        hBars.setMatrixAt(i*2+b, barM.multiplyMatrices(gateM, localM.makeTranslation(H_OFF[b][0], H_OFF[b][1], 0)));
        vBars.setMatrixAt(i*2+b, barM.multiplyMatrices(gateM, localM.makeTranslation(V_OFF[b][0], V_OFF[b][1], 0)));
        hBars.setColorAt(i*2+b, VJ_C);
        vBars.setColorAt(i*2+b, VJ_C);
      }
    }
    vjFlush(hBars); vjFlush(vBars);
    lights.key.intensity=1.3+bass*0.2;
    camera.fov = 86 + bass*17;
  }};
}
```

- [ ] **Step 4: 跑测试**

```bash
taskkill //F //IM electron.exe 2>/dev/null
npx playwright test tests/vj-element-continuity.spec.js tests/bg3d-performance-budget.spec.js tests/vj-five-depth.spec.js tests/vj-tunnels.spec.js tests/vj-loop-integrity.spec.js --reporter=list
```

Expected: 全部 PASS;`vj-five-depth` 里 SpeedGates 三档仍在 lit 40%~90%、hues > 5。

- [ ] **Step 5: 看画面**

```bash
node scripts/vj-shots.js --out ../vj-shots/speedgates-after --kinds vjSpeedGates --tiers balanced
```

用 Read 对比 `../vj-shots/baseline/balanced-vjSpeedGates.png` 与 `../vj-shots/speedgates-after/balanced-vjSpeedGates.png`:门框外观一致(门距略大约 4%),橙色强调门仍在。

- [ ] **Step 6: Commit**

```bash
cd .. && cp 61.html replacement/61.html
git add 61.html replacement/61.html app/tests/vj-element-continuity.spec.js app/tests/bg3d-performance-budget.spec.js
git commit -m "$(cat <<'EOF'
fix(vj): instance SpeedGates and key its accent on the gate's world id

Accent gates were chosen by slot index, so at every depth wrap the
accent stayed on its slot and the orange gates stuttered in place
instead of flying at the camera. Key them on slot + wraps with a gate
count the accent period divides, so the loop closes. Instancing the
four bars also drops the tunnel from 119 draw calls to within budget,
which is now enforced for all 50 tunnels on every tier.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 示范隧道 ① ChromeFlow + 去塑料验收测试(棘轮)

**Files:**
- Create: `app/tests/vj-anti-plastic.spec.js`
- Modify: `61.html`(`buildBg3DVjChromeFlow`)

**Interfaces:**
- Consumes: `vjBevelBox`、`vjMaterial`、`vjPresetJitter`。
- Produces: `app/tests/vj-anti-plastic.spec.js` 里的 `CONVERTED` 清单——以后每批改造都往里加,只增不减。

- [ ] **Step 1: 写失败测试**

`app/tests/vj-anti-plastic.spec.js`:

```js
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const APP_DIR = path.join(__dirname, '..');

/* 已按「去塑料感」改造完的隧道。只增不减 —— 已经改好的不能被后来的改动悄悄改回去。 */
const CONVERTED = ['vjChromeFlow'];
const LIT_PRESETS = ['metal', 'satin', 'glass', 'neonHousing'];

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => document.getElementById('intro')?.classList.add('hidden'));
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
}

test('已改造隧道:所有可见 mesh 都走预设;方块走倒角工具;受光预设有灯组', async () => {
  await withApp('anti-plastic-structure', async win => {
    const rows = await win.evaluate(({ kinds, litPresets }) => {
      const out = [];
      for (const tier of ['low', 'balanced', 'ultra']) {
        setVjQualityTier(tier);
        for (const kind of kinds) {
          enableBg3D(kind);
          const scene = bg3DScenes[kind].scene, noPreset = [], hardBox = [];
          let dir = 0, hemi = 0, usesLit = false;
          scene.traverse(o => {
            if (o.isDirectionalLight) dir++;
            if (o.isHemisphereLight) hemi++;
            if (!o.isMesh || o.visible === false || o.parent?.name === 'vj-premium-depth-atmosphere') return;
            for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
              const preset = m.userData?.vjPreset;
              if (!preset) noPreset.push(`${o.type}:${m.type}`);
              if (litPresets.includes(preset)) usesLit = true;
              // 发光体允许直角(会被脉冲不等比拉伸);实体方块必须走共享倒角几何
              if (o.geometry.type === 'BoxGeometry' && !o.geometry.userData.vjShared && preset !== 'neonCore') hardBox.push(o.type);
            }
          });
          out.push({ tier, kind, noPreset, hardBox, usesLit, dir, hemi });
        }
      }
      return out;
    }, { kinds: CONVERTED, litPresets: LIT_PRESETS });
    for (const r of rows) {
      const tag = `${r.tier}/${r.kind}`;
      expect.soft(r.noPreset, `${tag}: 这些 mesh 没走材质预设`).toEqual([]);
      expect.soft(r.hardBox, `${tag}: 这些实体方块还是直角`).toEqual([]);
      if (r.usesLit && r.tier !== 'low') {
        expect.soft(r.dir, `${tag}: 缺 key/rim 灯`).toBeGreaterThanOrEqual(2);
        expect.soft(r.hemi, `${tag}: 缺暗部补光`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

test('已改造隧道三档画面:有暗部纵深、颜色鲜艳、不单色', async () => {
  test.setTimeout(180_000);
  await withApp('anti-plastic-look', async win => {
    const rows = await win.evaluate(kinds => {
      const out = [];
      for (const tier of ['low', 'balanced', 'ultra']) {
        const sel = document.getElementById('vjQualitySel'); sel.value = tier; sel.dispatchEvent(new Event('change'));
        for (const kind of kinds) {
          vjDropCachedScene(kind); seedBg3DBuilds(0x5EED); vjSpeedBassSmooth = 0;
          enableBg3D(kind);
          for (let i = 0; i < 42; i++) renderBg3D(0.5, 0.4, 0.3, 1);
          const gl = bg3DRenderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
          const buf = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          let lit = 0, vivid = 0; const hues = new Set();
          for (let i = 0; i < w * h; i++) {
            const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2];
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            if (mx < 40) continue;
            lit++;
            if ((mx - mn) / mx > 0.5) { vivid++; hues.add(Math.round(Math.atan2(g - b, r - g) * 6)); }
          }
          out.push({ tag: `${vjQuality}/${kind}`, lit: lit / (w * h), vivid: vivid / Math.max(1, lit), hues: hues.size });
        }
      }
      return out;
    }, CONVERTED);
    rows.forEach(r => console.log(`${r.tag}: lit=${(r.lit * 100).toFixed(1)}% vivid=${(r.vivid * 100).toFixed(1)}% hues=${r.hues}`));
    for (const r of rows) {
      expect.soft(r.lit, `${r.tag}: 太暗`).toBeGreaterThan(0.4);
      expect.soft(r.lit, `${r.tag}: 没有暗部纵深`).toBeLessThan(0.9);
      expect.soft(r.vivid, `${r.tag}: 发灰`).toBeGreaterThan(0.5);
      expect.soft(r.hues, `${r.tag}: 单色`).toBeGreaterThan(5);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx playwright test tests/vj-anti-plastic.spec.js --reporter=list`
Expected: 第一条 FAIL:`noPreset` 列出 `InstancedMesh:MeshStandardMaterial`(low 档为 `MeshBasicMaterial`),`hardBox` 列出 `InstancedMesh`。第二条会打印当前数值(可能已通过,作为基线记下)。

- [ ] **Step 3: 改造 ChromeFlow**

在 `buildBg3DVjChromeFlow` 里:

把

```js
  /* 倒角方块。真材质下轮廓的倒角边会自己吃到一条高光 —— 这是「金属块」和
     「彩色方块」最直接的区别，纯 Basic 材质时代做不出来，所以以前只能画高光带。 */
  const geo = new THREE.BoxGeometry(1.5, 1.5, 3.2);
```

换成

```js
  /* 倒角方块。轮廓的倒角边会自己吃到一条高光 —— 这是「金属块」和「彩色方块」最直接的区别。 */
  const geo = vjBevelBox(1.5, 1.5, 3.2, 0.22);
```

把 `vjStdMat({ metalness:0.72, roughness:0.18, envMapIntensity:0.75 })` 换成 `vjMaterial('metal', { metalness:0.72, roughness:0.18, envMapIntensity:0.75 })`。

把 `const off = scroll % SPACING;` 换成 `const off = scroll % SPACING, wraps = Math.floor(scroll / SPACING);`。

把

```js
        vjTint(VJ_C, ((0.55 + wz*0.007 + clock*0.05)%1+1)%1, 0.88, 0.58, 0.95, 0.55);
        mesh.setColorAt(i*PER+j, VJ_C);
```

换成

```js
        // 预设在 low 档也是有明暗的 matcap,所以三档都用受光档的颜色值(vjTint 的 low 分支是给不受光材质的)
        VJ_C.setHSL(((0.55 + wz*0.007 + clock*0.05)%1+1)%1, 0.88, 0.58);
        vjPresetJitter(VJ_C, (((i + wraps) % RINGS + RINGS) % RINGS)*PER + j, 0.06);
        mesh.setColorAt(i*PER+j, VJ_C);
```

- [ ] **Step 4: 跑测试并按判据调**

```bash
npx playwright test tests/vj-anti-plastic.spec.js tests/vj-tunnels.spec.js tests/vj-premium-top20.spec.js tests/bg3d-performance-budget.spec.js --reporter=list
```

Expected: 结构测试 PASS。画面测试若 low 档不在区间内:调 `VJ_MATCAP_LOOKS.metal.gain`(每次 ±0.1,偏暗往上、过亮往下)后重跑;balanced/ultra 不在区间内:调这条隧道里 `setHSL` 的亮度 `0.58`(每次 ±0.04)。直到三档都通过。

- [ ] **Step 5: Commit**

```bash
cd .. && cp 61.html replacement/61.html
git add 61.html replacement/61.html app/tests/vj-anti-plastic.spec.js
git commit -m "$(cat <<'EOF'
feat(vj): convert ChromeFlow to bevelled metal presets as the first pilot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 示范隧道 ② NeonTubeRoom(发光芯 + 灯座;方环按世界编号)

**Files:**
- Modify: `61.html`(整体替换 `buildBg3DVjNeonTubeRoom`)
- Modify: `app/tests/vj-element-continuity.spec.js`、`app/tests/vj-anti-plastic.spec.js`

背景:方环位置用 `i % 3`、颜色用 `i%2`,都挂在槽位编号上——每次退格方环往回跳一格(中段凭空出现)。按世界编号改;槽位数从 44 改为 48,使 3(方环间隔)和 6(两色交替周期)都能整除,循环首尾对得上。灯管拆成圆柱发光芯(`neonCore`,随 glow 在截面上等比放大,圆柱不怕)+ 固定尺寸的倒角灯座(`neonHousing`,垫在朝墙一侧);方环会被脉冲不等比拉伸,保留直角,只作发光体。

- [ ] **Step 1: 把 NeonTubeRoom 加进两个测试并确认失败**

`app/tests/vj-element-continuity.spec.js`:`for (const kind of ['vjSpeedGates'])` 改为 `for (const kind of ['vjSpeedGates', 'vjNeonTubeRoom'])`。
`app/tests/vj-anti-plastic.spec.js`:`const CONVERTED = ['vjChromeFlow'];` 改为 `const CONVERTED = ['vjChromeFlow', 'vjNeonTubeRoom'];`。

Run: `npx playwright test tests/vj-element-continuity.spec.js tests/vj-anti-plastic.spec.js --reporter=list`
Expected: `vjNeonTubeRoom` 连续性 FAIL(`pops` > 0);去塑料结构测试 FAIL(`noPreset`、`hardBox` 非空)。

- [ ] **Step 2: 实现**

整体替换 `function buildBg3DVjNeonTubeRoom(){ … }`:

```js
function buildBg3DVjNeonTubeRoom(){
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050010, 0.0075);
  const camera = new THREE.PerspectiveCamera(86, window.innerWidth/Math.max(1,window.innerHeight), 0.1, 400);
  const lights=vjLightRig(scene,{keyColor:0x9fafff,keyI:1.3,rimColor:0xffb35a,rimI:1.1,fillI:0.5});

  /* 48 段:方环每 3 段一个、两色每 6 段交替,都按世界编号取 —— 48 能被 3 和 6 整除,循环首尾对得上。 */
  const SEGS = 48, SPACING = VJ_LEN/SEGS, RING_EVERY = 3, RING_PER = 32;
  /* 灯管 = 圆柱发光芯 + 倒角灯座。芯随 glow 在截面上等比放大,圆柱不怕这种缩放;
     灯座尺寸固定、垫在朝墙一侧,边上接得住 key/rim 灯的高光。 */
  const coreGeo = new THREE.CylinderGeometry(0.24, 0.24, 5.6, vjQuality === 'low' ? 8 : 16);
  coreGeo.rotateX(Math.PI / 2);
  const cores = new THREE.InstancedMesh(coreGeo, vjMaterial('neonCore'), SEGS*12);
  const housings = new THREE.InstancedMesh(vjBevelBox(0.95, 0.95, 5.8, 0.14), vjMaterial('neonHousing'), SEGS*12);
  // 方环会随脉冲做不等比拉伸,倒角会被拉变形 —— 保留直角,只作发光体
  const rings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), vjMaterial('neonCore'), SEGS*RING_PER);
  [cores, housings, rings].forEach(m => { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); });
  const WALL_OUT = [[0,-1],[0,1],[-1,0],[1,0]];
  const tmp = {x:0,y:0};
  const HUE_BASE = 0.72;   // 品红-紫-蓝这一段，收紧的配色

  const { composer } = createBg3DBloom(scene, camera, 1.65, 0.72, 0.3);
  let scroll = 0, clock = 0;
  return { scene, camera, composer, update(bass, mid, high, dt){
    clock += dt*0.016; scroll += vjSpeed(bass, dt);
    const off = scroll % SPACING, wraps = Math.floor(scroll / SPACING);
    const RW = 17;
    for(let i=0;i<SEGS;i++){
      const z = -i*SPACING + off - SPACING, wz = i*SPACING - scroll;
      const id = ((i + wraps) % SEGS + SEGS) % SEGS;
      for(let w=0;w<4;w++) for(let k=0;k<3;k++){
        const t = (k-1)*7.5;
        let x, y;
        if(w===0){ x = t; y = -RW; } else if(w===1){ x = t; y = RW; }
        else if(w===2){ x = -RW; y = t; } else { x = RW; y = t; }
        const idx = i*12 + w*3 + k;
        const glow = 0.5 + 0.5*Math.sin(wz*0.05 + w*1.4 + k*0.7 + clock*1.7);
        vjPut(cores, idx, x, y, z, 0, 0, 0, 1 + glow*0.5, 1 + glow*0.5, 1);
        vjPut(housings, idx, x + WALL_OUT[w][0]*0.42, y + WALL_OUT[w][1]*0.42, z, 0, 0, 0, 1, 1, 1);
        const hue = (w===3 && k===1 ? 0.13 : HUE_BASE + w*0.025 + k*0.015 + Math.sin(clock*0.25)*0.03)%1;
        VJ_C.setHSL(hue, 0.95, 0.24 + glow*0.24 + high*0.08);
        vjPresetJitter(VJ_C, id*12 + w*3 + k, 0.05);
        cores.setColorAt(idx, VJ_C);
      }
      const isRing = id % RING_EVERY === 0;
      for(let j=0;j<RING_PER;j++){
        const idx = i*RING_PER + j;
        if(!isRing){ vjPut(rings, idx, 0, 0, 9999, 0,0,0, 0.0001,0.0001,0.0001); continue; }
        const a = (j/RING_PER)*Math.PI*2;
        vjSuperXY(a, RW*1.02, 10, tmp);
        const pulse = 0.4 + 0.6*Math.pow(Math.max(0, Math.sin(wz*0.06 + clock*2.4)), 2);
        vjPut(rings, idx, tmp.x, tmp.y, z, 0, 0, a, 1 + pulse*1.1 + bass*0.7, 1 + pulse*1.1, 1);
        VJ_C.setHSL((id % (RING_EVERY*2) === 0 ? 0.54 : HUE_BASE+0.08+Math.sin(clock*0.2)*0.02)%1, 0.95, 0.24 + pulse*0.24);
        rings.setColorAt(idx, VJ_C);
      }
    }
    vjFlush(cores); vjFlush(housings); vjFlush(rings);
    lights.key.intensity=1.25+bass*0.2;
    camera.fov = 86 + bass*13;
  }};
}
```

- [ ] **Step 3: 跑测试并按判据调**

```bash
taskkill //F //IM electron.exe 2>/dev/null
npx playwright test tests/vj-element-continuity.spec.js tests/vj-anti-plastic.spec.js tests/vj-five-depth.spec.js tests/vj-tunnels.spec.js tests/vj-loop-integrity.spec.js tests/bg3d-performance-budget.spec.js --reporter=list
```

Expected: 全部 PASS。若画面判据不在区间:low 档调 `VJ_MATCAP_LOOKS.neonHousing.gain`(±0.05);发光芯/方环调亮度基数 `0.24`(±0.03)。`vj-five-depth` 与 `vj-anti-plastic` 对这条用的是同一组判据,两边都要过。

- [ ] **Step 4: Commit**

```bash
cd .. && cp 61.html replacement/61.html
git add 61.html replacement/61.html app/tests/vj-element-continuity.spec.js app/tests/vj-anti-plastic.spec.js
git commit -m "$(cat <<'EOF'
feat(vj): NeonTubeRoom pilot - neon cores on bevelled housings

Split each tube into an emissive cylinder core and a fixed-size bevelled
housing that catches the rig light. Rings were placed and coloured by
slot index, so every depth wrap popped them back a segment; key them on
the element's world id with a segment count both periods divide.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: 示范隧道对比网页(**用户关口**)

**Files:**
- 可能修改:`61.html`(按用户意见调 `VJ_LIT_LOOKS` / `VJ_MATCAP_LOOKS` / 两条示范隧道)

- [ ] **Step 1: 拍改造后素材**

```bash
taskkill //F //IM electron.exe 2>/dev/null
node scripts/vj-shots.js --out ../vj-shots/pilots-after --kinds vjChromeFlow,vjNeonTubeRoom --crop 0.62,0.35
node scripts/vj-shots.js --out ../vj-shots/pilots-after-rec --kinds vjChromeFlow,vjNeonTubeRoom --tiers balanced,ultra --record 4k --measure --crops-only --crop 0.62,0.35
```

- [ ] **Step 2: 自己先看**

用 Read 逐张看 `../vj-shots/pilots-after/*.png` 与 `../vj-shots/baseline/` 对应的图。检查:没有白底/灰雾、有黑色纵深、倒角边能看到细高光、霓虹还在发光、low 档不是平面色块。有明显问题先修再给用户看。

- [ ] **Step 3: 做对比网页**

先加载 `artifact-design` skill。页面 `../vj-shots/pilots-compare/index.html`:两条隧道各一节;每节三行(low / balanced / ultra),每行"改造前 | 改造后"两张整帧并排,下面一行两张放大裁切(`image-rendering: pixelated`);最后一节放 4K 录制成片的边缘裁切:改造前 `baseline-rec/…-crop.png` 对比改造后 `pilots-after-rec/…-crop.png`。页脚列出三档的 lit / vivid / hues(来自两个 `metrics.json`)。图片通过 Artifact 的 `files` 映射发布,把链接给用户。

- [ ] **Step 4: 请用户确认质感方向**

用 AskUserQuestion 问"这两条示范隧道的质感方向对吗?",选项:`对,可以批量` / `方向对,但要调`(让用户在 Other 里说哪里调)/ `方向不对`。**得到"对,可以批量"之前不进入 Task 12。** 要调的话:改完回到 Step 1 重拍、重发同一个网页(同一文件路径 → 同一链接),再问。

- [ ] **Step 5: 若有调整则提交**

```bash
cd .. && cp 61.html replacement/61.html
git add 61.html replacement/61.html
git commit -m "$(cat <<'EOF'
tune(vj): adjust pilot materials after side-by-side review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: 写 HANDOFF、全量验证、打包、提交推送

**Files:**
- Modify: `HANDOFF.md`
- 重建:`replacement/61.html`、`Music-Visualisation-Claude-Code-Replace.zip`、`dist/`

- [ ] **Step 1: 更新 HANDOFF.md**

在"交接状态"段之后插入一节 `## 去塑料感改造:给 ChatGPT 的用法和规则`,内容逐条包含:

1. **工具**:`vjMaterial(preset, opts)` 五个预设各自的用途表(照 spec 3.4);`vjBevelBox(w, h, d, radius)` 的三档面数;`vjPresetJitter(color, key, amount)`。受光预设所在的场景必须有 `vjLightRig(scene, …)`。
2. **规则**:
   - 预设在 low 档也是有明暗的 matcap,颜色用受光档的数值,不要再用 `vjTint` 的 low 分支。
   - 不等比拉伸的部件:按实际尺寸建 `vjBevelBox`;细长部件用圆柱/胶囊;会被脉冲拉伸的发光块保留直角并用 `neonCore`。
   - 世界编号:凡是按元素决定的外观(强调色、有无、交替色、`vjPresetJitter` 的 key),用 `i + Math.floor(scroll / SPACING)`,再对槽位总数取模;取模周期必须整除槽位总数(见 SpeedGates 25/5、NeonTubeRoom 48/3/6)。
   - 自己写的后处理 pass,`dispose()` 必须释放全部材质和渲染目标(回收路径只调 `pass.dispose()`)。
3. **每批验收流程**:把改造的隧道名加进 `app/tests/vj-anti-plastic.spec.js` 的 `CONVERTED`;用到槽位编号的外观,在 `vj-element-continuity.spec.js` 加用例;跑这两个测试 + `vj-five-depth`/`vj-tunnels`/`vj-loop-integrity`/`bg3d-performance-budget`;用 `node scripts/vj-shots.js --out ../vj-shots/<批次名> --kinds <本批> --crop 0.62,0.35` 拍图交给 Claude Code 做对比网页。
4. **批次顺序**(每批约 10 条):先 Top 20 Premium 中未改造的 19 条(分两批),再按家族分组剩下的 29 条:方块/结构类、线条类、粒子/流体类。列出具体名单(从 `src/vj/premium-meta.json` 与 `src/vj/tunnel-registry.json` 取)。
5. **本轮结果**:抗锯齿选型与理由;录制帧时间表(来自 `../vj-shots/rec-frame-times.md`);SpeedGates 与 NeonTubeRoom 的槽位编号 bug 已修。
6. **已知问题(待用户决定,本轮未改)**:27 条槽位循环隧道里 `wz = i*SPACING - scroll` 不是元素的物理坐标——每次退格它对同一个元素跳 −SPACING,用 `wz` 驱动的摆动/旋转/波形在退格时会有小幅阶跃。

同时把"当前状态"段更新为:第 0 轮完成、三份 `61.html` 的新 SHA256(Step 3 得到)、全量测试结果、下一步由 ChatGPT 按批次改造。

- [ ] **Step 2: 全量测试**

```bash
taskkill //F //IM electron.exe 2>/dev/null
npx playwright test --reporter=list > ../vj-shots/full-suite.txt 2>&1; tail -8 ../vj-shots/full-suite.txt; grep -A1 "closeApp: Electron" ../vj-shots/full-suite.txt
```

Expected: 仅 `replace-zip-freshness` 与 `build-output` 两个文件失败(Step 3 之后会过);`closeApp` 强杀警告只出现在 `close-app-helper.spec.js`。

- [ ] **Step 3: 同步发布产物并复验**

```bash
cp ../61.html ../replacement/61.html && npm run build:replace-zip && npm run dist
npm run verify:three-addons
npx playwright test tests/build-output.spec.js tests/replace-zip-freshness.spec.js tests/replacement-freshness.spec.js --reporter=list
cd .. && sha256sum 61.html replacement/61.html dist/win-unpacked/resources/app/61.html
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-protected-paths.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-replacement.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-replace-zip.ps1
```

Expected: 三份哈希一致;所有校验 PASS。把哈希填进 HANDOFF 的"当前状态"。

- [ ] **Step 4: Commit,并问用户是否推送**

```bash
git add HANDOFF.md replacement/61.html Music-Visualisation-Claude-Code-Replace.zip
git commit -m "$(cat <<'EOF'
docs(handoff): round 0 of the anti-plastic work is ready for batch conversion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
git status --short
```

推送前先问用户。

---

## Self-Review 记录

- **Spec 覆盖**:3.1 抗锯齿 → Task 3、5;3.2 录制分辨率 → Task 4;3.3 倒角几何 → Task 6;3.4 材质预设 → Task 7;第 4 节测试 1~7 → Task 9(棘轮、三档判据)、Task 8(预算 50×3)、Task 3(AA)、Task 4(录制)、soak 在 Task 3/6/7 回归、原有测试在各任务回归;第 5 节第 0 轮 1~6 → Task 5、4、6/7、9/10、11、12。
- **超出 spec 的两处(均在已触及的代码里,已在计划中写明原因)**:SpeedGates 实例化(预算扩到 50 条后它 119 次 draw call 超标)与两条隧道的槽位编号 bug(强调色频闪 / 方环回跳)。`wz` 的系统性阶跃只记录为已知问题,不在本轮修。
- **命名一致性**:`THREE_R149_ADDONS`、`bg3DPostAA`、`makeBg3DAAPass`、`setBg3DPostAA`、`__bg3dAA`、`bg3DTargetPixelRatio`、`applyBg3DMsaaSamples`、`vjBevelBox`、`vjChamferBoxGeometry`、`vjClearBevelCache`、`userData.vjShared`、`VJ_MATERIAL_PRESETS`、`vjMaterial`、`VJ_LIT_LOOKS`、`VJ_MATCAP_LOOKS`、`vjMatcapTexture`、`vjPresetJitter`、`userData.vjPreset`、`CONVERTED` 在各任务中一致。
