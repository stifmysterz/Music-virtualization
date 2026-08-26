const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const APP_DIR = path.join(__dirname, '..');

test('localStorage 写入的值能跨应用重启存活', async () => {
  const KEY = 'subremix_e2e_probe';
  const VALUE = 'persisted-' + Date.now();

  // 第一次启动：写入
  const app1 = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win1 = await app1.firstWindow();
  await win1.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, VALUE]);
  // 确认当前会话内确实写进去了（file:// 下 localStorage 可能整个不可用）
  const immediate = await win1.evaluate(k => localStorage.getItem(k), KEY);
  expect(immediate).toBe(VALUE);
  await app1.close();

  // 第二次启动：读回
  const app2 = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win2 = await app2.firstWindow();
  const readBack = await win2.evaluate(k => localStorage.getItem(k), KEY);
  await win2.evaluate(k => localStorage.removeItem(k), KEY);   // 清理探针
  await app2.close();

  expect(readBack).toBe(VALUE);
});

test('应用自身的语言设置能跨重启存活', async () => {
  // 走真实代码路径：applyLanguage() 会写 subremix_lang（61.html:5674）
  const app1 = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win1 = await app1.firstWindow();
  // 61.html 的 2MB 内联脚本在 firstWindow() resolve 之后才会跑完，
  // applyLanguage 在脚本跑完前不存在——等它出现再调用（同 smoke.spec.js 的 poll 惯例）。
  await expect.poll(() => win1.evaluate(() => typeof applyLanguage)).toBe('function');
  await win1.evaluate(() => applyLanguage('zh'));
  await app1.close();

  const app2 = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win2 = await app2.firstWindow();
  const lang = await win2.evaluate(() => localStorage.getItem('subremix_lang'));
  await expect.poll(() => win2.evaluate(() => typeof applyLanguage)).toBe('function');
  await win2.evaluate(() => applyLanguage('en'));   // 还原，避免影响后续测试
  await app2.close();

  expect(lang).toBe('zh');
});
