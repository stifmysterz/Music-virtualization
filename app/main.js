const { app, BrowserWindow, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

// 开发时 61.html 在仓库根目录；打包后由 extraResources 放进 resources/app/
// 这里刻意不复制该文件——它是唯一事实来源。
const HTML_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'app', '61.html')
  : path.join(__dirname, '..', '61.html');

// 单实例锁：预设与自动保存全部存在 localStorage 里，两个实例抢同一个 Chromium 用户数据目录
// 会导致其中一个的写入静默丢失。第二次启动直接让位给已经在跑的那个实例。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  function createWindow() {
    const win = new BrowserWindow({
      width: 1600,
      height: 900,
      backgroundColor: '#000000',   // 避免启动瞬间的白屏闪烁
      autoHideMenuBar: true,        // 隐藏 Electron 默认菜单栏，应用自带控制条
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // autoHideMenuBar 只隐藏菜单栏的显示，不解绑它的快捷键——Ctrl+R/Ctrl+Shift+R 仍会
    // reload/force-reload 页面，Ctrl+W 仍会关闭窗口。这款应用的核心场景是长时间 4K 录制，
    // 一次意外的 Ctrl+R 会在渲染进程刷新时静默杀掉正在录制的流，且 61.html 里
    // fileWritable.close() 只在 onstop 里调用，reload 不会触发 onstop，留下一个
    // 永远打不开的截断 .webm。彻底移除应用菜单以解绑这些快捷键。
    Menu.setApplicationMenu(null);

    // 关闭守卫：录制中途关窗口会丢失整段录制。关闭前问一次渲染进程是否在录制，
    // 录制中则弹确认框；查询失败（页面还没跑完、脚本异常等任何原因）一律放行关闭，
    // 绝不能把用户困在一个关不掉的窗口里。
    let closeConfirmed = false;
    win.on('close', (event) => {
      if (closeConfirmed) return;
      event.preventDefault();

      win.webContents
        .executeJavaScript('(typeof isRecording !== "undefined" && isRecording) || false')
        .then((recording) => {
          if (!recording) {
            closeConfirmed = true;
            win.close();
            return;
          }
          const choice = dialog.showMessageBoxSync(win, {
            type: 'warning',
            buttons: ['Cancel', 'Close Anyway'],
            defaultId: 0,
            cancelId: 0,
            title: 'Recording in progress',
            message: 'A recording is currently in progress. Closing now will discard it.',
            detail: 'Close anyway?',
          });
          if (choice === 1) {
            closeConfirmed = true;
            win.close();
          }
        })
        .catch(() => {
          // 查询失败：不要把用户困在关不掉的窗口里，直接放行关闭。
          closeConfirmed = true;
          win.close();
        });
    });

    if (!fs.existsSync(HTML_PATH)) {
      dialog.showErrorBox(
        'SUB REMIX — 无法启动',
        `找不到应用文件：\n${HTML_PATH}\n\n安装可能已损坏，请重新安装。`
      );
      app.quit();
      return;
    }

    win.loadFile(HTML_PATH);
  }

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
