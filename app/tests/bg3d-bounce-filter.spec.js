const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 背景跳动的画面参数要传给 3D 背景，不能只传几何参数。
 *
 * computeBgBounceParams() 会算出 9 个参数，但 applyBgBounceToCamera() 只取
 * offX / offY / rotation / scale 四个几何量，把 brightness / blur / contrast / saturate
 * 全丢掉。而 2D 背景（图片/视频）走 updateBgBounceDom()，四个全用上了。
 * 于是同一个跳动风格，图片背景和 3D 背景表现完全不同 —— 实测 Bass Punch 算出
 * brightness 1.18，传到 3D 的只有 zoom 1.132，画布 filter 仍是 brightness(1)。
 *
 * 13 个跳动风格里有 7 个在 3D 上残废，其中 5 个基本等于什么都不做：
 *     虚焦脉冲  3D 只拿到 −5% 微缩，丢掉 blur（它的全部内容）
 *     暗角脉冲  3D 只拿到 ±2% 缩放，丢掉 brightness（它的全部内容）
 *     饱和脉冲  3D 只拿到 +5% 缩放，丢掉 saturate（它的全部内容）
 *     反差闪光  3D 只拿到 +4% 缩放，丢掉 contrast（它的全部内容）
 *     颗粒脉冲  3D 只拿到 ±0.6% 缩放，丢掉 contrast + brightness
 *     低音重击  丢掉鼓点那一下 brightness 闪光
 *     低音猛推  丢掉 blur
 *
 * 合成的位置是现成的：applyBg3DFilter() 已经在把基准亮度、高音闪烁、变色和
 * Director 的亮度冲击合成到同一个 filter 上，这四个字段并进去即可。
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

/* 把跳动风格设好、渲一帧、把 3D 画布的 filter 拆成数值返回。
   mid/high 一律给 0，把这一层和高音闪烁/变色隔离开。 */
function bounceProbe() {
  window.__p = {
    read() {
      const f = bgThreeCanvas.style.filter || '';
      const num = (name) => { const m = f.match(new RegExp(name + '\\(([-0-9.]+)')); return m ? parseFloat(m[1]) : null; };
      return { raw: f, brightness: num('brightness'), saturate: num('saturate'), contrast: num('contrast'), blur: num('blur') };
    },
    // style 为 null 表示把跳动整个关掉
    frame({ style, bass = 0, beatVal = 0, amt = 1 }) {
      bgBounceOn = style !== null;
      if (style) bgBounceStyle = style;
      bgBounceAmt = amt;
      beat = beatVal;
      renderBg3D(bass, 0, 0, 1);
      return window.__p.read();
    }
  };
  document.getElementById('intro')?.classList.add('hidden');
  const rp = document.getElementById('restorePrompt'); if (rp) rp.style.display = 'none';
  freq = new Uint8Array(1024); wave = new Uint8Array(2048);
  analyser = null;              // 别让渲染循环覆盖我们钉住的频段值
  enableBg3D('tunnel');
}

test('低音重击的亮度闪光传到 3D，不再只有缩放', async () => {
  await withApp('bounce3d-1', async (win) => {
    const res = await win.evaluate((p) => {
      eval('(' + p + ')')();
      const F = window.__p.frame;
      return {
        // 参数本身算出来是多少（对照用）
        params: (() => { bgBounceOn = true; bgBounceStyle = 'basspunch'; bgBounceAmt = 1; beat = 1;
                         const q = computeBgBounceParams(1, 0, 0, performance.now());
                         return { scale: +q.scale.toFixed(3), brightness: +q.brightness.toFixed(3) }; })(),
        quiet: F({ style: 'basspunch', bass: 0, beatVal: 0 }),
        punch: F({ style: 'basspunch', bass: 1, beatVal: 1 })
      };
    }, bounceProbe.toString());

    expect(res.params.brightness, 'Bass Punch 本来就该算出一个 >1 的亮度').toBeGreaterThan(1.2);
    expect(res.quiet.brightness).toBeCloseTo(1, 2);
    // 修之前这里永远是 1 —— brightness 被 applyBgBounceToCamera 丢掉了
    expect(res.punch.brightness, `鼓点那一下没有把 3D 提亮（filter="${res.punch.raw}"）`).toBeGreaterThan(1.2);
  });
});

