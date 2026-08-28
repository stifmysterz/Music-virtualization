const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 3D 背景要跟高/中/低音一起动。
 *
 * 实测过 119 个 3D 风格的 update(bass, mid, high, dt) 分别引用了哪几个频段：
 *     完全不看音频            0 个
 *     只看 bass，mid/high 全扔  93 个（78%）
 *     没用到 mid              94 个
 *     没用到 high            114 个（96%）
 *     三个频段都用到            4 个
 * mid/high 每帧都算好、每帧都传进去，然后被 93 个风格直接扔掉。
 * 而且连 bass 也常常很轻 —— 27 个风格只碰一次，例如樱花是
 *     arr[i*3+1] -= (0.03 + fall[i]*0.06 + bass*0.05)*dt
 * 低音拉满只是花瓣飘快一点，不是跳动。
 *
 * 唯一对所有风格都生效的那一层只有 bass/beat：
 *     camera.zoom *= 1 + beat*0.16 + bass*0.15 + dirDropPunch*0.6
 * （实测确实生效，zoom 1 → 1.198），但表现形式只有"整体缩放"一种，且没有 mid/high。
 *
 * 所以在这一层补上，一处改动覆盖全部 119 个，完全不动风格内部逻辑：
 *     中音 → 摇摆（摄影机滚转 + 横向摆动）
 *     高音 → 闪烁（亮度快速起伏）
 *     中+高 → 变色（色相偏移）
 *
 * 顺带修一个既有冲突：bgThreeCanvas.style.filter 原来有三个写入者互相覆盖 ——
 * 背景亮度滑杆写一次，Director 每帧写一次，Director 关掉时又清空一次。
 * 结果开一下 Director 就把你设的 3D 亮度冲掉了。现在这个 filter 只有一个出口。
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

/* 装一个音量可控的假音频源，并把 3D 打开。level: 0 = 安静，1 = 满。
   返回一组工具函数，供各个测试在页面里用。 */
function harness() {
  window.__t = {
    level: 0,
    setLevel(v) { window.__t.level = v; },
    frames(n) { return new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }); },
    // 从 style.filter 里抠出某个函数的数值，例如 brightness(1.23) -> 1.23
    filterVal(name) {
      const m = (bgThreeCanvas.style.filter || '').match(new RegExp(name + '\\(([-0-9.]+)'));
      return m ? parseFloat(m[1]) : null;
    },
    // 连采 n 帧，返回 [最小值, 最大值, 峰峰值]
    async range(read, n) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) { await window.__t.frames(1); const v = read(); if (v == null) continue; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      return { lo: +lo.toFixed(4), hi: +hi.toFixed(4), pp: +(hi - lo).toFixed(4) };
    }
  };
  document.getElementById('intro')?.classList.add('hidden');
  const rp = document.getElementById('restorePrompt'); if (rp) rp.style.display = 'none';
  freq = new Uint8Array(1024); wave = new Uint8Array(2048);
  analyser = {
    frequencyBinCount: freq.length, fftSize: wave.length,
    getByteFrequencyData(a) { const L = window.__t.level; for (let i = 0; i < a.length; i++) a[i] = Math.round(L * (200 - (i % 60))); },
    getByteTimeDomainData(a) { const L = window.__t.level; for (let i = 0; i < a.length; i++) a[i] = 128 + Math.round(Math.sin(i * 0.1) * 100 * L); }
  };
}

