const fs = require('fs');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const pkg = require('../package.json');

const DIST = path.join(__dirname, '..', '..', 'dist');
const UNPACKED_DIR = path.join(DIST, 'win-unpacked');
const EXE_NAME = `${pkg.build.productName}.exe`;
const EXE_PATH = path.join(UNPACKED_DIR, EXE_NAME);
// electron-builder's default NSIS artifact name template is "${productName} Setup ${version}.exe"
const INSTALLER_NAME = `${pkg.build.productName} Setup ${pkg.version}.exe`;
const INSTALLER_PATH = path.join(DIST, INSTALLER_NAME);

// 这三个测试是构建后校验，只在跑过 `npm run dist` 之后才有意义。
// dist/ 从不会在构建之间被清理，所以只判断 dist/ 存在是不够的——一次中断/半成品的构建会
// 留下 dist/ 目录但没有 win-unpacked/SUB REMIX.exe，此时应当干净跳过而不是让测试3
// 花 60 秒超时才失败。因此跳过条件同时检查两者。
test.skip(() => !fs.existsSync(DIST) || !fs.existsSync(EXE_PATH), '尚未构建，先跑 npm run dist');

test('Windows 安装包已生成且体积合理', () => {
  // 断言精确的期望文件名，而不是对 .exe 列表取 [0]——dist/ 不会被清理，版本号升级后
  // 目录里可能同时存在多个版本的安装包，取 [0] 可能拿到一个过期的旧安装包去做体积校验。
  expect(fs.existsSync(INSTALLER_PATH), `未找到期望的安装包 ${INSTALLER_NAME}`).toBe(true);

  const size = fs.statSync(INSTALLER_PATH).size;
  // Electron 应用装完带 Chromium，安装包通常 60MB 以上；
  // 明显偏小说明 61.html 或 fonts 没被打进去
  expect(size).toBeGreaterThan(50 * 1024 * 1024);
});

test('打包资源中包含 61.html 与字体', () => {
  const unpacked = path.join(UNPACKED_DIR, 'resources', 'app');
  expect(fs.existsSync(path.join(unpacked, '61.html'))).toBe(true);
  expect(fs.existsSync(path.join(unpacked, 'fonts'))).toBe(true);
});

test('打包后的可执行文件能启动并加载正确内容', async () => {
  const dir = newUserDataDir('build-output');
  const app = await electron.launch({
    executablePath: EXE_PATH,
    args: [`--user-data-dir=${dir}`],
  });
  try {
    const win = await app.firstWindow();

    // firstWindow() 在 61.html 的内联脚本执行完之前就 resolve，
    // 所以像 smoke.spec.js 一样对 title 和 canvas 宽度做 poll，
    // 而不是直接读取（会稳定读到默认值）。
    await expect.poll(() => win.title()).toBe('SUB REMIX — Music Visualizer');
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);

    await app.close();
  } finally {
    cleanupUserDataDir(dir);
  }
});
