const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app = null, win = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

test('Voxel Pulse Terrain 出现在 VJ 菜单并能直接启用', async () => {
  await withApp('voxel-terrain-menu', async win => {
    await win.evaluate(() => document.getElementById('intro')?.classList.add('hidden'));
    const button = win.locator('#bg3DVjVoxelPulseTerrainBtn');
    await expect(button).toHaveCount(1);
    await expect(button).toContainText('Voxel Pulse Terrain');
    await win.locator('#vjMenuBtn').click();
    await expect(button).toBeVisible();
    await button.click();
    expect(await win.evaluate(() => ({kind:bg3DKind, active:hasBg3D,
      registered:VJ_TUNNEL_KINDS.includes('vjVoxelPulseTerrain')})))
      .toEqual({kind:'vjVoxelPulseTerrain', active:true, registered:true});
  });
});

test('Voxel Pulse Terrain 的 bass、mid、high 分别改变地形', async () => {
  await withApp('voxel-terrain-bands', async win => {
    const r = await win.evaluate(() => {
      const phase=0.13;
      const highSeed=Math.PI/2-(Math.hypot(3,2)*1.42+Math.atan2(2,3)*5+phase*Math.PI*16);
      return {
        quietCentre:voxelPulseTerrainSample(0,0,phase,0,0,0,0),
        bassCentre:voxelPulseTerrainSample(0,0,phase,1,0,0,0),
        quietMid:voxelPulseTerrainSample(4,1,phase,0,0,0,0),
        mid:voxelPulseTerrainSample(4,1,phase,0,1,0,0),
        quietHigh:voxelPulseTerrainSample(3,2,phase,0,0,0,highSeed),
        high:voxelPulseTerrainSample(3,2,phase,0,0,1,highSeed),
        loop0:voxelPulseTerrainSample(5,-3,0,0.6,0.5,0.4,1.7),
        loop1:voxelPulseTerrainSample(5,-3,1,0.6,0.5,0.4,1.7)
      };
    });
    expect(r.bassCentre.height-r.quietCentre.height, 'bass 没有抬高中心').toBeGreaterThan(5);
    expect(Math.abs(r.mid.height-r.quietMid.height), 'mid 没有推动大尺度波浪').toBeGreaterThan(0.2);
    expect(r.high.highGrain, 'high 没有产生细小尖峰').toBeGreaterThan(3);
    expect(r.high.height-r.quietHigh.height, 'high 尖峰没有反映到柱高').toBeGreaterThan(2);
    expect(Math.abs(r.loop0.height-r.loop1.height), '16 拍首尾高度不连续').toBeLessThan(1e-9);
    expect(Math.abs(r.loop0.hue-r.loop1.hue), '16 拍首尾颜色不连续').toBeLessThan(1e-9);
  });
});

test('Voxel Pulse Terrain 实际渲染有密度、有颜色且在性能预算内', async () => {
  await withApp('voxel-terrain-render', async win => {
    const r = await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      enableBg3D('vjVoxelPulseTerrain');
      for(let i=0;i<32;i++) renderBg3D(0.72,0.61,0.83,1);
      const gl=bg3DRenderer.getContext(), w=gl.drawingBufferWidth, h=gl.drawingBufferHeight;
      const buf=new Uint8Array(w*h*4); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buf);
      let lit=0,vivid=0,white=0;
      for(let i=0;i<w*h;i++){
        const rr=buf[i*4],g=buf[i*4+1],b=buf[i*4+2],mx=Math.max(rr,g,b),mn=Math.min(rr,g,b);
        if(mx>=40){ lit++; if((mx-mn)/mx>0.5) vivid++; }
        if(mn>=225) white++;
      }
      return {total:w*h,lit,vivid,white,count:bg3DScenes.vjVoxelPulseTerrain.scene.userData.voxelPulseTerrain.count,
        snapshot:bg3DPerformanceSnapshot(),guarded:bg3DScenes.vjVoxelPulseTerrain.composer.passes.some(p=>p.__vjHighlightGuard)};
    });
    expect(r.count, '体素数量太少，地形会显得稀').toBeGreaterThan(2500);
    expect(r.lit/r.total, '实际画面太空').toBeGreaterThan(0.25);
    expect(r.vivid/r.lit, '颜色发灰').toBeGreaterThan(0.5);
    expect(r.white/r.total, '出现大面积白场').toBeLessThan(0.04);
    expect(r.guarded, '没有经过 VJ 高光保护').toBe(true);
    expect(r.snapshot.calls).toBeLessThanOrEqual(12);
    expect(r.snapshot.triangles).toBeLessThan(100000);
  });
});