test('中音驱动摇摆：摄影机随中音摆动，安静时几乎不摆', async () => {
  await withApp('bg3dreact-1', async (win) => {
    const res = await win.evaluate(async (h) => {
      eval('(' + h + ')')();
      const T = window.__t;
      enableBg3D('tunnel');            // 一个自己完全不看 mid/high 的风格
      await T.frames(10);

      // 直接控制频段值，绕开 detectBeat 的门槛，测的是这一层本身
      const measure = async (mid) => {
        const saved = analyser;
        analyser = null;               // 让 draw() 不再覆盖 lastMid/lastHigh
        lastBass = 0; lastMid = mid; lastHigh = 0; beat = 0;
        // draw() 在 analyser 为 null 时不会调 renderBg3D 的音频参数，所以自己驱动
        let lo = Infinity, hi = -Infinity, loX = Infinity, hiX = -Infinity;
        const s = bg3DScenes[bg3DKind];
        // 摇摆是两个正弦叠加（周期约 3 秒和 4.8 秒），取样窗口必须盖住慢的那个，
        // 否则量到的峰峰值取决于起始相位，测试会随机地宽或严
        for (let i = 0; i < 200; i++) {
          renderBg3D(0, mid, 0, 1);
          lo = Math.min(lo, s.camera.rotation.z); hi = Math.max(hi, s.camera.rotation.z);
          loX = Math.min(loX, s.camera.position.x); hiX = Math.max(hiX, s.camera.position.x);
          await T.frames(1);
        }
        analyser = saved;
        return { rollPP: +(hi - lo).toFixed(5), xPP: +(hiX - loX).toFixed(5) };
      };

      const quiet = await measure(0);
      const loud = await measure(1);
      disableBg3D();
      return { quiet, loud };
    }, harness.toString());

    // 安静时基本不该摆
    expect(res.quiet.rollPP, `安静时摄影机就在滚转: ${res.quiet.rollPP}`).toBeLessThan(0.005);
    // 中音拉满时要摆得看得出来（0.10 rad ≈ 5.7°的峰峰值，取样已盖住慢周期，属于保守下限）
    expect(res.loud.rollPP, `中音拉满，摄影机滚转峰峰值只有 ${res.loud.rollPP} rad`).toBeGreaterThan(0.10);
    expect(res.loud.xPP, `中音拉满，摄影机横向完全不动`).toBeGreaterThan(0.1);
  });
});

test('高音驱动闪烁：亮度随高音快速起伏，安静时是稳的', async () => {
  await withApp('bg3dreact-2', async (win) => {
    const res = await win.evaluate(async (h) => {
      eval('(' + h + ')')();
      const T = window.__t;
      enableBg3D('tunnel');
      await T.frames(10);

      const measure = async (high) => {
        const saved = analyser; analyser = null;
        beat = 0;
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < 60; i++) {
          renderBg3D(0, 0, high, 1);
          const b = T.filterVal('brightness');
          if (b != null) { lo = Math.min(lo, b); hi = Math.max(hi, b); }
          await T.frames(1);
        }
        analyser = saved;
        return { lo: +lo.toFixed(4), hi: +hi.toFixed(4), pp: +(hi - lo).toFixed(4) };
      };

      const quiet = await measure(0);
      const loud = await measure(1);
      const filterWhenLoud = bgThreeCanvas.style.filter;
      disableBg3D();
      return { quiet, loud, filterWhenLoud };
    }, harness.toString());

    expect(res.quiet.pp, `安静时亮度就在闪: ${res.quiet.pp}`).toBeLessThan(0.02);
    expect(res.loud.pp, `高音拉满，亮度峰峰值只有 ${res.loud.pp}（filter="${res.filterWhenLoud}"）`).toBeGreaterThan(0.12);
    expect(res.loud.hi, '高音应该把画面提亮，不是压暗').toBeGreaterThan(res.quiet.hi);
  });
});

