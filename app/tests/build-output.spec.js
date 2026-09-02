const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const pkg = require('../package.json');

const DIST = path.join(__dirname, '..', '..', 'dist');
const UNPACKED_DIR = path.join(DIST, 'win-unpacked');
const EXE_NAME = `${pkg.build.productName}.exe`;
const EXE_PATH = path.join(UNPACKED_DIR, EXE_NAME);
// electron-builder's default NSIS artifact name template is "${productName} Setup ${version}.exe"
const INSTALLER_NAME = `${pkg.build.productName} Setup ${pkg.version}.exe`;
const INSTALLER_PATH = path.join(DIST, INSTALLER_NAME);
// app/package.json 的 extraResources 把项目根目录的 61.html 打进 resources/app/61.html
const SOURCE_HTML = path.join(__dirname, '..', '..', '61.html');
const PACKED_HTML = path.join(UNPACKED_DIR, 'resources', 'app', '61.html');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

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

/* 上面那条只查文件在不在，体积那条只查 >50MB —— 两条都绕过了内容，所以
   「dist/ 里是三天前构建的 exe」可以和整套测试全绿同时成立（实际发生过：打进
   1.1.0 的是 9 月 1 日一份未提交的 61.html，缺了 vjIonTrail 泛白修复和 ACES
   grade pass，而 155 项测试照样全过）。
   构建产物是否新鲜，只有比内容才问得出来。 */
test('打包进去的 61.html 就是当前源码，不是上一次构建留下的旧版', () => {
  expect(fs.existsSync(PACKED_HTML), `未找到打包产物 ${PACKED_HTML}`).toBe(true);

  const packed = sha256(PACKED_HTML);
  const source = sha256(SOURCE_HTML);

  expect(
    packed,
    `打包产物与源码不一致 —— dist/ 是旧的，重跑 npm run dist
` +
      `  源码   ${SOURCE_HTML}
    ${source}  (${fs.statSync(SOURCE_HTML).size} bytes)
` +
      `  打包版 ${PACKED_HTML}
    ${packed}  (${fs.statSync(PACKED_HTML).size} bytes)`
  ).toBe(source);
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

    await closeApp(app, win);
  } finally {
    cleanupUserDataDir(dir);
  }
});
