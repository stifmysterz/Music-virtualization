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
// 页面内:当前 3D 状态快照
const STATE = `() => {
  const s = bg3DScenes[bg3DKind], size = bg3DRenderer.getDrawingBufferSize(new THREE.Vector2());
  return { W, H, bufW: size.x, bufH: size.y, pr: bg3DRenderer.getPixelRatio(), samples: s.composer.renderTarget1.samples };
}`;

test('录制时 3D 缓冲 = 录制分辨率、MSAA ≤ 2、第一帧合成里 3D 不是空的;停录后复原', async () => {
  test.setTimeout(120_000);
  await withApp('rec-res', async win => {
    const r = await win.evaluate(stateSrc => {
      const state = eval(stateSrc);
      const sel = document.getElementById('vjQualitySel'); sel.value = 'ultra'; sel.dispatchEvent(new Event('change'));
      enableBg3D('vjChromeFlow'); renderBg3D(0.5, 0.4, 0.3, 1);
      const before = state();
      const rows = [];
      for (const q of ['4k', '1440p', '1080p']) {
        recordQuality = q;
        enterRecordingResolution();
        const st = state();
        const cap = composeCaptureFrame();
        const d = captureCtx.getImageData(Math.floor(cap.width * 0.3), Math.floor(cap.height * 0.3), Math.floor(cap.width * 0.4), Math.floor(cap.height * 0.4)).data;
        let lit = 0; for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) >= 40) lit++;
        rows.push({ q, ...st, capLit: lit / (d.length / 4) });
        exitRecordingResolution();
      }
      return { before, rows, after: state() };
    }, STATE);
    for (const row of r.rows) {
      expect.soft(Math.abs(row.bufW - row.W), `${row.q}: 3D 缓冲宽度`).toBeLessThanOrEqual(1);
      expect.soft(row.samples, `${row.q}: 录制时 MSAA 上限`).toBeLessThanOrEqual(2);
      expect.soft(row.capLit, `${row.q}: 第一帧合成里 3D 区域是空的`).toBeGreaterThan(0.05);
    }
    expect(r.after).toEqual(r.before);
  });
});

test('录制中窗口缩放不会把 3D 缓冲打回屏幕尺寸', async () => {
  await withApp('rec-res-resize', async win => {
    const r = await win.evaluate(stateSrc => {
      const state = eval(stateSrc);
      enableBg3D('vjChromeFlow');
      recordQuality = '4k'; enterRecordingResolution();
      resize();
      const during = state();
      exitRecordingResolution();
      return during;
    }, STATE);
    expect(Math.abs(r.bufW - r.W)).toBeLessThanOrEqual(1);
  });
});

test('录制中切画质档:新合成器也是录制分辨率且 MSAA ≤ 2,停录后恢复档位倍数', async () => {
  await withApp('rec-res-tier', async win => {
    const r = await win.evaluate(stateSrc => {
      const state = eval(stateSrc);
      setVjQualityTier('ultra'); enableBg3D('vjChromeFlow');
      recordQuality = '1440p'; enterRecordingResolution();
      setVjQualityTier('balanced'); setVjQualityTier('ultra');
      const during = state();
      exitRecordingResolution();
      return { during, after: state() };
    }, STATE);
    expect(Math.abs(r.during.bufW - r.during.W)).toBeLessThanOrEqual(1);
    expect(r.during.samples).toBeLessThanOrEqual(2);
    expect(r.after.samples).toBe(4);
  });
});

test('low 档录制时 MSAA 仍然是 0,不会被"限到 2"反而升上去', async () => {
  await withApp('rec-res-low', async win => {
    const r = await win.evaluate(stateSrc => {
      const state = eval(stateSrc);
      setVjQualityTier('low'); enableBg3D('vjChromeFlow');
      recordQuality = '4k'; enterRecordingResolution();
      const during = state();
      exitRecordingResolution();
      return { during, after: state() };
    }, STATE);
    expect(r.during.samples).toBe(0);
    expect(r.after.samples).toBe(0);
  });
});