test('中高音驱动变色：色相随音量偏移，安静时不偏', async () => {
  await withApp('bg3dreact-3', async (win) => {
    const res = await win.evaluate(async (h) => {
      eval('(' + h + ')')();
      const T = window.__t;
      enableBg3D('tunnel');
      await T.frames(10);

      const measure = async (mid, high) => {
        const saved = analyser; analyser = null;
        beat = 0;
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < 60; i++) {
          renderBg3D(0, mid, high, 1);
          const v = T.filterVal('hue-rotate');
          if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
          await T.frames(1);
        }
        analyser = saved;
        return { lo: +lo.toFixed(3), hi: +hi.toFixed(3), maxAbs: +Math.max(Math.abs(lo), Math.abs(hi)).toFixed(3) };
      };

      const quiet = await measure(0, 0);
      const loud = await measure(1, 1);
      disableBg3D();
      return { quiet, loud };
    }, harness.toString());

    expect(res.quiet.maxAbs, `安静时色相就在偏: ${res.quiet.maxAbs}°`).toBeLessThan(1);
    expect(res.loud.maxAbs, `中高音拉满，色相只偏了 ${res.loud.maxAbs}°`).toBeGreaterThan(10);
  });
});

test('这一层跟风格无关：每个风格拿到的摇摆/闪烁/变色完全一样', async () => {
  await withApp('bg3dreact-4', async (win) => {
    const res = await win.evaluate(async (h) => {
      eval('(' + h + ')')();
      const T = window.__t;
      // 都是实测里"只看 bass，mid/high 完全不碰"的风格 —— 它们自己不会产生任何中高音反应
      const kinds = ['tunnel', 'cherryBlossom', 'matrixDataRain', 'waveformRings', 'snowfallDrift', 'kaleidoscope'];
      for (const k of kinds) { enableBg3D(k); await T.frames(4); }   // 先都建好，别把建场景的耗时算进来

      /* 关键：在同一瞬间把所有风格各渲一次。这一层只按 mid/high 和当前时间算，跟风格无关，
         所以量到的值必须完全一致 —— 这比"各自取一段时间窗口再比幅度"可靠得多：
         摇摆是秒级周期的正弦，短窗口量到多少取决于起始相位，会让测试随机地宽或严。 */
      const saved = analyser; analyser = null;
      beat = 0;
      const out = [];
      for (const kind of kinds) {
        enableBg3D(kind);
        const s = bg3DScenes[kind];
        renderBg3D(0, 0, 0, 1);
        const r0 = s.camera.rotation.z, x0 = s.camera.position.x;
        const b0 = T.filterVal('brightness'), h0 = T.filterVal('hue-rotate');
        renderBg3D(0, 1, 1, 1);
        out.push({
          kind,
          rollDelta: +(s.camera.rotation.z - r0).toFixed(6),
          xDelta: +(s.camera.position.x - x0).toFixed(6),
          brightDelta: +(T.filterVal('brightness') - b0).toFixed(6),
          hueDelta: +(T.filterVal('hue-rotate') - h0).toFixed(4)
        });
      }
      analyser = saved;
      disableBg3D();
      return out;
    }, harness.toString());

    const spread = (key) => Math.max(...res.map(r => r[key])) - Math.min(...res.map(r => r[key]));
    /* 容差按「物理上限」给，不能按瞬时幅度的比例：
       六次渲染是真的在跑 WebGL，中间会流逝十几毫秒，而这一层是时间的正弦函数，
       所以各风格之间必然有一点漂移。漂移量的上界 = 幅度 × 角频率 × 流逝时间，
       跟当时摆到哪里无关：摇摆 0.10 rad × 0.0040 rad/ms × 20ms = 0.008。
       早先按「相对瞬时幅度」给容差会偶发失败 —— 采样正好落在过零附近时瞬时幅度只有
       0.014，同样的绝对漂移换算成相对值就超标了。 */
    expect(spread('rollDelta'),
      '各风格拿到的摇摆量不一致: ' + JSON.stringify(res.map(r => [r.kind, r.rollDelta]))).toBeLessThan(0.008);
    // 色相的慢漂移：46×0.35 度 × 0.0011 rad/ms × 20ms ≈ 0.35 度，留一倍余量
    expect(spread('hueDelta'), '各风格拿到的变色量不一致').toBeLessThan(0.8);
    // 而且都必须真的不是 0 —— 变色和闪烁跟相位无关，随时都该有
    for (const r of res) {
      expect(Math.abs(r.hueDelta), `${r.kind}: 没有变色`).toBeGreaterThan(10);
      expect(r.brightDelta, `${r.kind}: 高音没有把画面提亮`).toBeGreaterThan(0);
      expect(r.xDelta !== 0 || r.rollDelta !== 0, `${r.kind}: 摄影机完全没被摇到`).toBe(true);
    }
  });
});

