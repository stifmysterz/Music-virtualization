const fs = require('fs');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const DIST = path.join(__dirname, '..', '..', 'dist');

// 这两个测试是构建后校验，只在跑过 `npm run dist` 之后才有意义。
// 未构建时条件跳过——被明确报告为「跳过」，不会让全量测试误红，
// 也不会伪装成通过。
test.skip(() => !fs.existsSync(DIST), '尚未构建，先跑 npm run dist');

test('Windows 安装包已生成且体积合理', () => {
  const installers = fs.readdirSync(DIST).filter(f => f.endsWith('.exe'));
  expect(installers.length).toBeGreaterThan(0);

  const size = fs.statSync(path.join(DIST, installers[0])).size;
  // Electron 应用装完带 Chromium，安装包通常 60MB 以上；
  // 明显偏小说明 61.html 或 fonts 没被打进去
  expect(size).toBeGreaterThan(50 * 1024 * 1024);
});

test('打包资源中包含 61.html 与字体', () => {
  const unpacked = path.join(DIST, 'win-unpacked', 'resources', 'app');
  expect(fs.existsSync(path.join(unpacked, '61.html'))).toBe(true);
  expect(fs.existsSync(path.join(unpacked, 'fonts'))).toBe(true);
});

test('打包后的可执行文件能启动并加载正确内容', async () => {
  const app = await electron.launch({
    executablePath: path.join(DIST, 'win-unpacked', 'SUB REMIX.exe'),
  });
  const win = await app.firstWindow();

  // firstWindow() 在 61.html 的内联脚本执行完之前就 resolve，
  // 所以像 smoke.spec.js 一样对 title 和 canvas 宽度做 poll，
  // 而不是直接读取（会稳定读到默认值）。
  await expect.poll(() => win.title()).toBe('SUB REMIX — Music Visualizer');
  await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);

  await app.close();
});
