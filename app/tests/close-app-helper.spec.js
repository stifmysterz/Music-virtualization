const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (_e) { return false; }
}
function electronCount() {
  if (process.platform !== 'win32') return 0;
  const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq electron.exe', '/NH'], { encoding: 'utf8' });
  return out.split('\n').filter(l => /^electron\.exe/i.test(l.trim())).length;
}

/* 录制中关闭会弹一个同步原生对话框（main.js 的 showMessageBoxSync），主进程阻塞到有人点它。
   测试里没人点 —— closeApp 以前会永远等下去，Electron 进程树留在后台抢 GPU，
   让后面的性能测试假性超时。这里要求它有界地返回，并且不留下任何 electron.exe。 */
test('closeApp returns and leaves no Electron processes when the close guard blocks', async () => {
  test.setTimeout(90_000);
  const before = electronCount();
  const dir = newUserDataDir('close-app-helper');
  let app = null, win = null, pid = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: path.join(__dirname, '..') });
    pid = app.process().pid;
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => { isRecording = true; });

    const started = Date.now();
    const outcome = await Promise.race([
      closeApp(app, win).then(() => 'returned'),
      new Promise(resolve => setTimeout(() => resolve('hung'), 45_000)),
    ]);
    app = null;
    expect(outcome, 'closeApp 在关闭守卫阻塞时一直没有返回').toBe('returned');
    expect(Date.now() - started).toBeLessThan(45_000);
    expect(alive(pid), 'Electron 主进程还活着').toBe(false);
    await expect.poll(electronCount, { timeout: 10_000 }).toBe(before);
  } finally {
    if (app) await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
});
