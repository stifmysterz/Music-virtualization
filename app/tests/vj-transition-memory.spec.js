const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

/* VJ 自动轮换淡出时,把旧画面截一张到 vjTransitionFrame 上。它跟 3D 画布一样大 —— 录 4K 且「录制时 3D」
   跟随录制画质时就是 3840×2160,约 33 MB。淡出结束后画布隐藏了,但位图要是不释放就一直占着。 */
test('VJ 淡出结束后释放那张截图', async () => {
  const dir = newUserDataDir('vj-transition-memory');
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: path.join(__dirname, '..') });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const r = await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      enableBg3D(VJ_TUNNEL_KINDS[0]);
      document.getElementById('vjShuffleIntervalSel').value = 'change';   // 不开定时器,由测试驱动
      setVjShuffle(true);
      const t0 = performance.now();
      runVjShuffleTick();
      updateVjAutoSwitch(t0 + 1000);                          // 切过去,开始淡出
      const during = { w: vjTransitionFrame.width, h: vjTransitionFrame.height, shown: vjTransitionFrame.style.display };
      updateVjAutoSwitch(t0 + 1000 + VJ_TRANSITION_MS + 50);  // 淡出走完
      const after = { w: vjTransitionFrame.width, h: vjTransitionFrame.height, shown: vjTransitionFrame.style.display };
      setVjShuffle(false);
      return { during, after, canvas: { w: bgThreeCanvas.width, h: bgThreeCanvas.height } };
    });
    expect(r.during.shown, '淡出时截图要显示出来,不然测不到东西').toBe('block');
    expect(r.during.w).toBe(r.canvas.w);
    expect(r.after.shown).toBe('none');
    expect(r.after.w * r.after.h, '淡出结束后截图的位图还占着').toBe(0);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
});
