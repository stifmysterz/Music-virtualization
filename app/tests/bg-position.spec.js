const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');

const APP_DIR = path.join(__dirname, '..');

/* 背景定位（Position BG）。
 *
 * 原来的 makeTransformable() 用 getBoundingClientRect() 反算绝对位置来拖动：
 *   offX = clientX - r.left;  ... el.style.left = clientX - offX
 * 但 r.left 是「变换之后」的可视左边缘，而 style.left 是「变换之前」的布局左边缘。
 * transform-origin 是中心，所以缩放 s 倍后两者差 (w - s*w)/2。背景宽 130vw，
 * 放大到 2.4 倍时实测：鼠标按下后移动 0 像素，背景直接跳了 -1098px。缩放越大跳越狠，
 * 1 倍时不跳 —— 这就是「background adjust 拉不准」。
 *
 * 修法：ensurePositioned() 改用可视中心 + 未变换的 offsetWidth 反推布局左上角，
 * 拖动改成累加位移增量，不再每帧反算绝对位置。另外补一组 X/Y/缩放/角度 数值滑杆。
 */

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    const win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win);
  } finally {
    if (app) { try { await app.close(); } catch (e) {} }
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

// 装一张背景图并显示出来，返回后即可对 #bgImage 施加真实的指针/滚轮事件
function installBackground() {
  const el = document.getElementById('bgImage');
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); x.fillStyle = '#f80'; x.fillRect(0, 0, 64, 64);
  el.src = c.toDataURL();
  el.style.display = 'block';
  hasBgMedia = true; hasBgVideo = false;
  return el;
}

// 注意：这个函数会被 toString() 送进页面里 eval，拿不到模块作用域的任何东西，
// 所以装背景那几行必须内联，不能调用上面的 installBackground()
function dragProbe(scaleSteps) {
  const el = document.getElementById('bgImage');
  {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); x.fillStyle = '#f80'; x.fillRect(0, 0, 64, 64);
    el.src = c.toDataURL();
    el.style.display = 'block';
    hasBgMedia = true; hasBgVideo = false;
  }
  const rect = () => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top }; };
  // 用真实的滚轮路径放大，和用户操作走同一段代码
  for (let i = 0; i < scaleSteps; i++) {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true, clientX: 400, clientY: 300 }));
  }
  const before = rect();
  const opts = { bubbles: true, pointerId: 1, clientX: 400, clientY: 300, isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new PointerEvent('pointermove', opts));      // 移动 0 像素
  const afterZero = rect();
  el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: 500, clientY: 340 }));  // 右 100 下 40
  const afterMove = rect();
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  return {
    scale: parseFloat(el.dataset.txScale || '1'),
    jumpX: afterZero.l - before.l,
    jumpY: afterZero.t - before.t,
    travelX: afterMove.l - afterZero.l,
    travelY: afterMove.t - afterZero.t
  };
}

test('放大后开始拖动不会跳位，且跟手 1:1', async () => {
  await withApp('bgpos-1', async (win) => {
    const res = await win.evaluate((probe) => eval('(' + probe + ')')(6), dragProbe.toString());

    expect(res.scale).toBeGreaterThan(2);          // 前提：确实放大了，否则这条测试没意义
    // 鼠标没动，背景就不该动。修复前这里是 -1098 / -555。
    expect(Math.abs(res.jumpX)).toBeLessThan(2);
    expect(Math.abs(res.jumpY)).toBeLessThan(2);
    // 拖动跟手：鼠标走多少，背景走多少
    expect(res.travelX).toBeCloseTo(100, 0);
    expect(res.travelY).toBeCloseTo(40, 0);
  });
});

test('还没缩放过、仍是 CSS 居中状态时，第一次拖动也不跳位', async () => {
  await withApp('bgpos-2', async (win) => {
    const res = await win.evaluate((probe) => eval('(' + probe + ')')(0), dragProbe.toString());

    expect(res.scale).toBeCloseTo(1, 3);
    // 第一次按下时 ensurePositioned() 要把「left/top:50% + translate(-50%,-50%)」
    // 干净地换算成绝对 left/top，换算错就会偏半个身位（背景是 130vw，那是上千像素）
    expect(Math.abs(res.jumpX)).toBeLessThan(2);
    expect(Math.abs(res.jumpY)).toBeLessThan(2);
    expect(res.travelX).toBeCloseTo(100, 0);
    expect(res.travelY).toBeCloseTo(40, 0);
  });
});

