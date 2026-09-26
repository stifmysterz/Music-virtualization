const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const APP_DIR = path.join(__dirname, '..');

/* 3D 层的像素比跟画质档走。以前 balanced/ultra 被 r149 的合成器悄悄压回 CSS 尺寸,而 low 反而按完整
   像素比渲染 —— 修好之后如果不设上限,2 倍屏上 balanced 要渲染 4 倍像素,Auto 降到 low 也省不下来。 */
test('2 倍屏上 3D 像素比按档位封顶:low 1 / balanced 1.5 / ultra 2,合成器跟画布一致', async () => {
  const dir = newUserDataDir('bg3d-pixel-ratio');
  let app, win;
  try {
    app = await electron.launch({ args: ['--force-device-scale-factor=2', '.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const r = await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      const out = { dpr: window.devicePixelRatio };
      for (const tier of ['low', 'balanced', 'ultra']) {
        setVjQualityTier(tier); enableBg3D('vjChromeFlow');
        const size = bg3DRenderer.getDrawingBufferSize(new THREE.Vector2()), c = bg3DScenes.vjChromeFlow.composer;
        out[tier] = { pr: bg3DRenderer.getPixelRatio(), bufMatchesRt: Math.abs(c.renderTarget1.width - size.x) <= 1 };
      }
      return out;
    });
    expect(r.dpr).toBe(2);
    expect(r.low).toEqual({ pr: 1, bufMatchesRt: true });
    expect(r.balanced).toEqual({ pr: 1.5, bufMatchesRt: true });
    expect(r.ultra).toEqual({ pr: 2, bufMatchesRt: true });
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
});
