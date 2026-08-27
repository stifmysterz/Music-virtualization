const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');

const APP_DIR = path.join(__dirname, '..');

/* 🎯 Position BG 是个「隐形模式」。
 *
 * 开着时 cv.style.pointerEvents='none'，整个画布不吃事件 —— 选特效、拖特效、
 * 双击开 Mode 面板、滚轮缩放旋转全部失效，事件统统落到背景元素上。而屏幕上没有
 * 任何提示（按钮文字确实会变成「Adjusting…」，但那在 Background 下拉菜单里，
 * 菜单一关就看不见了），也没有任何退出方式 —— 没 Esc、没点空白退出、没超时。
 *
 * 实测症状：同一个「有特效像素、不在 logo 上」的点双击，
 *   正常时         → 落在 cv，Mode 面板打开，lastInteracted='mode'
 *   Position BG 开 → 落在 bgImage，面板不开，而且背景的缩放/角度被双击重置掉
 * 也就是用户说的「双击不到 mode，一直在背景」。
 *
 * 这段模态逻辑本来就有，但把 X/Y/缩放/角度 滑杆挂到这个按钮下面之后，用户为了用
 * 滑杆会去按它，于是撞上的概率大增。
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

// 装好背景 + 让一个特效真的在画，并找一个「有特效像素、不在 logo 上」的点。
// 会被 toString() 送进页面 eval，所以不能引用模块作用域的任何东西。
function setupScene() {
  document.getElementById('intro')?.classList.add('hidden');
  const bg = document.getElementById('bgImage');
  const c = document.createElement('canvas'); c.width = c.height = 64;
  c.getContext('2d').fillRect(0, 0, 64, 64);
  bg.src = c.toDataURL(); bg.style.display = 'block';
  hasBgMedia = true; hasBgVideo = false;
  freq = new Uint8Array(1024); wave = new Uint8Array(2048);
  for (let i = 0; i < freq.length; i++) freq[i] = 120 + (i % 80);
  for (let i = 0; i < wave.length; i++) wave[i] = 128 + Math.round(Math.sin(i * 0.09) * 50);
  analyser = {
    frequencyBinCount: freq.length, fftSize: wave.length,
    getByteFrequencyData(a) { for (let i = 0; i < a.length; i++) a[i] = 120 + (i % 80); },
    getByteTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = 128 + Math.round(Math.sin(i * 0.09) * 50); }
  };
  activeModes = [MODES.indexOf('radial')]; focusModeIdx = activeModes[0];
  return new Promise(res => { let n = 10; const t = () => (--n <= 0 ? res() : requestAnimationFrame(t)); requestAnimationFrame(t); })
    .then(() => {
      const rect = cv.getBoundingClientRect();
      const L = layerCanvases[activeModes[0]];
      for (let ry = 0.15; ry < 0.9; ry += 0.05) {
        for (let rx = 0.1; rx < 0.9; rx += 0.05) {
          const cx = Math.round(rect.left + rect.width * rx), cy = Math.round(rect.top + rect.height * ry);
          const p = { x: (cx - rect.left) * DPR, y: (cy - rect.top) * DPR };
          if (p.x < 0 || p.y < 0 || p.x >= L.canvas.width || p.y >= L.canvas.height) continue;
          if (L.ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data[3] > 15 && !overLogo(p)) return { cx, cy };
        }
      }
      return null;
    });
}

test('开启 Position BG 时屏幕上有常驻提示，关掉就消失', async () => {
  await withApp('bgadj-1', async (win) => {
    const res = await win.evaluate(() => {
      const banner = document.getElementById('bgAdjustBanner');
      if (!banner) return { missing: true };
      const before = getComputedStyle(banner).display;
      document.getElementById('bgAdjustBtn').click();
      document.querySelectorAll('.dock-dd.show').forEach(m => m.classList.remove('show'));  // 关掉菜单
      const during = { display: getComputedStyle(banner).display, text: banner.textContent };
      document.getElementById('bgAdjustBtn').click();
      return { missing: false, before, during, after: getComputedStyle(banner).display };
    });

    expect(res.missing).toBe(false);
    expect(res.before).toBe('none');
    // 菜单关掉之后提示条仍然在 —— 这正是原来完全看不出自己在这个模式里的地方
    expect(res.during.display).not.toBe('none');
    expect(res.during.text.length).toBeGreaterThan(0);
    expect(res.after).toBe('none');
  });
});

test('Esc 和点提示条都能退出这个模式', async () => {
  await withApp('bgadj-2', async (win) => {
    const res = await win.evaluate(() => {
      const enter = () => {
        document.getElementById('bgAdjustBtn').click();
        document.querySelectorAll('.dock-dd.show').forEach(m => m.classList.remove('show'));
      };
      const snapshot = () => ({
        on: bgAdjustOn,
        pe: cv.style.pointerEvents,
        banner: getComputedStyle(document.getElementById('bgAdjustBanner')).display
      });

      enter();
      const inMode = snapshot();
      dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const afterEsc = snapshot();

      enter();
      document.getElementById('bgAdjustBanner').click();
      const afterBannerClick = snapshot();
      return { inMode, afterEsc, afterBannerClick };
    });

    expect(res.inMode.on).toBe(true);
    expect(res.inMode.pe).toBe('none');
    expect(res.afterEsc.on).toBe(false);
    expect(res.afterEsc.pe).toBe('auto');            // 画布重新收事件
    expect(res.afterEsc.banner).toBe('none');
    expect(res.afterBannerClick.on).toBe(false);
    expect(res.afterBannerClick.pe).toBe('auto');
  });
});

test('双击背景不再把缩放/角度重置掉（重置改由 ↺ Reset Position 负责）', async () => {
  await withApp('bgadj-3', async (win) => {
    const res = await win.evaluate((setup) => eval('(' + setup + ')')().then(() => {
      const bg = document.getElementById('bgImage');
      bg._transform.set({ scale: 1.6, rotation: 0.4 });
      bg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 300, clientY: 300 }));
      const afterDbl = bg._transform.state();
      document.getElementById('bgPosResetBtn').click();
      const afterReset = bg._transform.state();
      return { afterDbl, afterReset };
    }), setupScene.toString());

    expect(res.afterDbl.scale).toBeCloseTo(1.6, 3);      // 双击不动它
    expect(res.afterDbl.rotation).toBeCloseTo(0.4, 3);
    expect(res.afterReset.scale).toBeCloseTo(1, 3);      // 但明确的重置按钮照旧有效
    expect(res.afterReset.rotation).toBeCloseTo(0, 3);
  });
});

test('退出 Position BG 之后，双击又能正常选中特效（用户报的症状）', async () => {
  await withApp('bgadj-4', async (win) => {
    const res = await win.evaluate((setup) => eval('(' + setup + ')')().then((spot) => {
      if (!spot) return { noSpot: true };
      const dbl = () => {
        lastInteracted = null;
        document.querySelector('.mode-panel')?.classList.remove('show');
        const hit = document.elementFromPoint(spot.cx, spot.cy);
        (hit || cv).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: spot.cx, clientY: spot.cy }));
        return {
          element: hit ? (hit.id || hit.tagName) : null,
          panel: document.querySelector('.mode-panel')?.classList.contains('show') ?? false,
          last: lastInteracted
        };
      };

      const normal = dbl();
      document.getElementById('bgAdjustBtn').click();
      document.querySelectorAll('.dock-dd.show').forEach(m => m.classList.remove('show'));
      const inMode = dbl();
      dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const recovered = dbl();
      return { noSpot: false, normal, inMode, recovered };
    }), setupScene.toString());

    expect(res.noSpot).toBe(false);
    expect(res.normal.element).toBe('cv');
    expect(res.normal.panel).toBe(true);
    expect(res.normal.last).toBe('mode');
    // 模式里事件确实归背景（这是这个模式的用途），但现在屏幕上看得见、Esc 出得来
    expect(res.inMode.element).toBe('bgImage');
    // Esc 之后必须完全恢复 —— 这才是用户卡住的地方
    expect(res.recovered.element).toBe('cv');
    expect(res.recovered.panel).toBe(true);
    expect(res.recovered.last).toBe('mode');
  });
});
