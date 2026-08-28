const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 2D 背景（图片/视频）的低音跳动，默认档位下要和 logo 同一个量级。
 *
 * 两边的幅度滑杆是同一个范围、同一个默认值（0~150，默认 60 = amt 0.6），但系数差很多：
 *     logo 的 punch     pulse = 1 + beat*amt*0.6        → 默认档 +36%
 *     背景的 basspunch  scale = 1 + beat*0.16*amt + …   → 默认档 +9.3%
 * 同一个滑杆位置差 3.75 倍，所以背景看起来「没什么在跳」。
 *
 * 实测（每一粒，默认档）：
 *     3D 背景  +50%      logo +36%      2D 背景 +9.3% / 亮度 +18%
 * 把三个 bass* 风格的系数提上来，让 2D 背景在默认档就和另外两个同一档。
 * 滑杆推到底（1.5）时背景缩放约 +72%，仍然比 logo 的 +90% 温和。
 *
 * 只动 basspunch / basszoom / bassshake 这三个吃 beat 的。drift / breathe / sway 那些
 * 是环境类的慢动作，不该跟着变猛 —— 下面有回归测试盯着。
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

/* 喂真实频谱驱动 detectBeat，然后比较「安静那一帧」和「命中那一帧」的跳动参数。
   不钉死 beat —— 钉死就测不到 detectBeat 之后的链路了。 */
function bouncePunch() {
  window.__q = {
    clock: 1000,
    feed(level, now) { for (let i = 0; i < freq.length; i++) freq[i] = i < 30 ? level : 40; return detectBeat(now); },
    settle(level, n) { let t = window.__q.clock; for (let i = 0; i < n; i++) window.__q.feed(level, t + i * 16.7); window.__q.clock = t + n * 16.7; return window.__q.clock; },
    // 返回某个跳动风格在某个幅度下，一粒鼓点造成的冲击
    punch(style, amt, bassLevel = 0.8) {
      resetBeatDetector();
      const t = window.__q.settle(20, 60);
      window.__q.clock = t + 5000;              // 时钟只能往前，否则不应期会挡掉下一粒
      bgBounceOn = true; bgBounceStyle = style; bgBounceAmt = amt;
      const quiet = computeBgBounceParams(bassLevel, 0, 0, t);
      window.__q.feed(220, t);                   // 一粒踢鼓
      const hit = computeBgBounceParams(bassLevel, 0, 0, t);
      /* bassshake 的位移是 Math.random() 出来的，单次采样从 0 到上界都可能 ——
         断言单次的值必然偶发失败。beat 不会因为再调几次而改变（只有 detectBeat 会动它），
         所以在同一粒里多采几次取上界，才是在量「这一粒最多能抖多远」。 */
      let offsetMax = 0;
      for (let i = 0; i < 60; i++) {
        const s = computeBgBounceParams(bassLevel, 0, 0, t);
        offsetMax = Math.max(offsetMax, Math.abs(s.offX), Math.abs(s.offY));
      }
      return {
        beat: +beat.toFixed(3),
        scalePct: +((hit.scale / quiet.scale - 1) * 100).toFixed(1),
        brightPct: +((hit.brightness / quiet.brightness - 1) * 100).toFixed(1),
        blur: +hit.blur.toFixed(2),
        offsetMax: +offsetMax.toFixed(1)
      };
    }
  };
  document.getElementById('intro')?.classList.add('hidden');
  const rp = document.getElementById('restorePrompt'); if (rp) rp.style.display = 'none';
  freq = new Uint8Array(1024); wave = new Uint8Array(2048);
  manualBPM = null;
  resetBeatDetector();
}

