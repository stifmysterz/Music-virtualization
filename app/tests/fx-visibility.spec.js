const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 特效必须永远在背景之上、永远看得见。
 *
 * 一开始为了解决「有些特效盖死背景」，给 #cvFx 上了 mix-blend-mode:screen。
 * 但 screen 数学上不可能让画面变暗 —— screen(255, 任何值) = 255。实测在白色背景上：
 *   radial      可见度 screen=0   / normal=108
 *   glitchBars  可见度 screen=0   / normal=328
 * 也就是浅色背景上特效完全消失，看起来就像被背景盖住了。
 *
 * 扫描全部 241 个特效的不透明覆盖率后发现，真正会盖死背景的只有 glitchBars 家族那
 * 21 个（每个都是 99.8% 满屏不透明）；其余 220 个最高也就 45%，本来就不挡背景。
 * 为这 21 个牺牲另外 220 个不划算。
 *
 * 所以：#cvFx 改回普通叠加（特效永远完全可见），只把 glitchBars 家族画成半透明，
 * 背景照样透得出来。screen 那个开关保留但默认关掉，想要 VJ 加色感的人可以自己开。
 */

const GLITCH_MODES = ['glitchBarsClassic', 'glitchBarsRgbBass', 'glitchBarsScanScroll', 'glitchBarsRainbowScroll'];

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

// 把某个 mode 单独渲染到离屏画布，量「完全不透明像素」占整屏的比例。
// 照搬 renderModeThumbnail() 的做法：W/H/DPR 都不动，只把 g2 换掉。
function opaqueCoverage(keys) {
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  const saved = { g2, rot, fxOffX, fxOffY, freq, wave };
  const out = {};
  try {
    g2 = octx; fxOffX = 0; fxOffY = 0;
    freq = new Uint8Array(1024); wave = new Uint8Array(2048);
    for (let i = 0; i < freq.length; i++) freq[i] = 150 + Math.round(Math.sin(i * 0.12) * 60);
    for (let i = 0; i < wave.length; i++) wave[i] = 128 + Math.round(Math.sin(i * 0.09) * 50);
    keys.forEach(key => {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalAlpha = 1; octx.globalCompositeOperation = 'source-over'; octx.filter = 'none';
      octx.clearRect(0, 0, W, H);
      let now = performance.now(), dt = 16;
      for (let f = 0; f < 12; f++) { rot += 0.0030 * dt; dispatchModeDraw(key, 0.55, 0.45, 0.5, now, dt); now += dt; }
      const d = octx.getImageData(0, 0, W, H).data;
      let opaque = 0, any = 0;
      for (let i = 3; i < d.length; i += 4) { if (d[i] >= 250) opaque++; if (d[i] > 8) any++; }
      out[key] = { opaquePct: 100 * opaque / (W * H), coveragePct: 100 * any / (W * H) };
    });
  } finally {
    g2 = saved.g2; rot = saved.rot; fxOffX = saved.fxOffX; fxOffY = saved.fxOffY; freq = saved.freq; wave = saved.wave;
  }
  return out;
}

test('特效层默认用普通叠加，不再是 screen —— 浅色背景上特效才不会消失', async () => {
  await withApp('fxvis-1', async (win) => {
    const res = await win.evaluate(() => ({
      blend: getComputedStyle(document.getElementById('cvFx')).mixBlendMode,
      toggleExists: !!document.getElementById('fxBlendToggle'),
      fxBlendOn
    }));

    expect(res.blend).toBe('normal');
    expect(res.fxBlendOn).toBe(false);
    // 开关保留 —— 深色背景上那种 VJ 加色感还是有人要的
    expect(res.toggleExists).toBe(true);
  });
});

