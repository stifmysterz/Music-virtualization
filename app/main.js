const { app, BrowserWindow } = require('electron');
const path = require('path');

// 61.html 位于仓库根目录，即 app/ 的上一级。
// 这里刻意不复制该文件——它是唯一事实来源。
const HTML_PATH = path.join(__dirname, '..', '61.html');

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
