const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const APP_DIR = path.join(__dirname, '..');

/* 撤销是给「你的编辑」用的。自动轮换(定时器、突变检测)每切一次都记一条的话,
 * 开着轮换演出几分钟,50 条上限就被自动切换塞满,手动做过的操作全被挤掉;
 * 而且 pushUndo 会清空重做,轮换一切,刚撤销的东西也重做不回来。 */

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

// 打开某层的自动轮换(按时间间隔),截下它注册的定时器回调,不让它真的按时跑
function captureTimer(turnOn) {
  const real = window.setInterval; let cb = null;
  window.setInterval = (f) => { cb = f; return real(() => {}, 1e9); };
  try { turnOn(); } finally { window.setInterval = real; }
  return cb;
}

test('自动轮换(定时器和突变检测)切换时不记撤销、不清重做;手动 Next Look 照常记', async () => {
  await withApp('undo-auto', async win => {
    const r = await win.evaluate(captureTimerSrc => {
      const captureTimer = eval('(' + captureTimerSrc + ')');
      const out = {};
      // 先做一次手动编辑,再撤销:这样撤销栈和重做栈里都有东西
      pushUndo(); activeModes = [MODES.indexOf('bars')];
      pushUndo(); activeModes = [MODES.indexOf('wave')];
      performUndo();
      const undo0 = undoStack.length, redo0 = redoStack.length;

      // 2D:定时器
      document.getElementById('micShuffleIntervalSel').value = '32000';
      const micTick = captureTimer(() => setMicShuffle(true));
      for (let i = 0; i < 5; i++) micTick();
      setMicShuffle(false);
      // 3D 背景:定时器
      document.getElementById('bg3DShuffleIntervalSel').value = '32000';
      const bgTick = captureTimer(() => setBg3DShuffle(true));
      for (let i = 0; i < 5; i++) bgTick();
      setBg3DShuffle(false);
      // VJ:定时器挑下一条,节拍到了才真的切
      enableBg3D(VJ_TUNNEL_KINDS[0]);
      document.getElementById('vjShuffleIntervalSel').value = '32000';
      const vjTick = captureTimer(() => setVjShuffle(true));
      const kinds = new Set([bg3DKind]);
      for (let i = 0; i < 5; i++) { vjTick(); updateVjAutoSwitch(performance.now() + 1000); kinds.add(bg3DKind); }
      out.vjSwitched = kinds.size;
      // 三层的突变检测
      micShuffleOn = bg3DShuffleOn = true;
      for (const sub of SUDDEN_CHANGE_SUBSCRIBERS) { sub.fire(); updateVjAutoSwitch(performance.now() + 1000); }
      micShuffleOn = bg3DShuffleOn = false;
      setVjShuffle(false);
      out.afterAuto = { undo: undoStack.length - undo0, redo: redoStack.length - redo0 };

      // 手动 Next Look 仍然是一次编辑
      document.getElementById('nextLookBtn').click();
      out.afterManual = undoStack.length - undo0;
      return out;
    }, captureTimer.toString());
    expect(r.vjSwitched, 'VJ 定时器没真的切,测不到东西').toBeGreaterThan(3);
    expect(r.afterAuto, '自动轮换塞了撤销记录或清了重做').toEqual({ undo: 0, redo: 0 });
    expect(r.afterManual, '手动 Next Look 要能撤销').toBe(1);
  });
});
