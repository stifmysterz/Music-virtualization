const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Electron 应用启动 + WebGL 初始化比普通网页慢，给足超时
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Electron 测试共用同一个用户数据目录，并行会互相打架
  workers: 1,
  reporter: 'list',
});
