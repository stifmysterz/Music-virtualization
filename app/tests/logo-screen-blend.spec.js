const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');

const APP_DIR = path.join(__dirname, '..');

/* Logo 的「✳ Remove Black BG」（logoScreenBlend）。
 *
 * 这个功能靠 canvas 的 'screen' 合成，把 logo 的纯黑底和「同一张画布上、已经画好的
 * 内容」混掉 —— screen(Cb, 0) = Cb，黑色不贡献任何东西，于是黑底消失、下面的特效透出来。
 *
 * 特效搬到 #cvFx 之后，前景 logo 仍留在 #cv 上，而 #cv 每帧被清空 —— screen 对着一张
 * 全透明的画布做合成，什么也不会发生（实测：不透明源 screen 到透明目标，结果 alpha 仍是
 * 255），黑底原样保留成一块黑方块盖住画面。
 *
 * 实测对比（不透明黑底 + 白圆的 logo，底下有 radial 特效在画，取黑底区域一点）：
 *   旧版 开启去黑底 → [153,76,77,255]  特效透出来，功能正常
 *   新版 开启去黑底 → [0,0,0,255]      还是黑块，功能失效
 *
 * 修法：开了去黑底的前景 logo 改画到 #cvFx 上（就在特效之后），让 screen 重新有东西可混。
 * 没开去黑底的 logo 保持画在 #cv 上，不受特效层 screen 混合的影响。
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

/* 造一个 logo：全不透明纯黑，正中一个白圆。
   直接塞进 slot，绕开 loadLogo() 的自动抠图 —— 那是另一个功能（removeLogoBackground），
   会把黑底变透明，就测不到 screen 混合了。
   会被 toString() 送进页面 eval，不能引用模块作用域。 */
function setupBlackLogoScene() {
  document.getElementById('intro')?.classList.add('hidden');
  freq = new Uint8Array(1024); wave = new Uint8Array(2048);
  for (let i = 0; i < freq.length; i++) freq[i] = 140 + (i % 80);
  for (let i = 0; i < wave.length; i++) wave[i] = 128 + Math.round(Math.sin(i * 0.09) * 50);
  analyser = {
    frequencyBinCount: freq.length, fftSize: wave.length,
    getByteFrequencyData(a) { for (let i = 0; i < a.length; i++) a[i] = 140 + (i % 80); },
    getByteTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = 128 + Math.round(Math.sin(i * 0.09) * 50); }
  };
  activeModes = [MODES.indexOf('radial')]; focusModeIdx = activeModes[0];

  const L = document.createElement('canvas'); L.width = L.height = 256;
  const lx = L.getContext('2d');
  lx.fillStyle = '#000'; lx.fillRect(0, 0, 256, 256);
  lx.fillStyle = '#fff'; lx.beginPath(); lx.arc(128, 128, 40, 0, 7); lx.fill();
  logos[0].img = L; logos[0].visible = true; logos[0].layer = 'front';
  logos[0].offX = 0; logos[0].offY = 0; logos[0].scale = 1; logos[0].rotation = 0;
  logos[0].opacity = 1; logos[0].bounceOn = false;
  selectedLogoIdx = 0; loadSlotToFlatVars(0);
}

test('开启去黑底时，logo 的黑底不再盖住底下的特效', async () => {
  await withApp('logosb-1', async (win) => {
    const res = await win.evaluate(async (setup) => {
      eval('(' + setup + ')')();
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });

      // 最终画面 = composeCaptureFrame()（按屏幕上的叠放顺序把三层合成起来）
      const read = () => {
        const R = Math.max(24, logos[0].screenR || 60);
        const black = { x: Math.round(CX + R * 0.55), y: Math.round(CY) };   // 黑底里、白圆外
        const white = { x: Math.round(CX), y: Math.round(CY) };              // 白圆正中
        const out = composeCaptureFrame().getContext('2d');
        return {
          black: Array.from(out.getImageData(black.x, black.y, 1, 1).data),
          white: Array.from(out.getImageData(white.x, white.y, 1, 1).data)
        };
      };

      logos[0].screenBlend = false; loadSlotToFlatVars(0);
      await frames(8);
      const off = read();

      logos[0].screenBlend = true; loadSlotToFlatVars(0);
      await frames(8);
      const on = read();
      return { off, on };
    }, setupBlackLogoScene.toString());

    const lum = p => p[0] + p[1] + p[2];

    // 关着的时候：黑底就该是黑的，盖住底下 —— 这是「不开这个功能」的正常表现
    expect(lum(res.off.black)).toBeLessThan(30);

    // 开着的时候：黑底必须被 screen 掉，看到的是底下的特效。
    // 回归时这里是 [0,0,0,255]。
    expect(lum(res.on.black)).toBeGreaterThan(60);

    // 两种情况下 logo 本身（白圆）都必须还看得见，别把 logo 一起弄没了
    expect(lum(res.off.white)).toBeGreaterThan(600);
    expect(lum(res.on.white)).toBeGreaterThan(600);
  });
});

test('没开去黑底的 logo 仍然画在 #cv 上，不被特效层的 screen 混合波及', async () => {
  await withApp('logosb-2', async (win) => {
    const res = await win.evaluate(async (setup) => {
      eval('(' + setup + ')')();
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
      const nz = el => {
        const d = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
      };
      // logo 黑底区域的一点，直接看它在 cv 上有没有像素
      const spot = () => {
        const R = Math.max(24, logos[0].screenR || 60);
        return { x: Math.round(CX + R * 0.55), y: Math.round(CY) };
      };
      const atCv = () => { const p = spot(); return Array.from(cv.getContext('2d').getImageData(p.x, p.y, 1, 1).data); };

      logos[0].screenBlend = false; loadSlotToFlatVars(0);
      await frames(8);
      const plain = { cv: nz(cv), px: atCv() };

      logos[0].screenBlend = true; loadSlotToFlatVars(0);
      await frames(8);
      const blended = { cv: nz(cv), px: atCv() };
      return { plain, blended };
    }, setupBlackLogoScene.toString());

    // 普通 logo：画在 cv 上，黑底区域那一点是不透明的
    expect(res.plain.cv).toBeGreaterThan(1000);
    expect(res.plain.px[3]).toBeGreaterThan(200);
    // 开了去黑底之后 logo 挪去了特效层 —— cv 上那一点变透明，整体像素也明显变少
    expect(res.blended.px[3]).toBe(0);
    expect(res.blended.cv).toBeLessThan(res.plain.cv / 2);
  });
});

test('back 层 logo 的行为不受影响，仍画在 #cvBack 上', async () => {
  await withApp('logosb-3', async (win) => {
    const res = await win.evaluate(async (setup) => {
      eval('(' + setup + ')')();
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
      const nz = el => {
        const d = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
      };
      logos[0].layer = 'back'; logos[0].screenBlend = true; loadSlotToFlatVars(0);
      await frames(8);
      return { cvBack: nz(document.getElementById('cvBack')), cv: nz(cv) };
    }, setupBlackLogoScene.toString());

    // back 层 logo 本来就在特效之下，screen 没有东西可混（旧版也一样），
    // 这里只确认它没有被误画到别的层
    expect(res.cvBack).toBeGreaterThan(1000);
  });
});
