const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

// autoHideMenuBar 只隐藏菜单栏，不解绑它的默认快捷键（Ctrl+R 刷新、Ctrl+W 关闭等）——
// main.js 必须显式调用 Menu.setApplicationMenu(null) 才能真正解绑。这条测试守住这个事实，
// 防止将来有人往 main.js 里加菜单代码时无意中把 setApplicationMenu(null) 删掉，
// 导致 Ctrl+R 又能在录制中途悄悄刷新页面、丢掉整段录制。
test('应用菜单已被移除（防止默认快捷键在录制中意外触发）', async () => {
  const dir = newUserDataDir('menu');
  const app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
  try {
    const win = await app.firstWindow();
    const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu());
    expect(menu).toBeNull();
    await closeApp(app, win);
  } finally {
    cleanupUserDataDir(dir);
  }
});
