const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 录制期间画布缓冲区必须锁死在 4K。
 *
 * startRecording() 会把三层画布切到 3840×2160（enterRecordingResolution），录出来的
 * 才是 4K。但 resize() 一直是无条件按窗口重算 W/H 并写 canvas.width 的，而 resize()
 * 的触发点很多，其中一个是「.mode-panel / .dock-dd 的 class 变化」那个 MutationObserver
 * —— 也就是说，录制中随手打开任何一个 dock 菜单，缓冲区就被打回窗口分辨率。
 * 实测：3840 → 打开 Mode drop-up 后 1352；→ 打开 Background 菜单后 1007
 * （后者还额外被 PANEL_SAFE_ZONE 的 300px 侧栏让位又缩了一截）。
 * 而且不会自己恢复 —— exitRecordingResolution() 只在停止录制时才跑。
 *
 * 这是既有问题（main 上 resize() 同样直接写 cv.width），不是这条分支引入的，
 * 但现在 Mode 也变成 drop-up 了，录制中会去点的菜单只多不少。
 */

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

test('录制分辨率生效期间，打开 dock 菜单不会把画布打回窗口分辨率', async () => {
  await withApp('recres-1', async (win) => {
    const res = await win.evaluate(async () => {
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
      const snap = () => ({ W: Math.round(W), cv: cv.width, cvFx: cvFx.width, cvBack: cvBack.width });

      enterRecordingResolution();
      await frames(3);
      const atStart = snap();

      document.getElementById('modeBtn').click();          // drop-up
      await frames(3);
      const afterModeMenu = snap();

      document.querySelectorAll('.dock-dd.show').forEach(m => m.classList.remove('show'));
      await frames(3);
      const afterModeClose = snap();

      document.getElementById('bgMenuBtn').click();         // 右侧侧栏，还会改 PANEL_SAFE_ZONE
      await frames(3);
      const afterBgMenu = snap();

      document.querySelectorAll('.dock-dd.show').forEach(m => m.classList.remove('show'));
      await frames(3);

      dispatchEvent(new Event('resize'));                   // 窗口尺寸变化也不该动它
      await frames(3);
      const afterWindowResize = snap();

      exitRecordingResolution();
      await frames(3);
      const afterExit = snap();

      // 录制分辨率现在可选 4K/1440p/1080p，宽度从 recordDims() 取（原来是 RECORD_W 常量）
      return { atStart, afterModeMenu, afterModeClose, afterBgMenu, afterWindowResize, afterExit, recordW: recordDims()[0] };
    });

    expect(res.atStart.cv).toBe(res.recordW);
    for (const [label, s] of [['打开 Mode drop-up', res.afterModeMenu],
                              ['关掉 Mode drop-up', res.afterModeClose],
                              ['打开 Background 菜单', res.afterBgMenu],
                              ['窗口 resize', res.afterWindowResize]]) {
      expect(s.cv,     `${label} 之后 #cv 掉出 4K`).toBe(res.recordW);
      expect(s.cvFx,   `${label} 之后 #cvFx 掉出 4K`).toBe(res.recordW);
      expect(s.cvBack, `${label} 之后 #cvBack 掉出 4K`).toBe(res.recordW);
      expect(s.W,      `${label} 之后 W 掉出 4K`).toBe(res.recordW);
    }
    // 停止录制之后要老老实实回到窗口分辨率
    expect(res.afterExit.cv).toBeLessThan(res.recordW);
    expect(res.afterExit.cv).toBeGreaterThan(300);
  });
});

test('录制期间三层画布的 CSS 尺寸不随侧栏变化——面板只缩编辑预览，不动逻辑构图', async () => {
  // 「固定逻辑输出舞台 + 自适应编辑预览」上线后，cv/cvFx/cvBack 的 style.width/left
  // 本身就是逻辑分辨率，不再随侧栏变化；侧栏挤压的是 visualStage 外面那层预览 transform。
  // 这条测试原本断言"侧栏打开 CSS 显示尺寸必须变窄"，那正是这次要修掉的行为——现在改成
  // 断言反过来的那半才是对的：CSS 尺寸不变，previewScale() 才应该跟着侧栏变。
  await withApp('recres-2', async (win) => {
    const res = await win.evaluate(async () => {
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
      const css = () => [cv, cvFx, cvBack].map(c => c.style.width + '/' + c.style.left);

      enterRecordingResolution();
      await frames(3);
      const before = { css: css(), scale: previewScale() };

      document.getElementById('bgMenuBtn').click();   // 侧栏一开，编辑预览要让位
      await frames(4);
      const during = { css: css(), scale: previewScale() };

      document.querySelectorAll('.dock-dd.show').forEach(m => m.classList.remove('show'));
      await frames(4);
      const after = { css: css(), scale: previewScale() };
      exitRecordingResolution();
      await frames(2);
      return { before, during, after };
    });

    // 三层的 CSS 尺寸/位置任何时候都必须完全一致，否则合成会错位
    [res.before.css, res.during.css, res.after.css].forEach(trio => {
      expect(new Set(trio).size, '三层画布的 CSS 尺寸/位置不一致: ' + JSON.stringify(trio)).toBe(1);
    });
    // 逻辑分辨率/CSS 尺寸不受侧栏影响——这是本次架构改动的核心断言。
    expect(res.during.css[0]).toBe(res.before.css[0]);
    expect(res.after.css[0]).toBe(res.before.css[0]);
    // 让位这件事没有消失，只是换成了编辑预览缩放。
    expect(res.during.scale).toBeLessThan(res.before.scale - 0.001);
    expect(res.after.scale).toBeCloseTo(res.before.scale, 5);
  });
});
