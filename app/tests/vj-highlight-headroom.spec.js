const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

test('每个 VJ 都保留高光余量，不会大面积变成纯白', async () => {
  test.setTimeout(240_000);
  const dir = newUserDataDir('vj-highlight-headroom');
  let app = null, win = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const rows = await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      const out = [];
      for(const kind of VJ_TUNNEL_KINDS){
        enableBg3D(kind);
        beat = 1;
        for(let i=0;i<18;i++) renderBg3D(0.82, 0.72, 0.88, 1);
        const gl=bg3DRenderer.getContext(), w=gl.drawingBufferWidth, h=gl.drawingBufferHeight;
        const buf=new Uint8Array(w*h*4); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buf);
        let visible=0, nearWhite=0, clipped=0;
        for(let i=0;i<w*h;i++){
          const r=buf[i*4], g=buf[i*4+1], b=buf[i*4+2], mx=Math.max(r,g,b), mn=Math.min(r,g,b);
          if(mx>=40) visible++;
          if(mn>=225) nearWhite++;
          if(mn>=250) clipped++;
        }
        const bm=(bgThreeCanvas.style.filter||'').match(/brightness\(([-0-9.]+)/);
        const guarded=bg3DScenes[kind].composer.passes.some(p=>p.__vjHighlightGuard);
        out.push({kind, visible, nearWhite, clipped, total:w*h,
          cssBrightness:bm?parseFloat(bm[1]):null, guarded});
      }
      disableBg3D();
      return out;
    });

    for(const r of rows){
      const whiteOfVisible = r.visible ? r.nearWhite/r.visible : 0;
      const clippedOfVisible = r.visible ? r.clipped/r.visible : 0;
      console.log(`${r.kind.padEnd(20)} white=${(whiteOfVisible*100).toFixed(1)}% clipped=${(clippedOfVisible*100).toFixed(1)}%`);
      expect.soft(r.guarded, `${r.kind}: 没有经过 VJ 高光保护层`).toBe(true);
      expect.soft(whiteOfVisible, `${r.kind}: 亮区有 ${(whiteOfVisible*100).toFixed(1)}% 接近纯白`).toBeLessThan(0.18);
      expect.soft(clippedOfVisible, `${r.kind}: 亮区有 ${(clippedOfVisible*100).toFixed(1)}% 已削顶`).toBeLessThan(0.04);
      expect.soft(r.cssBrightness, `${r.kind}: 音乐闪光仍会把画面整体推白`).toBeLessThanOrEqual(1.181);
    }
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
});