test('X / Y / 缩放 / 角度 滑杆能精确设定背景，重置能回到默认位置', async () => {
  await withApp('bgpos-3', async (win) => {
    const res = await win.evaluate((install) => {
      const el = eval('(' + install + ')')();
      const ids = ['bgPosXSel', 'bgPosYSel', 'bgScaleSel', 'bgRotateSel'];
      const missing = ids.filter(i => !document.getElementById(i));
      if (missing.length || !document.getElementById('bgPosResetBtn')) return { missing: missing.concat(document.getElementById('bgPosResetBtn') ? [] : ['bgPosResetBtn']) };

      const set = (id, v) => {
        const s = document.getElementById(id);
        s.value = String(v);
        s.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const centre = () => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

      const home = centre();
      set('bgPosXSel', 150);
      set('bgPosYSel', -80);
      const moved = centre();
      set('bgScaleSel', 200);          // 200% = 2 倍
      const scaled = parseFloat(el.dataset.txScale);
      set('bgRotateSel', 90);          // 90 度
      const rotated = parseFloat(el.dataset.txRotation);

      document.getElementById('bgPosResetBtn').click();
      const afterReset = { centre: centre(), scale: parseFloat(el.dataset.txScale), rotation: parseFloat(el.dataset.txRotation) };

      // 拖一下之后滑杆要跟着走，不然面板上的数字会跟画面对不上
      const opts = { bubbles: true, pointerId: 1, clientX: 400, clientY: 300, isPrimary: true };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new PointerEvent('pointermove', opts));
      el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: 460 }));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      const sliderAfterDrag = parseFloat(document.getElementById('bgPosXSel').value);

      return {
        missing: [],
        dx: moved.x - home.x, dy: moved.y - home.y,
        scaled, rotated,
        resetDx: afterReset.centre.x - home.x, resetDy: afterReset.centre.y - home.y,
        resetScale: afterReset.scale, resetRotation: afterReset.rotation,
        sliderAfterDrag
      };
    }, installBackground.toString());

    expect(res.missing).toEqual([]);
    expect(res.dx).toBeCloseTo(150, 0);
    expect(res.dy).toBeCloseTo(-80, 0);
    expect(res.scaled).toBeCloseTo(2, 3);
    expect(res.rotated).toBeCloseTo(Math.PI / 2, 3);
    // 重置 = 回到默认居中位置、1 倍、0 度
    expect(Math.abs(res.resetDx)).toBeLessThan(2);
    expect(Math.abs(res.resetDy)).toBeLessThan(2);
    expect(res.resetScale).toBeCloseTo(1, 3);
    expect(res.resetRotation).toBeCloseTo(0, 3);
    // 拖了 60px，滑杆读数要跟上
    expect(res.sliderAfterDrag).toBeCloseTo(60, 0);
  });
});

test('resize / 开关 dock 菜单不会把拖好的背景拽回左上角', async () => {
  await withApp('bgpos-4', async (win) => {
    const res = await win.evaluate((install) => {
      const el = eval('(' + install + ')')();
      const t = el._transform;

      // 拖到一个明显偏离默认的位置，并放大
      t.set({ x: 260, y: -140, scale: 1.6 });
      const before = el.getBoundingClientRect();

      // clampPositionedElements() 挂在 resize、fullscreenchange，以及一个监听
      // .dock-dd class 变化的 MutationObserver 上 —— 也就是说随便开一个 dock
      // 下拉菜单就会跑一次。旧实现里背景比视口宽，算出的 maxLeft 恒为 0，
      // 于是每次都把 style.left 强行写成 0px，背景直接飞到左上角。
      clampPositionedElements();
      const afterClamp = el.getBoundingClientRect();

      // 再真的开一次 Background 菜单，走完整的 MutationObserver 路径
      const menu = document.getElementById('bgMenu');
      menu.classList.add('show');
      return new Promise(resolve => {
        setTimeout(() => {
          const afterMenu = el.getBoundingClientRect();
          menu.classList.remove('show');
          resolve({
            clampDx: afterClamp.left - before.left,
            clampDy: afterClamp.top - before.top,
            menuDx: afterMenu.left - before.left,
            state: t.state(),
            // 面板数字必须和真实状态一致
            sliderX: parseFloat(document.getElementById('bgPosXSel').value)
          });
        }, 120);
      });
    }, installBackground.toString());

    expect(Math.abs(res.clampDx)).toBeLessThan(2);
    expect(Math.abs(res.clampDy)).toBeLessThan(2);
    expect(Math.abs(res.menuDx)).toBeLessThan(2);
    expect(res.state.x).toBeCloseTo(260, 0);
    expect(res.sliderX).toBeCloseTo(260, 0);
  });
});