test('虚焦 / 反差 / 饱和 / 暗角 四种在 3D 上都真的起作用', async () => {
  await withApp('bounce3d-2', async (win) => {
    const res = await win.evaluate((p) => {
      eval('(' + p + ')')();
      const F = window.__p.frame;
      return {
        blurQuiet:     F({ style: 'blurpulse',    bass: 0 }),
        blurLoud:      F({ style: 'blurpulse',    bass: 1 }),
        contrastQuiet: F({ style: 'contrastsnap', bass: 0 }),
        contrastLoud:  F({ style: 'contrastsnap', bass: 1 }),
        satQuiet:      F({ style: 'saturate',     bass: 0 }),
        satLoud:       F({ style: 'saturate',     bass: 1 }),
        vigQuiet:      F({ style: 'vignette',     bass: 0 }),
        vigLoud:       F({ style: 'vignette',     bass: 1 })
      };
    }, bounceProbe.toString());

    // 虚焦脉冲：bass=1, amt=1 → blur = 1*1*6 - 0.5 = 5.5px
    expect(res.blurQuiet.blur == null || res.blurQuiet.blur === 0, '安静时就在虚焦').toBe(true);
    expect(res.blurLoud.blur, `虚焦脉冲在 3D 上没有产生模糊（filter="${res.blurLoud.raw}"）`).toBeGreaterThan(3);

    // 反差闪光：bass>0.55 → contrast = 1 + 0.8
    expect(res.contrastQuiet.contrast == null || res.contrastQuiet.contrast === 1).toBe(true);
    expect(res.contrastLoud.contrast, `反差闪光在 3D 上没有产生反差（filter="${res.contrastLoud.raw}"）`).toBeGreaterThan(1.5);

    // 饱和脉冲：saturate = 1 + 0.9
    expect(res.satLoud.saturate, `饱和脉冲在 3D 上没有提高饱和度（filter="${res.satLoud.raw}"）`).toBeGreaterThan(1.5);
    expect(res.satLoud.saturate).toBeGreaterThan(res.satQuiet.saturate || 1);

    // 暗角脉冲：这个是往下压的，brightness 应该 < 1
    expect(res.vigQuiet.brightness).toBeCloseTo(1, 2);
    expect(res.vigLoud.brightness, `暗角脉冲在 3D 上没有压暗（filter="${res.vigLoud.raw}"）`).toBeLessThan(0.95);
  });
});

test('跳动关掉时这些通通不出现', async () => {
  await withApp('bounce3d-3', async (win) => {
    const res = await win.evaluate((p) => {
      eval('(' + p + ')')();
      const F = window.__p.frame;
      // 先用一个很猛的风格把 filter 撑起来，再整个关掉，确认能干净地退回去
      const loud = F({ style: 'blurpulse', bass: 1 });
      const off = F({ style: null, bass: 1 });
      return { loud, off };
    }, bounceProbe.toString());

    expect(res.loud.blur).toBeGreaterThan(3);
    expect(res.off.blur == null || res.off.blur === 0, `跳动关掉了，3D 还在虚焦（filter="${res.off.raw}"）`).toBe(true);
    expect(res.off.brightness).toBeCloseTo(1, 2);
  });
});

test('跟高音闪烁、亮度滑杆、Director 叠在一起而不是互相覆盖', async () => {
  await withApp('bounce3d-4', async (win) => {
    const res = await win.evaluate((p) => {
      eval('(' + p + ')')();
      const R = window.__p.read;

      // 用户把 3D 背景调暗到 50%
      const sl = document.getElementById('bgOpacitySel');
      sl.value = '50'; sl.dispatchEvent(new Event('input', { bubbles: true }));

      bgBounceOn = true; bgBounceStyle = 'basspunch'; bgBounceAmt = 1;

      beat = 0; renderBg3D(0, 0, 0, 1);
      const base = R();                       // 只有滑杆的 50%

      beat = 1; renderBg3D(1, 0, 0, 1);
      const withPunch = R();                  // 滑杆 × 跳动亮度 × 每粒闪光
      const hitAmount = bg3DHit;              // 每粒闪光这一路的当前强度，用来算期望值

      beat = 1; renderBg3D(1, 0, 1, 1);
      const withPunchAndHigh = R();           // 再叠高音闪烁

      // 饱和度：滑杆定的 1.15 要和跳动的 saturate 相乘，不能互相顶掉
      beat = 0; bgBounceStyle = 'saturate';
      renderBg3D(1, 0, 0, 1);
      const satCombined = R();

      return { base, withPunch, withPunchAndHigh, satCombined, hitAmount: +hitAmount.toFixed(4) };
    }, bounceProbe.toString());

    expect(res.base.brightness, '亮度滑杆的 50% 没生效').toBeCloseTo(0.5, 2);
    /* 各路是相乘，不是谁把谁顶掉。这里按各路的实际强度算期望值，而不是钉一个数字上限
       —— 钉数字的话，以后往这个 filter 上再加一路（就像"每一粒砸一下"那次）就会
       假报回归。三路分别是：滑杆 0.5 × Bass Punch 的 1+beat*0.30*amt × 每粒闪光的 1+hit*0.34 */
    const expected = 0.5 * (1 + 1 * 0.30 * 1) * (1 + res.hitAmount * 0.34);
    expect(res.withPunch.brightness, `各路亮度没有相乘（期望约 ${expected.toFixed(3)}）`).toBeCloseTo(expected, 2);
    expect(res.withPunchAndHigh.brightness, '高音闪烁没有再叠上去').toBeGreaterThan(res.withPunch.brightness);
    // 滑杆的 1.15 × 跳动的 1.9 ≈ 2.18
    expect(res.satCombined.saturate, '滑杆饱和度和跳动饱和度没有相乘').toBeGreaterThan(2);
  });
});
