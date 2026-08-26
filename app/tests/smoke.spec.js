const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const APP_DIR = path.join(__dirname, '..');

test('应用启动后打开窗口，标题正确，画布存在', async () => {
  const app = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win = await app.firstWindow();

  await expect.poll(() => win.title()).toBe('SUB REMIX — Music Visualizer');

  // cv 是主可视化画布，bgThree 是 3D 背景画布（61.html 中的两个 canvas）
  await expect(win.locator('#cv')).toHaveCount(1);
  await expect(win.locator('#bgThree')).toHaveCount(1);

  await app.close();
});

test('渲染循环真的在跑（画布尺寸被 resize() 设置过）', async () => {
  const app = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win = await app.firstWindow();

  // resize() 会把 canvas 的 width/height 设成实际像素尺寸；
  // 若脚本崩在前面，canvas 会停留在默认的 300x150
  //
  // 实测发现：firstWindow() 在 61.html 的内联脚本（2MB，含内联 THREE.js）执行完之前就
  // resolve 了，所以这里必须像上一条用例对 title 做的那样 poll 一下，等 resize() 真正跑完，
  // 否则会稳定地读到 canvas 默认值 300。这不是放宽断言——下面的阈值和原来一样。
  await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);

  const size = await win.evaluate(() => {
    const c = document.getElementById('cv');
    return { w: c.width, h: c.height };
  });
  expect(size.w).toBeGreaterThan(300);
  expect(size.h).toBeGreaterThan(150);

  await app.close();
});

test('页面加载过程中没有 JS 异常', async () => {
  const app = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win = await app.firstWindow();

  const errors = [];
  win.on('pageerror', e => errors.push(e.message));
  // 给渲染循环跑几帧的时间，捕捉初始化之后才抛出的错误
  await win.waitForTimeout(3000);

  expect(errors).toEqual([]);
  await app.close();
});