test('原有的低音缩放脉冲没有被破坏', async () => {
  await withApp('bg3dreact-5', async (win) => {
    const res = await win.evaluate(async (h) => {
      eval('(' + h + ')')();
      const T = window.__t;
      enableBg3D('tunnel');
      await T.frames(10);
      const saved = analyser; analyser = null;
      const s = bg3DScenes[bg3DKind];
      beat = 0; renderBg3D(0, 0, 0, 1);
      const zoomQuiet = +s.camera.zoom.toFixed(4);
      beat = 0; renderBg3D(1, 0, 0, 1);
      const zoomLoudBass = +s.camera.zoom.toFixed(4);
      beat = 1; renderBg3D(1, 0, 0, 1);
      const zoomWithBeat = +s.camera.zoom.toFixed(4);
      analyser = saved;
      disableBg3D();
      return { zoomQuiet, zoomLoudBass, zoomWithBeat };
    }, harness.toString());

    expect(res.zoomQuiet).toBeCloseTo(1, 2);
    expect(res.zoomLoudBass, '低音不再推缩放了').toBeGreaterThan(1.1);
    expect(res.zoomWithBeat, '鼓点没有额外的爆点').toBeGreaterThan(res.zoomLoudBass);
  });
});

test('背景亮度滑杆的设置不再被每帧覆盖，Director 也冲不掉它', async () => {
  await withApp('bg3dreact-6', async (win) => {
    const res = await win.evaluate(async (h) => {
      eval('(' + h + ')')();
      const T = window.__t;
      enableBg3D('tunnel');
      await T.frames(6);

      // 用户把 3D 背景调暗到 40%
      const sl = document.getElementById('bgOpacitySel');
      sl.value = '40'; sl.dispatchEvent(new Event('input', { bubbles: true }));
      await T.frames(4);
      const saved = analyser; analyser = null;
      beat = 0;
      renderBg3D(0, 0, 0, 1);          // 安静：亮度应该就是滑杆设的那个基准
      const afterFrame = T.filterVal('brightness');

      // 开 Director —— 原来这里会把 filter 整个改写成 brightness(1+punch)，把 40% 冲掉
      document.getElementById('bg3DDirectorBtn').click();
      renderBg3D(0, 0, 0, 1);
      const withDirector = T.filterVal('brightness');
      document.getElementById('bg3DDirectorBtn').click();   // 关掉，原来这里会写成空字符串
      renderBg3D(0, 0, 0, 1);
      const afterDirectorOff = T.filterVal('brightness');
      analyser = saved;

      disableBg3D();
      const afterDisable = bgThreeCanvas.style.filter;
      return { afterFrame, withDirector, afterDirectorOff, afterDisable };
    }, harness.toString());

    // 滑杆 40% 就是 0.4 的基准亮度，安静时不该被抬高或抹掉
    expect(res.afterFrame, '每帧的 filter 把亮度滑杆的设置冲掉了').toBeCloseTo(0.4, 2);
    expect(res.withDirector, '开 Director 把亮度滑杆的设置冲掉了').toBeCloseTo(0.4, 2);
    expect(res.afterDirectorOff, '关 Director 把亮度滑杆的设置抹成空了').toBeCloseTo(0.4, 2);
    // 3D 关掉之后不该在画布上留着最后一帧的滤镜
    expect(res.afterDisable, '关掉 3D 之后 filter 没清干净').toBe('');
  });
});
