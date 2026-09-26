const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const APP_DIR = path.join(__dirname, '..');

/* 已按「去塑料感」改造完的隧道。只增不减 —— 已经改好的不能被后来的改动悄悄改回去。 */
const CONVERTED = ['vjChromeFlow', 'vjNeonTubeRoom',
  'vjLiquidGrid', 'vjNeonRibbon', 'vjPrismShards', 'vjFractalWell', 'vjTentacleTunnel',
  'vjBioMembrane', 'vjVoidNebula', 'vjEventHorizon', 'vjDataBloom', 'vjNeonArches',
  'vjHorizonVoyage', 'vjHyperCube', 'vjCoasterRush', 'vjMercuryPool', 'vjWarpJump',
  'vjSolarFlare', 'vjChromeTube', 'vjMetalTwist', 'vjLiquidSpine',
  'vjCubeMatrix', 'vjGridMorph', 'vjCyborgCorridor', 'vjRaceTrack', 'vjSpeedGates',
  'vjHoverCity', 'vjDerelictHall', 'vjCollapsedGrid', 'vjShatteredPanes', 'vjDustShaft'];
const LIT_PRESETS = ['metal', 'liquidMetal', 'satin', 'glass', 'neonHousing'];

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
