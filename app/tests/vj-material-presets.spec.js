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
