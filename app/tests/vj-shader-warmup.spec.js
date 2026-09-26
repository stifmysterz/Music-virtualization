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
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
}

/* 玻璃预设(MeshPhysicalMaterial + 清漆)冷编译一个变体约 0.4 s,第一次切到用玻璃的隧道会卡住一帧。
   启动后空闲时先编好:之后任何隧道里的玻璃 / 液态金属预设都不能再现场编译。
   新的玻璃用法(单面、不透明、点光源数量不同)会让这条测试失败 —— 照报错在 VJ_WARM_GLASS_VARIANTS 里补上那个变体。 */
test('启动后预热玻璃着色器:切到任何用玻璃预设的隧道都不再现场编译', async () => {
  test.setTimeout(180_000);
  await withApp('shader-warmup', async win => {
    await win.waitForFunction(() => vjWarmupSettled === true, null, { timeout: 15_000 });
    const r = await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      // 预热不能顺手把 3D 层打开,也不能往场景缓存里塞东西
      const sideEffects = { kind: bg3DKind, scenes: Object.keys(bg3DScenes).length, shown: bgThreeCanvas.style.display === 'block' };
      const compiledHere = [];
      const glassKinds = [];
      for (const tier of ['balanced', 'ultra']) {
        setVjQualityTier(tier);
        for (const kind of (tier === 'balanced' ? VJ_TUNNEL_KINDS : glassKinds)) {
          const before = new Set(bg3DRenderer.info.programs);
          enableBg3D(kind);
          renderBg3D(0.5, 0.4, 0.3, 1);
          let usesGlass = false, pointLights = 0;
          bg3DScenes[kind].scene.traverse(o => { if (o.isPointLight) pointLights++; });
          bg3DScenes[kind].scene.traverse(o => {
            for (const m of [].concat(o.material || [])) {
              if (m.userData.vjPreset !== 'glass' && m.userData.vjPreset !== 'liquidMetal') continue;
              usesGlass = true;
              for (const p of bg3DRenderer.properties.get(m).programs?.values() || []) {
                if (!before.has(p)) compiledHere.push(`${tier}/${kind}: ${m.userData.vjPreset} ${m.side === THREE.DoubleSide ? 'double' : 'front'} ` +
                  `${m.transparent ? 'transparent' : 'opaque'} pointLights=${pointLights}`);
              }
            }
          });
          if (tier === 'balanced' && usesGlass) glassKinds.push(kind);
        }
      }
      return { sideEffects, glassKinds, compiledHere: [...new Set(compiledHere)] };
    });
    expect(r.sideEffects).toEqual({ kind: null, scenes: 0, shown: false });
    expect(r.glassKinds.length, '至少要有一条隧道用玻璃预设,否则这条测试什么也没测').toBeGreaterThan(0);
    expect(r.compiledHere, '这些玻璃变体没被预热,第一次切过去会卡一帧').toEqual([]);
  });
});
