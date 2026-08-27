const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');
const DEG = Math.PI / 180;

/* Shift + 滚轮旋转。
 *
 * 原来两处都是 elRotation += e.deltaY * 0.0022。问题在于 deltaY 的数值在不同
 * 鼠标/触摸板上差异极大：普通滚轮一格是 100（→ 12.6°），很多触摸板一次只有 3
 * （→ 0.38°），还有 deltaMode=1 的行模式一格是 3 行。同一个动作在不同设备上转
 * 的角度差几十倍，转不满一圈也对不准角度 —— 用户说的「不够 360、不能够转准确」。
 *
 * 改成一格 = 一个固定角度（5°，按住 Alt 精调 1°），并把结果对齐到步长的整数倍，
 * 于是 72 格正好一整圈，任何设备都一致。
 */

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app = null, win = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

// 在 #bgImage 上转 n 格，返回累计角度（弧度）
function spinBg(n, opts) {
  const el = document.getElementById('bgImage');
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); x.fillStyle = '#f80'; x.fillRect(0, 0, 64, 64);
  el.src = c.toDataURL(); el.style.display = 'block';
  hasBgMedia = true; hasBgVideo = false;
  el._transform.set({ rotation: 0 });
  for (let i = 0; i < n; i++) {
    el.dispatchEvent(new WheelEvent('wheel', Object.assign({
      bubbles: true, cancelable: true, shiftKey: true, clientX: 400, clientY: 300
    }, opts)));
  }
  return el._transform.state().rotation;
}

test('一格就是一个固定角度，跟 deltaY 的数值大小无关', async () => {
  await withApp('rot-1', async (win) => {
    const res = await win.evaluate((spin) => {
      const run = eval('(' + spin + ')');
      return {
        mouse:     run(1, { deltaY: 100 }),               // 普通滚轮
        trackpad:  run(1, { deltaY: 3 }),                 // 触摸板的小增量
        lineMode:  run(1, { deltaY: 3, deltaMode: 1 }),   // 行模式
        huge:      run(1, { deltaY: 480 }),               // 快速甩一下
        negative:  run(1, { deltaY: -100 })               // 反向
      };
    }, spinBg.toString());

    // 四种设备/力度，同样一格，同样 5°
    expect(res.mouse).toBeCloseTo(5 * DEG, 6);
    expect(res.trackpad).toBeCloseTo(5 * DEG, 6);
    expect(res.lineMode).toBeCloseTo(5 * DEG, 6);
    expect(res.huge).toBeCloseTo(5 * DEG, 6);
    expect(res.negative).toBeCloseTo(-5 * DEG, 6);
  });
});

test('72 格正好转满一整圈', async () => {
  await withApp('rot-2', async (win) => {
    const res = await win.evaluate((spin) => {
      const run = eval('(' + spin + ')');
      return { full: run(72, { deltaY: 100 }), quarter: run(18, { deltaY: 100 }), half: run(36, { deltaY: 100 }) };
    }, spinBg.toString());

    expect(res.full).toBeCloseTo(2 * Math.PI, 6);
    expect(res.quarter).toBeCloseTo(Math.PI / 2, 6);   // 18 格 = 90°
    expect(res.half).toBeCloseTo(Math.PI, 6);          // 36 格 = 180°
  });
});

test('按住 Alt 变成 1° 精调', async () => {
  await withApp('rot-3', async (win) => {
    const res = await win.evaluate((spin) => {
      const run = eval('(' + spin + ')');
      return { fine: run(1, { deltaY: 100, altKey: true }), fine10: run(10, { deltaY: 100, altKey: true }) };
    }, spinBg.toString());

    expect(res.fine).toBeCloseTo(1 * DEG, 6);
    expect(res.fine10).toBeCloseTo(10 * DEG, 6);
  });
});

test('从一个不在格上的角度开始转，会先对齐到步长整数倍', async () => {
  await withApp('rot-4', async (win) => {
    const res = await win.evaluate((spin) => {
      const el = document.getElementById('bgImage');
      const run = eval('(' + spin + ')');
      run(0, { deltaY: 100 });                     // 先把背景装好
      el._transform.set({ rotation: 37.3 * Math.PI / 180 });   // 双指捏转留下的零头角度
      el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, shiftKey: true, deltaY: 100 }));
      return el._transform.state().rotation;
    }, spinBg.toString());

    // round(37.3/5)*5 + 5 = 40 —— 落在干净的角度上，而不是 37.3+12.6=49.9 这种零头
    expect(res).toBeCloseTo(40 * DEG, 6);
  });
});

test('转的时候会显示当前角度', async () => {
  await withApp('rot-5', async (win) => {
    const res = await win.evaluate((spin) => {
      const run = eval('(' + spin + ')');
      const hud = document.getElementById('gestureHud');
      if (!hud) return { missing: true };
      const before = getComputedStyle(hud).opacity;
      run(18, { deltaY: 100 });                    // 转到 90°
      const text = hud.textContent;
      // opacity 有 .25s 过渡，刚加上 class 的那一刻读到的还是 0，等过渡跑完再看
      return new Promise(resolve => setTimeout(() => resolve({
        missing: false, before, text,
        opacity: getComputedStyle(hud).opacity,
        shown: hud.classList.contains('show')
      }), 350));
    }, spinBg.toString());

    expect(res.missing).toBe(false);
    expect(res.before).toBe('0');            // 平时不该挡着画面
    expect(res.shown).toBe(true);
    expect(res.opacity).toBe('1');
    expect(res.text).toContain('90°');
  });
});

test('画布上的特效/logo 旋转用同一套步进', async () => {
  await withApp('rot-6', async (win) => {
    const res = await win.evaluate(() => {
      activeModes = [0]; focusModeIdx = 0;
      const pos = getModePos(0);
      pos.rotation = 0;
      const fire = (opts) => cv.dispatchEvent(new WheelEvent('wheel', Object.assign({
        bubbles: true, cancelable: true, shiftKey: true,
        clientX: innerWidth / 2, clientY: innerHeight / 2
      }, opts)));
      fire({ deltaY: 100 });
      const one = pos.rotation;
      for (let i = 0; i < 17; i++) fire({ deltaY: 3 });   // 再来 17 格小增量
      const eighteen = pos.rotation;
      return { one, eighteen };
    });

    expect(res.one).toBeCloseTo(5 * DEG, 6);
    expect(res.eighteen).toBeCloseTo(90 * DEG, 6);   // 一共 18 格 = 90°，不管每格 deltaY 多大
  });
});
