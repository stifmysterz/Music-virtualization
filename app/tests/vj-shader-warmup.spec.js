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

/* 冷缓存下一次编完全部变体要卡住主线程 2 s 多(装好后第一次启动,开场画面就停在那)。
   拆成每个变体各在一个空闲回调里编:每段只卡一个变体的时间,中间画面还能走。 */
test('预热分成小段:每段只编一个变体(双面半透明再分背面、正面),没有一段卡满全部', async () => {
  await withApp('shader-warmup-steps', async win => {
    await win.waitForFunction(() => vjWarmupSettled === true, null, { timeout: 30_000 });
    const r = await win.evaluate(() => ({
      variants: VJ_WARM_GLASS_VARIANTS.length,
      steps: vjWarmupLog.map(s => ({ kind: s.kind, index: s.index, ms: s.ms, start: s.start, end: s.end })),
    }));
    const covered = new Set(r.steps.filter(s => s.kind === 'variant').map(s => s.index));
    expect([...covered].sort((a, b) => a - b), '每个变体都要编到').toEqual([...Array(r.variants).keys()]);
    // 相邻两段之间要有空档:是各自的回调,不是同一个任务里连着编
    for (let i = 1; i < r.steps.length; i++) expect(r.steps[i].start, `第 ${i + 1} 段紧跟在上一段后面`).toBeGreaterThan(r.steps[i - 1].end);
    // 单个变体冷编译约 0.2~0.5 s,建渲染器 + 环境贴图单独一段;一次编完全部要 2 s 多
    expect(Math.max(...r.steps.map(s => s.ms)), '有一段卡太久').toBeLessThan(800);
  });
});