test('默认档位下，2D 背景的低音跳动和 logo 同一个量级', async () => {
  await withApp('bgstr-1', async (win) => {
    const res = await win.evaluate((h) => {
      eval('(' + h + ')')();
      const Q = window.__q;
      const DEFAULT_AMT = document.getElementById('bgBounceAmtSel').value / 100;
      // logo 的 punch 在同一档位是多少（对照基准）
      const logoPunchPct = (1 + 1 * DEFAULT_AMT * 0.6 - 1) * 100;
      return {
        defaultAmt: DEFAULT_AMT,
        sliderDefault: document.getElementById('bgBounceAmtSel').value,
        logoPunchPct: +logoPunchPct.toFixed(1),
        basspunch: Q.punch('basspunch', DEFAULT_AMT),
        basszoom: Q.punch('basszoom', DEFAULT_AMT),
        bassshake: Q.punch('bassshake', DEFAULT_AMT)
      };
    }, bouncePunch.toString());

    expect(res.basspunch.beat, '鼓点没打中，这个测试就没在测东西').toBeGreaterThanOrEqual(0.999);
    // 修之前：缩放 +9.3%、亮度 +18%，而 logo 同档位是 +36%
    expect(res.basspunch.scalePct, `Bass Punch 的缩放只有 +${res.basspunch.scalePct}%，logo 同档位是 +${res.logoPunchPct}%`).toBeGreaterThan(25);
    expect(res.basspunch.brightPct, `Bass Punch 的亮度只有 +${res.basspunch.brightPct}%`).toBeGreaterThan(35);
    // 另外两个吃 beat 的也要跟上
    expect(res.basszoom.scalePct, `Bass Zoom 的缩放只有 +${res.basszoom.scalePct}%`).toBeGreaterThan(30);
    expect(res.basszoom.blur, `Bass Zoom 的模糊只有 ${res.basszoom.blur}px`).toBeGreaterThan(2.5);
    // 上界是 beat*amt*44 = 26.4px；60 次采样的最大值会很接近它
    expect(res.bassshake.offsetMax, `Bass Shake 的位移上界只有 ${res.bassshake.offsetMax}px`).toBeGreaterThan(22);
  });
});

test('滑杆推到底也不比 logo 更猛，推到 0 就完全不动', async () => {
  await withApp('bgstr-2', async (win) => {
    const res = await win.evaluate((h) => {
      eval('(' + h + ')')();
      const Q = window.__q;
      const MAX = document.getElementById('bgBounceAmtSel').max / 100;
      return {
        max: MAX,
        logoMaxPct: +((1 * MAX * 0.6) * 100).toFixed(1),
        atMax: Q.punch('basspunch', MAX),
        atZero: Q.punch('basspunch', 0)
      };
    }, bouncePunch.toString());

    expect(res.atMax.scalePct, `推到底 +${res.atMax.scalePct}%，比 logo 的 +${res.logoMaxPct}% 还猛`).toBeLessThan(res.logoMaxPct);
    expect(res.atZero.scalePct, '幅度归零还在跳').toBeCloseTo(0, 1);
    expect(res.atZero.brightPct).toBeCloseTo(0, 1);
  });
});

test('环境类的慢动作风格没有被一起改猛', async () => {
  await withApp('bgstr-3', async (win) => {
    const res = await win.evaluate((h) => {
      eval('(' + h + ')')();
      const amt = 0.6;
      bgBounceOn = true; bgBounceAmt = amt;
      const out = {};
      // 这几个都不吃 beat，只随时间/持续音量慢慢动；数值范围应该维持原样
      bgBounceStyle = 'drift';
      const d = computeBgBounceParams(0.8, 0, 0, 0);          // sin(0)=0, cos(0)=1
      out.driftOffY = +d.offY.toFixed(2);                      // cos(0)*24*0.6 = 14.4
      bgBounceStyle = 'breathe';
      const b = computeBgBounceParams(0.8, 0, 0, 0);           // 1 + 0 + 0.8*0.04*0.6
      out.breatheScale = +b.scale.toFixed(4);
      bgBounceStyle = 'sway';
      const s = computeBgBounceParams(0.8, 0, 0, 2600 * Math.PI / 2);   // sin(π/2)=1 → 0.05*0.6
      out.swayRot = +s.rotation.toFixed(4);
      return out;
    }, bouncePunch.toString());

    expect(res.driftOffY).toBeCloseTo(14.4, 1);
    expect(res.breatheScale).toBeCloseTo(1 + 0.8 * 0.04 * 0.6, 4);
    expect(res.swayRot).toBeCloseTo(0.05 * 0.6, 4);
  });
});
