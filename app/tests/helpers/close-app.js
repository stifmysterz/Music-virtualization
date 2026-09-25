/* 关闭应用时，main.js 的关闭守卫会先问渲染进程「要不要把这套存成 Look」，并等一个
   明确的回答（不设时限 —— 人可能正在想名字，超时强关等于替他做了「不保存」的决定）。
   测试里没有人去点那个浮层，所以 app.close() 会一直挂着。
   这里统一替它按「不保存退出」——走的是真实流程，不是绕过守卫。

   录制中关闭走的是另一条路：同步原生对话框（showMessageBoxSync），主进程阻塞到有人点，
   页面里的浮层根本不会出现。所以最后还有一道有界等待：超时就结束整棵 Electron 进程树，
   并打印警告 —— 挂住的进程留在后台会抢 GPU，让后面的性能测试假性超时。

   用法：把每个 spec 里 finally 中的 app.close() 换成 closeApp(app, win)。 */
const { execFileSync } = require('child_process');

const CLOSE_TIMEOUT_MS = 15_000;

function killProcessTree(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    // Electron 的 GPU / 渲染子进程也叫 electron.exe；只杀主进程会把它们留成孤儿
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else proc.kill('SIGKILL');
  } catch (_e) {
    // 进程恰好在这之间自己退出了
  }
}

async function closeApp(app, win) {
  if (!app) return;
  const proc = app.process();
  const closing = app.close().catch(() => {});
  if (win) {
    try {
      await win.waitForFunction(() => {
        const el = document.getElementById('exitSavePrompt');
        return !!el && getComputedStyle(el).display !== 'none';
      }, null, { timeout: 5000 });
      await win.evaluate(() => document.getElementById('exitSaveNoBtn').click());
    } catch (e) {
      // 浮层没出现（页面还没跑完、或这个版本还没有这个功能）——直接等它自己关掉
    }
  }
  let timer;
  const timedOut = await Promise.race([
    closing.then(() => false),
    new Promise(resolve => { timer = setTimeout(() => resolve(true), CLOSE_TIMEOUT_MS); }),
  ]);
  clearTimeout(timer);
  if (timedOut) {
    console.warn(`closeApp: Electron (pid ${proc?.pid}) did not exit within ${CLOSE_TIMEOUT_MS / 1000}s — killing its process tree`);
    killProcessTree(proc);
    await closing;
  }
}

module.exports = { closeApp };
