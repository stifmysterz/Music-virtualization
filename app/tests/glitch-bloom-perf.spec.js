const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* glitchBarsRgbBloom 的模糊只能做一次，不能每条 bar 做一次。
 *
 * Canvas 2D 的 filter 是逐绘制调用生效的，不是设一次管一片。原来的写法是
 *     g2.filter = `blur(...)`;
 *     bars.forEach(b => g2.fillRect(...));
 * ensureGlitchBars() 按平均 38px 一条铺满画布，于是每帧要做上百次全屏高斯模糊
 * （4K 下约 101 条 × 3 个 RGB 通道 = 300 多次）。实测窗口分辨率 8.5fps、
 * 4K 0.8fps（最差单帧 4.07 秒），而同族另外四个变体都是满帧 —— 差别就在那一行。
 *
 * 现在改成每个通道先平铺到离屏层、再带 filter 一次性合成，模糊次数固定是 3。
 * 这条测试守住的就是「不许再退回逐条模糊」。
 *
 * 判据用的是跟同族变体的相对比值，不是绝对毫秒数 —— 不同机器的绝对值差很多，
 * 但「bloom 比 snap 慢几倍」这个比值是稳定的（修复前 8 倍以上，修复后 ~1 倍）。
 */
test('glitchBarsRgbBloom 的帧时间要跟同族变体在一个量级', async () => {
  test.setTimeout(300_000);
  const dir = newUserDataDir('glitchbloom');
  let app = null, win = null;
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${dir}`, '--disable-background-timer-throttling',
             '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
      cwd: APP_DIR
    });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    // Chromium 会把失焦/被遮挡的窗口节流到 1fps，量帧率之前必须解除
    await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.webContents.setBackgroundThrottling(false); w.show(); w.focus();
    });

    await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      const rp = document.getElementById('restorePrompt'); if (rp) rp.style.display = 'none';
      freq = new Uint8Array(1024); wave = new Uint8Array(2048);
      analyser = {
        frequencyBinCount: freq.length, fftSize: wave.length,
        getByteFrequencyData(a) { for (let i = 0; i < a.length; i++) a[i] = Math.round(0.8 * (200 - (i % 60))); },
        getByteTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = 128 + Math.round(Math.sin(i * 0.1) * 80); }
      };
      disableBg3D();
      window.__g = { async frameTime(name, ms) {
        activeModes = [MODES.indexOf(name)];
        const t0 = performance.now(); let last = t0, n = 0; const gaps = [];
        await new Promise(res => { const tick = () => {
          const now = performance.now(); if (n > 0) gaps.push(now - last); last = now; n++;
          if (now - t0 < ms) requestAnimationFrame(tick); else res(); };
          requestAnimationFrame(tick); });
        gaps.sort((a, b) => a - b);
        return gaps[Math.floor(gaps.length / 2)];
      }};
    });

    const bloom = await win.evaluate(() => window.__g.frameTime('glitchBarsRgbBloom', 2500));
    const snap = await win.evaluate(() => window.__g.frameTime('glitchBarsRgbSnap', 2500));
    console.log(`  glitchBarsRgbBloom 中位帧 ${bloom.toFixed(1)}ms / glitchBarsRgbSnap ${snap.toFixed(1)}ms —— 比值 ${(bloom / snap).toFixed(2)}x`);

    // 修复前这个比值是 8.3x（138.0 / 16.7）。留足余量，但逐条模糊一旦回来必然远超 3x
    expect(bloom / snap, 'bloom 比同族变体慢太多 —— 检查 filter 是不是又回到了逐条绘制里').toBeLessThan(3);
    // 而且它自己也得跑得动（vsync 16.7ms，给一倍余量）
    expect(bloom, 'glitchBarsRgbBloom 跑不满帧').toBeLessThan(34);

    /* 画面还得画得出来 —— 三个通道都要画、亮度跟同族变体在一个量级。
       这里不去自动判定「blur 还在不在」：这个 mode 三个通道 additive 叠完中间是
       饱和白，扫描线上本来就几乎没有梯度（实测 bloom 0.15 / snap 0.02，两个都趋近 0），
       任何基于锐利度的判据在这种画面上都不成立。blur 的观感靠人眼比对截图守。 */
    const lum = await win.evaluate(async () => {
      const mean = (name) => {
        activeModes = [MODES.indexOf(name)];
        for (let i = 0; i < 12; i++) draw(performance.now());
        // W 是浮点（例如 1352.4），拿 imageData 自己报的宽度来循环，否则最后一次读越界得 NaN
        const img = fxCtx.getImageData(0, Math.floor(H / 2), Math.floor(W), 1);
        const d = img.data;
        let sum = 0;
        for (let x = 0; x < img.width; x++) sum += (d[x * 4] + d[x * 4 + 1] + d[x * 4 + 2]) / 3;
        return sum / img.width;
      };
      return { bloom: mean('glitchBarsRgbBloom'), snap: mean('glitchBarsRgbSnap') };
    });
    console.log(`  中线平均亮度 bloom ${lum.bloom.toFixed(1)} / snap ${lum.snap.toFixed(1)}`);
    expect(lum.bloom, 'bloom 画面是空的').toBeGreaterThan(20);
    expect(Math.abs(lum.bloom - lum.snap) / lum.snap, 'bloom 的亮度跟同族变体差太远 —— 是不是漏画了通道').toBeLessThan(0.5);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
});
