const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 3D 背景要能透出照片/视频背景。
 *
 * #bgThree 本来就是 alpha:true + setClearColor(0,0,0,0)，但只要挂了 EffectComposer，
 * 最终那道 pass 把画面拷到屏幕时会写入 alpha=1，把透明度整个覆盖掉。实测：三十个 VJ
 * 隧道全部 100% 遮挡背景（连第一批线框 additive 的也一样），而没用 bloom 的
 * particles / nebula3d 是 98~100% 透 —— 所以根因在 composer，不在画面里画了什么。
 *
 * 修法是在 composer 末尾补一道 pass，按亮度把 alpha 写回去。这几条守的是：
 * 亮的地方仍然实（不然效果被背景洗掉）、暗的地方真的透（不然等于没修）、
 * 开关两个方向都真的生效。
 */

const SAMPLE = ['vjLiquidGrid', 'vjGridMorph', 'vjNeonTubeRoom', 'vjStarLane', 'vjEventHorizon', 'tunnel', 'synthwave'];

async function withApp(fn) {
  const dir = newUserDataDir('seethrough');
  let app = null, win = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      const rp = document.getElementById('restorePrompt'); if (rp) rp.style.display = 'none';
      /* 直接读 WebGL 的 alpha 通道就是遮挡程度，不用去模拟一张背景图。
         注意要在 renderBg3D() 之后立刻读 —— 画面每帧都会重画。 */
      window.__st = {
        measure(kind) {
          enableBg3D(kind);
          for (let i = 0; i < 60; i++) renderBg3D(0.7, 0.55, 0.45, 1);
          const gl = bg3DRenderer.getContext();
          const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
          const buf = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          /* 按像素自身的明暗分组统计 alpha。直接看「整屏多少全透」是不行的：
             画面铺满亮色时遮挡多本来就是物理必然（星轨点亮 99% 的像素），
             那种效果背景本来就该被挡住。真正要验的是那条映射有没有生效 ——
             暗的像素要透，亮的像素要实。这个判据不受画面满不满影响。 */
          let darkN = 0, darkA = 0, brightN = 0, brightA = 0, sumA = 0;
          for (let i = 0; i < w * h; i++) {
            const r = buf[i*4], g = buf[i*4+1], b = buf[i*4+2], a = buf[i*4+3];
            const mx = Math.max(r, Math.max(g, b));
            sumA += a;
            if (mx <= 40) { darkN++; darkA += a; }
            else if (mx >= 200) { brightN++; brightA += a; }
          }
          return {
            total: w*h,
            avgA: sumA / (w*h),
            darkPct: darkN / (w*h) * 100,
            darkAvgA: darkN ? darkA / darkN : 0,
            brightAvgA: brightN ? brightA / brightN : 255,
          };
        }
      };
    });
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

test('开着时暗部真的透，亮部仍然是实的', async () => {
  test.setTimeout(300_000);
  await withApp(async (win) => {
    expect(await win.evaluate(() => bg3DSeeThrough), '默认应该是开着的 —— 「背景永远看得到」是明确要求').toBe(true);
    for (const kind of SAMPLE) {
      const r = await win.evaluate((k) => window.__st.measure(k), kind);
      console.log(`  ${kind.padEnd(18)} 全屏平均遮挡 ${(r.avgA/255*100).toFixed(0).padStart(3)}%   ` +
                  `暗像素占 ${r.darkPct.toFixed(0).padStart(2)}% 其遮挡 ${(r.darkAvgA/255*100).toFixed(0).padStart(3)}%   ` +
                  `亮像素遮挡 ${(r.brightAvgA/255*100).toFixed(0).padStart(3)}%`);
      // 修之前整屏写死 alpha=255，暗处也一样挡得死死的
      expect.soft(r.darkAvgA, `${kind}: 暗的地方还是挡着背景`).toBeLessThan(60);
      // 亮的地方必须还是实的，否则效果会被背景洗淡 —— 这正是 mix-blend-mode:screen 的毛病
      expect.soft(r.brightAvgA, `${kind}: 亮部也变透了，效果会被背景洗掉`).toBeGreaterThan(200);
    }
  });
});

test('关掉之后回到原来的行为：整屏不透', async () => {
  test.setTimeout(300_000);
  await withApp(async (win) => {
    const before = await win.evaluate((k) => window.__st.measure(k), 'vjGridMorph');
    await win.evaluate(() => { bg3DSeeThrough = false; applyBg3DSeeThrough(); });
    const after = await win.evaluate((k) => window.__st.measure(k), 'vjGridMorph');
    console.log(`  开: 暗处遮挡 ${(before.darkAvgA/255*100).toFixed(0)}%   关: ${(after.darkAvgA/255*100).toFixed(0)}%`);
    expect(after.darkAvgA, '关掉后应该恢复成整屏不透').toBeGreaterThan(250);
    // 再开回来要能恢复 —— 场景是缓存的，开关必须改得到已经建好的那些 composer
    await win.evaluate(() => { bg3DSeeThrough = true; applyBg3DSeeThrough(); });
    const again = await win.evaluate((k) => window.__st.measure(k), 'vjGridMorph');
    expect(again.darkAvgA, '开关不可逆 —— 已缓存的场景没被改到').toBeLessThan(60);
  });
});

test('菜单按钮能开合，切语言时标签跟着变，选择记得住', async () => {
  test.setTimeout(300_000);
  const dir = newUserDataDir('seethrough-ui');
  const launch = async () => {
    const app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    const win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      const rp = document.getElementById('restorePrompt'); if (rp) rp.style.display = 'none';
    });
    await win.locator('#bg3DMenuBtn').click();
    await expect(win.locator('#bg3DMenu')).toHaveClass(/show/);
    return { app, win };
  };
  let a = await launch();
  try {
    const btn = a.win.locator('#bg3DSeeThroughBtn');
    await expect(btn).toHaveText(/See Through.*On/);
    await btn.click();
    await expect(btn).toHaveText(/See Through.*Off/);
    expect(await a.win.evaluate(() => bg3DSeeThrough)).toBe(false);
    // 走 STATEFUL_LABELS，切语言要跟着变
    await a.win.evaluate(() => applyLanguage('zh'));
    await expect(btn).toHaveText(/透出背景.*关/);
    await a.win.evaluate(() => applyLanguage('en'));
  } finally {
    await closeApp(a.app, a.win);
  }
  a = await launch();
  try {
    await expect(a.win.locator('#bg3DSeeThroughBtn'), '重开之后没记住').toHaveText(/See Through.*Off/);
    expect(await a.win.evaluate(() => bg3DSeeThrough)).toBe(false);
  } finally {
    await closeApp(a.app, a.win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
});
