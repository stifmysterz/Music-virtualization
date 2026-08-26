const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Electron 应用启动 + WebGL 初始化比普通网页慢，给足超时
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // 每个测试现在都用独立的临时 --user-data-dir（见 tests/helpers/tmp-user-data.js），
  // 不再共用同一份用户数据目录；workers 仍保持 1，避免同时跑多个 Electron+WebGL 实例
  // 挤占资源导致偶发超时。
  workers: 1,
  reporter: 'list',
});
