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
const MODES = ['smaa'];

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

test('只接受选定的 SMAA 和 off,已移除的 FXAA 不能被切进来', async () => {
  await withApp('post-aa-modes', async win => {
    const r = await win.evaluate(() => { setBg3DPostAA('fxaa'); return bg3DPostAA; });
    expect(r).toBe('smaa');
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

/* 传入自定义渲染目标(balanced/ultra 为了 MSAA 就是这么建的)时,r149 的 EffectComposer 把自己的
   像素比记成 1;之后 composer.setSize(CSS 尺寸) 就把内部渲染缩回 CSS 分辨率,再被拉伸到画布上。 */
test('三档的合成器内部分辨率都等于画布绘制缓冲(高分屏下不能掉回 CSS 尺寸)', async () => {
  await withApp('post-aa-composer-res', async win => {
    const rows = await win.evaluate(() => ['low', 'balanced', 'ultra'].map(tier => {
      const sel = document.getElementById('vjQualitySel'); sel.value = tier; sel.dispatchEvent(new Event('change'));
      enableBg3D('vjChromeFlow');
      resizeBg3D();
      const c = bg3DScenes.vjChromeFlow.composer, size = bg3DRenderer.getDrawingBufferSize(new THREE.Vector2());
      return { tier, dpr: window.devicePixelRatio, buf: [size.x, size.y], rt: [c.renderTarget1.width, c.renderTarget1.height] };
    }));
    for (const r of rows) {
      expect.soft(Math.abs(r.rt[0] - r.buf[0]), `${r.tier} (dpr ${r.dpr}): 合成器宽 ${r.rt[0]} vs 画布 ${r.buf[0]}`).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(r.rt[1] - r.buf[1]), `${r.tier} (dpr ${r.dpr}): 合成器高 ${r.rt[1]} vs 画布 ${r.buf[1]}`).toBeLessThanOrEqual(1);
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
    console.log('hard-step ratio  ' + Object.entries(r).map(([k, v]) => `${k}=${v.toFixed(4)}`).join('  '));
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
