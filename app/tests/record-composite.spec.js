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
    await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      const restore = document.getElementById('restorePrompt');
      if (restore) restore.style.display = 'none';
    });
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

async function installSolidBackground(win, colour) {
  await win.evaluate(async c => {
    const source = document.createElement('canvas');
    source.width = source.height = 8;
    const sourceCtx = source.getContext('2d');
    sourceCtx.fillStyle = c;
    sourceCtx.fillRect(0, 0, 8, 8);
    loadBgImage(source.toDataURL());
    await bgImageEl.decode();
    bgImageEl.style.filter = 'none';
    bgImageEl.style.width = '100vw';
    bgImageEl.style.height = '100vh';
  }, colour);
}

function centrePixel() {
  const out = composeCaptureFrame();
  return Array.from(out.getContext('2d').getImageData(out.width >> 1, out.height >> 1, 1, 1).data);
}

test('录制合成包含普通图片 Background', async () => {
  await withApp('record-composite-bg', async win => {
    await installSolidBackground(win, '#d02030');
    const pixel = await win.evaluate(centrePixel);
    expect(pixel[0]).toBeGreaterThan(190);
    expect(pixel[1]).toBeLessThan(60);
    expect(pixel[2]).toBeLessThan(70);
    expect(pixel[3]).toBe(255);
  });
});

async function rendered3DStats(win, kind) {
  return win.evaluate(k => {
    // Clear the 2D overlay canvases so this assertion only measures the WebGL layer.
    [cvBack, cvFx, cv].forEach(c => c.getContext('2d').clearRect(0, 0, c.width, c.height));
    enableBg3D(k);
    for (let i = 0; i < 12; i++) renderBg3D(0.72, 0.55, 0.43, 1);
    const out = composeCaptureFrame();
    const data = out.getContext('2d').getImageData(0, 0, out.width, out.height).data;
    let changed = 0, colourful = 0;
    // Sparse sampling keeps this cheap even when the configured recording size is large.
    for (let y = 0; y < out.height; y += 8) {
      for (let x = 0; x < out.width; x += 8) {
        const i = (y * out.width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (Math.abs(r - 5) + Math.abs(g - 6) + Math.abs(b - 14) > 35) changed++;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 25) colourful++;
      }
    }
    return { changed, colourful, width: out.width, cvWidth: cv.width };
  }, kind);
}

test('录制合成包含普通 3D Background', async () => {
  test.setTimeout(120_000);
  await withApp('record-composite-3d', async win => {
    const stats = await rendered3DStats(win, 'particles');
    expect(stats.width).toBe(stats.cvWidth);
    expect(stats.changed).toBeGreaterThan(10);
    expect(stats.colourful).toBeGreaterThan(3);
  });
});

test('录制合成包含 VJ WebGL 画面', async () => {
  test.setTimeout(120_000);
  await withApp('record-composite-vj', async win => {
    const stats = await rendered3DStats(win, 'vjLiquidGrid');
    expect(stats.width).toBe(stats.cvWidth);
    expect(stats.changed).toBeGreaterThan(100);
    expect(stats.colourful).toBeGreaterThan(30);
  });
});

test('Background、3D、2D Visualizer、FX/Overlay 按屏幕层序进入同一录制帧', async () => {
  await withApp('record-composite-layers', async win => {
    await installSolidBackground(win, '#c00000');
    const result = await win.evaluate(() => {
      // Use deterministic pixels for every canvas layer. bgThree stands in for the already-rendered
      // WebGL framebuffer; composeCaptureFrame must treat it exactly as it treats a real 3D/VJ frame.
      bgThreeCanvas.width = cv.width;
      bgThreeCanvas.height = cv.height;
      bgThreeCanvas.style.display = 'block';
      bgThreeCanvas.style.filter = 'none';
      bgThreeCanvas.style.opacity = '1';
      hasBg3D = true; bg3DVisible = true;
      const three = bgThreeCanvas.getContext('2d');
      three.clearRect(0, 0, bgThreeCanvas.width, bgThreeCanvas.height);
      three.fillStyle = '#008000';
      three.fillRect(0, 0, bgThreeCanvas.width / 2, bgThreeCanvas.height);

      [cvBack, cvFx, cv].forEach(c => c.getContext('2d').clearRect(0, 0, c.width, c.height));
      backCtx.fillStyle = '#0000d0';
      backCtx.fillRect(W / 2, 0, W / 2, H);
      fxBlendOn = false;
      fxCtx.fillStyle = '#d0d000';
      fxCtx.fillRect(0, H / 2, W, H / 2);
      mainCtx.fillStyle = '#ffffff';
      mainCtx.fillRect(W / 2 - 20, H / 2 - 20, 40, 40);

      const out = composeCaptureFrame(), ctx = out.getContext('2d');
      const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
      return {
        threeOverBg: px(W / 4, H / 4),
        backOverBg: px(W * 3 / 4, H / 4),
        fxOverAll: px(W / 4, H * 3 / 4),
        frontOverlay: px(W / 2, H / 2)
      };
    });

    expect(result.threeOverBg.slice(0, 3)).toEqual([0, 128, 0]);
    expect(result.backOverBg.slice(0, 3)).toEqual([0, 0, 208]);
    expect(result.fxOverAll.slice(0, 3)).toEqual([208, 208, 0]);
    expect(result.frontOverlay.slice(0, 3)).toEqual([255, 255, 255]);
  });
});