test('那个开关还能把 screen 混合打开', async () => {
  await withApp('fxvis-2', async (win) => {
    const res = await win.evaluate(() => {
      const fx = document.getElementById('cvFx');
      document.getElementById('fxBlendToggle').click();
      const on = { blend: getComputedStyle(fx).mixBlendMode, flag: fxBlendOn };
      document.getElementById('fxBlendToggle').click();
      const off = { blend: getComputedStyle(fx).mixBlendMode, flag: fxBlendOn };
      return { on, off };
    });

    expect(res.on.blend).toBe('screen');
    expect(res.on.flag).toBe(true);
    expect(res.off.blend).toBe('normal');
    expect(res.off.flag).toBe(false);
  });
});

test('glitchBars 家族改成半透明，不再糊死整屏', async () => {
  await withApp('fxvis-3', async (win) => {
    const res = await win.evaluate(({ fn, keys }) => eval('(' + fn + ')')(keys),
      { fn: opaqueCoverage.toString(), keys: GLITCH_MODES });

    GLITCH_MODES.forEach(key => {
      // 改之前每一个都是 99.8% 全屏不透明，把背景盖得一点不剩
      expect(res[key].opaquePct, key).toBeLessThan(5);
      // 但它们仍然要画满屏 —— 变的是透明度，不是覆盖范围
      expect(res[key].coveragePct, key).toBeGreaterThan(80);
    });
  });
});

test('其余特效不受影响，该多不透明还是多不透明', async () => {
  await withApp('fxvis-4', async (win) => {
    const res = await win.evaluate(({ fn, keys }) => eval('(' + fn + ')')(keys),
      { fn: opaqueCoverage.toString(), keys: ['bars', 'filledWave', 'polarWaveform'] });

    // 这几个本来就只盖住部分屏幕（20-45%），背景在其余地方看得见，不该动它们
    expect(res.bars.opaquePct).toBeGreaterThan(10);
    expect(res.filledWave.opaquePct).toBeGreaterThan(20);
    expect(res.polarWaveform.opaquePct).toBeGreaterThan(5);
  });
});

test('白色背景上 glitchBars 既看得见、又透得出背景', async () => {
  await withApp('fxvis-5', async (win) => {
    const res = await win.evaluate(async () => {
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
      document.getElementById('intro')?.classList.add('hidden');

      const el = document.getElementById('bgImage');
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 64);
      el.src = c.toDataURL(); el.style.display = 'block';
      hasBgMedia = true; hasBgVideo = false;
      const o = document.getElementById('bgOpacitySel'); o.value = 100; o.dispatchEvent(new Event('input'));

      freq = new Uint8Array(1024); wave = new Uint8Array(2048);
      for (let i = 0; i < freq.length; i++) freq[i] = 150 + (i % 70);
      for (let i = 0; i < wave.length; i++) wave[i] = 128 + Math.round(Math.sin(i * 0.09) * 50);
      analyser = {
        frequencyBinCount: freq.length, fftSize: wave.length,
        getByteFrequencyData(a) { for (let i = 0; i < a.length; i++) a[i] = 150 + (i % 70); },
        getByteTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = 128 + Math.round(Math.sin(i * 0.09) * 50); }
      };
      activeModes = [MODES.indexOf('glitchBarsClassic')]; focusModeIdx = activeModes[0];
      await frames(10);

      // 屏幕上的最终颜色 = cvFx 用普通叠加压在白色背景上
      const d = document.getElementById('cvFx').getContext('2d')
        .getImageData(Math.round(CX), Math.round(CY), 1, 1).data;
      const sa = d[3] / 255;
      const over = i => Math.round(255 * (1 - sa) + d[i] * sa);
      const final = [over(0), over(1), over(2)];
      const visibility = Math.abs(final[0] - 255) + Math.abs(final[1] - 255) + Math.abs(final[2] - 255);
      return { fxAlpha: d[3], final, visibility };
    });

    // 白底上必须看得清清楚楚。screen 时期这里是 0。
    expect(res.visibility).toBeGreaterThan(100);
    // 但也不能是完全不透明，否则又变回「盖死背景」
    expect(res.fxAlpha).toBeLessThan(250);
    expect(res.fxAlpha).toBeGreaterThan(120);
  });
});
