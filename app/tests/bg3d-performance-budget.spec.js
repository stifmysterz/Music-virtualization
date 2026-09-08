const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');
const SOAK_KINDS = [
  'particles','tunnel','galaxy','aurora','liquidMetalWave',
  'vjLiquidGrid','vjPrismShards','vjChromeFlow','vjFractalWell','vjTentacleTunnel',
  'vjVoidNebula','vjEventHorizon','vjDataBloom','vjHyperCube','vjCoasterRush',
  'vjMercuryPool','vjLiquidSpine','vjWarpJump','vjSolarFlare','vjCollapsedGrid'
];

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app, win;
  try {
    app = await electron.launch({args:['.', `--user-data-dir=${dir}`], cwd:APP_DIR});
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

test('3D ↔ VJ 切换 200 次后 GPU 场景缓存保持在 8 个以内', async () => {
  test.setTimeout(180_000);
  await withApp('bg3d-soak', async win => {
    const result = await win.evaluate(kinds => {
      document.getElementById('intro')?.classList.add('hidden');
      const cycle = count => {
        for(let i=0;i<count;i++){
          const kind=kinds[i%kinds.length]; enableBg3D(kind); renderBg3D(0.45,0.35,0.25,1);
        }
        return {snapshot:bg3DPerformanceSnapshot(), alpha:bg3DAlphaPasses.length,
          grade:bg3DGradePasses.length, keys:Object.keys(bg3DScenes)};
      };
      const first=cycle(100), second=cycle(100);
      return {first,second,limit:BG3D_SCENE_CACHE_LIMIT, active:bg3DKind};
    }, SOAK_KINDS);

    expect(result.limit).toBe(8);
    expect(result.second.snapshot.cachedScenes).toBeLessThanOrEqual(8);
    expect(result.second.keys).toContain(result.active);
    expect(result.second.snapshot.geometries).toBeLessThanOrEqual(result.first.snapshot.geometries + 8);
    expect(result.second.snapshot.textures).toBeLessThanOrEqual(result.first.snapshot.textures + 4);
    expect(result.second.alpha).toBeLessThanOrEqual(8);
    expect(result.second.grade).toBeLessThanOrEqual(8);
  });
});

test('Top 20 Balanced 画质不超过 GPU draw-call / triangle 预算', async () => {
  test.setTimeout(180_000);
  await withApp('bg3d-budget', async win => {
    const result = await win.evaluate(() => {
      const rows=[];
      for(const kind of VJ_PREMIUM_KINDS){
        enableBg3D(kind);
        const times=[];
        for(let i=0;i<4;i++){
          const t=performance.now(); renderBg3D(0.5,0.4,0.3,1); times.push(performance.now()-t);
        }
        const snap=bg3DPerformanceSnapshot(); times.sort((a,b)=>a-b);
        rows.push({...snap, p95Ms:times[Math.floor(times.length*0.95)]});
      }
      return {rows,budget:BG3D_PERFORMANCE_BUDGET.balanced};
    });
    for(const row of result.rows){
      expect.soft(row.calls, `${row.kind}: draw calls`).toBeLessThanOrEqual(result.budget.maxDrawCalls);
      expect.soft(row.triangles, `${row.kind}: triangles`).toBeLessThanOrEqual(result.budget.maxTriangles);
      // Software-rendered CI varies greatly; this only catches a blocked/runaway frame.
      expect.soft(row.p95Ms, `${row.kind}: one frame appears blocked`).toBeLessThan(1000);
    }
  });
});

test('渲染器像素比有上限，性能快照包含发布所需指标', async () => {
  await withApp('bg3d-profiler', async win => {
    const result = await win.evaluate(() => {
      enableBg3D('vjLiquidGrid'); renderBg3D(0.4,0.3,0.2,1);
      return {snapshot:bg3DPerformanceSnapshot(), keys:Object.keys(BG3D_PERFORMANCE_BUDGET.balanced)};
    });
    expect(result.snapshot.pixelRatio).toBeLessThanOrEqual(2);
    expect(result.snapshot.width).toBeGreaterThan(0);
    expect(result.snapshot.height).toBeGreaterThan(0);
    for(const key of ['calls','triangles','points','lines','geometries','textures'])
      expect(Number.isFinite(result.snapshot[key]), key).toBe(true);
    expect(result.keys).toEqual(['maxCachedScenes','maxDrawCalls','maxTriangles']);
  });
});
