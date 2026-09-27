const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const APP_DIR = path.join(__dirname, '..');

/* CLAUDE.md §13:动画按时间走,不按帧数走。dt 的单位是「60 fps 下的一帧」:60 fps 时 dt = 1,
 * 30 fps 时 dt = 2。同样过去 1/30 秒,60 fps 跑两次 dt = 1、30 fps 跑一次 dt = 2,结果要一样 ——
 * 写成 `x += (目标 - x) * 0.12`、`x *= 0.85` 的话,30 fps 下只追一半、只衰减一半,
 * 录 30 fps 的片子和现场 60 fps 看到的反应快慢不一样。 */

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => document.getElementById('intro')?.classList.add('hidden'));
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
}

test('VJ 灯光跟着音频渐变:60 fps 和 30 fps 下同样时间追到同样的亮度', async () => {
  await withApp('fps-lights', async win => {
    const r = await win.evaluate(() => {
      const lightsAfter = (kind, steps, dt) => {
        vjDropCachedScene(kind); seedBg3DBuilds(0x5EED); vjSpeedBassSmooth = 0;
        enableBg3D(kind);
        const s = bg3DScenes[kind], dirs = [];
        s.scene.traverse(o => { if (o.isDirectionalLight) dirs.push(o); });
        for (let i = 0; i < steps; i++) s.update(0.8, 0.5, 0.9, dt);
        return dirs.map(l => l.intensity);
      };
      const out = {};
      for (const kind of ['vjLiquidGrid', 'vjChromeFlow', 'vjEventHorizon']) {
        const a = lightsAfter(kind, 6, 1), b = lightsAfter(kind, 3, 2);
        out[kind] = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
      }
      return out;
    });
    for (const [kind, diff] of Object.entries(r)) expect(diff, `${kind}: 灯光渐变跟帧率走`).toBeLessThan(1e-6);
  });
});

test('3D 镜头抖动和 Auto Director 的 Drop 冲击:衰减速度跟帧率无关', async () => {
  await withApp('fps-decay', async win => {
    const r = await win.evaluate(() => {
      beat = 0;
      const prevMotion = bg3DCameraMotion;
      bg3DCameraMotion = 'shake';
      const shake = (steps, dt) => {
        const cam = new THREE.PerspectiveCamera();
        applyBg3DCameraMotion(cam, 0, 0, 0, 1);   // 第一次调用初始化 userData
        cam.userData.shakeAmt = 1;
        for (let i = 0; i < steps; i++) applyBg3DCameraMotion(cam, 0, 0, 0, dt);
        return cam.userData.shakeAmt;
      };
      const shakeDiff = Math.abs(shake(4, 1) - shake(2, 2));
      bg3DCameraMotion = prevMotion;

      enableBg3D('synthwave');
      const prevDir = bg3DDirectorOn;
      bg3DDirectorOn = true;
      const punch = (steps, dt) => {
        dirDropPunch = 1;
        for (let i = 0; i < steps; i++) renderBg3D(0, 0, 0, dt);
        return dirDropPunch;
      };
      const punchDiff = Math.abs(punch(4, 1) - punch(2, 2));
      bg3DDirectorOn = prevDir; dirDropPunch = 0;
      return { shakeDiff, punchDiff };
    });
    expect(r.shakeDiff, '镜头抖动的衰减跟帧率走').toBeLessThan(1e-6);
    expect(r.punchDiff, 'Drop 冲击的衰减跟帧率走').toBeLessThan(1e-6);
  });
});

test('2D Neon / Particle Storm 粒子的速度阻尼:60 fps 和 30 fps 下同样时间衰减一样多', async () => {
  await withApp('fps-2d-damping', async win => {
    const r = await win.evaluate(() => {
      // Neon:只看阻尼,把加速度的相位固定成 0(wobSp = 0,cos(π/2) ≈ 0)
      const neon = (steps, dt) => {
        const p = { x: 100, y: 100, vx: 5, vy: 0, wob: Math.PI / 2, wobSp: 0, life: 1, size: 2, hue: 200 };
        for (let i = 0; i < steps; i++) drawNeon(p, dt);
        return p.vx;
      };
      const neonDiff = Math.abs(neon(10, 1) - neon(5, 2)) / Math.abs(neon(10, 1));
      // Storm:放一颗粒子进去,关掉新粒子的生成(bass/mid 为 0 时仍会每帧补 1 颗 —— 只看我们这颗)
      const storm = (steps, dt) => {
        stormParticles.length = 0; stormCd = 1e9;
        const p = { x: 100, y: 100, vx: 5, vy: 0, life: 1, size: 2, hue: 200, seed: 0 };
        stormParticles.push(p);
        for (let i = 0; i < steps; i++) drawParticleStorm(0, 0, 0, dt);
        return p.vx;
      };
      const stormDiff = Math.abs(storm(10, 1) - storm(5, 2)) / Math.abs(storm(10, 1));
      stormParticles.length = 0;
      return { neonDiff, stormDiff };
    });
    expect(r.neonDiff, 'Neon 粒子阻尼跟帧率走').toBeLessThan(1e-3);
    expect(r.stormDiff, 'Particle Storm 粒子阻尼跟帧率走').toBeLessThan(1e-3);
  });
});

/* 在页面里把 2D 效果画到一张小画布上、用人为的 now / dt 跑，Math.random 换成带种子的。
   会被 toString() 送进页面，不能引用模块作用域。 */
function install2DSim() {
  // 只测生成和运动的逻辑，不真的画：画布换成什么都不做的假 context（跑 10 秒上万颗粒子，真画太慢）
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const fakeCtx = new Proxy({ canvas: { width: 480, height: 270 } }, {
    get: (t, k) => k in t ? t[k] : /^create\w*Gradient$|^createPattern$/.test(k) ? () => gradient : k === 'measureText' ? () => ({ width: 0 }) : noop,
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const saved = { g2, W, H, CX, CY, DPR, fxOffX, fxOffY, random: Math.random, freq, wave };
  g2 = fakeCtx; W = 480; H = 270; CX = 240; CY = 135; DPR = 1; fxOffX = 0; fxOffY = 0;
  freq = new Uint8Array(1024).fill(200); wave = new Uint8Array(2048).fill(128);
  window.__seed = (s) => {
    let seed = s;
    Math.random = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  };
  window.__restore2DSim = () => { ({ g2, W, H, CX, CY, DPR, fxOffX, fxOffY, freq, wave } = saved); Math.random = saved.random; };
  // 同样 seconds 秒，按 dt（60fps 帧为单位）一帧一帧跑 step(now, dt)
  window.__runFor = (seconds, dt, step) => { let now = 0; const frames = Math.round(seconds * 60 / dt); for (let f = 0; f < frames; f++) { now += 16.7 * dt; step(now, dt); } };
  // 数一段时间里往 arr 里生了几个（包一层 push）
  window.__births = (arr, run) => { let n = 0; const orig = arr.push; arr.push = function (...a) { n += a.length; return orig.apply(this, a); }; try { run(); } finally { delete arr.push; } return n; };
}

test('2D 按帧生成的粒子：同样 10 秒，30 / 60 / 120 fps 生出来的个数一样', async () => {
  test.setTimeout(120000);
  await withApp('fps-2d-spawn', async win => {
    const r = await win.evaluate((install) => {
      eval('(' + install + ')')();
      try {
        // [数组, 每帧怎么画, 跑几个种子]。按帧掷骰子的效果随机性大，多跑几个种子加起来比
        const cases = {
          pondRipples:     [pondRipples,       (now, dt) => drawPondRipples(0.5, dt), 3],
          wakeTrail:       [wakeRipples,       (now, dt) => drawWakeTrail(0.5, dt), 3],
          solarFlare:      [flareJets,         (now, dt) => drawSolarFlare(0.5, 0.5, now, dt), 3],
          radarDome:       [radarBlips,        (now, dt) => drawRadarDome(0.5, dt), 2],
          hourglass:       [hourglassGrains,   (now, dt) => drawHourglass(0.5, dt), 2],
          driftSmoke:      [driftSmoke,        (now, dt) => drawDriftSmoke(0.5, dt), 2],
          pianoFall:       [pianoBlocks,       (now, dt) => drawPianoFall(0.5, dt), 1],
          paddleSplash:    [splashDrops,       (now, dt) => drawPaddleSplash(0.5, dt), 1],
          fountain3d:      [fwFountain3dParts, (now, dt) => drawFireworkFountain3D(0.5, dt), 1],
          particleStorm:   [stormParticles,    (now, dt) => drawParticleStorm(0.2, 0, 0, dt), 1],
          fireworkCrackle: [fwCrackleParts,    (now, dt) => drawFireworkCrackle(0.5, dt), 2],
          // 冷却 14-bass*12 = 2.5 帧：原来 60fps 是 3 帧一颗，30fps 要凑成 2 个 33ms，变成 4 帧一颗
          meteorShower:    [meteors,           (now, dt) => drawMeteorShower(11.5 / 12, dt), 1],
        };
        const out = {};
        for (const [name, [arr, step, seeds]] of Object.entries(cases)) {
          const res = {};
          for (const [label, dt] of [['60', 1], ['30', 2], ['120', 0.5]]) {
            let total = 0;
            for (let s = 1; s <= seeds; s++) {
              window.__seed(s * 7919); arr.length = 0;
              total += window.__births(arr, () => window.__runFor(10, dt, step));
            }
            res[label] = total; arr.length = 0;
          }
          out[name] = res;
        }
        return out;
      } finally { window.__restore2DSim(); }
    }, install2DSim.toString());

    for (const [name, n] of Object.entries(r)) {
      expect(n['60'], `${name}: 60fps 下应该有粒子生出来`).toBeGreaterThan(20);
      // 原来按帧生：30fps 只有一半、120fps 多一倍。允许 15% 的随机差
      expect(n['30'] / n['60'], `${name}: 30fps 生的个数（${n['30']} vs 60fps ${n['60']}）`).toBeGreaterThan(0.85);
      expect(n['30'] / n['60'], `${name}: 30fps 生的个数（${n['30']} vs 60fps ${n['60']}）`).toBeLessThan(1.15);
      expect(n['120'] / n['60'], `${name}: 120fps 生的个数（${n['120']} vs 60fps ${n['60']}）`).toBeGreaterThan(0.85);
      expect(n['120'] / n['60'], `${name}: 120fps 生的个数（${n['120']} vs 60fps ${n['60']}）`).toBeLessThan(1.15);
    }
  });
});

test('2D 连续喷射：30fps 下一帧生的两批要错开，不能叠成一坨', async () => {
  await withApp('fps-2d-emit', async win => {
    const r = await win.evaluate((install) => {
      eval('(' + install + ')')();
      try {
        // 喷泉：看新生粒子的寿命有几种（寿命跟着走过的帧数扣）。30fps 一帧两批，
        // 应该有两种（晚的那批往回退了一帧），不是全叠在同一处
        window.__seed(1); fwFountain3dParts.length = 0;
        drawFireworkFountain3D(0.5, 2);
        const lives30 = new Set(fwFountain3dParts.map(p => p.life.toFixed(4)));
        // 30fps 一帧里：早的那批走了 2 帧、晚的那批走了 1 帧 —— 跟 60fps 连着两帧画出来的一样
        window.__seed(1); fwFountain3dParts.length = 0;
        drawFireworkFountain3D(0.5, 1); drawFireworkFountain3D(0.5, 1);
        const lives60 = [...new Set(fwFountain3dParts.map(p => p.life.toFixed(4)))].sort();
        fwFountain3dParts.length = 0;
        return { batches30: lives30.size, lives30: [...lives30].sort(), lives60 };
      } finally { window.__restore2DSim(); }
    }, install2DSim.toString());
    expect(r.batches30).toBe(2);
    expect(r.lives30).toEqual(r.lives60);
  });
});

test('logo 和文字的 spin / orbit：转速跟帧率无关，「Behind FX」的文字也不会转两倍快', async () => {
  await withApp('fps-spin', async win => {
    const r = await win.evaluate(() => {
      // 文字：两帧 dt=1 和一帧 dt=2 转的角度一样
      const saved = JSON.parse(JSON.stringify(textBounce.titleDisplay || null));
      textBounce.titleDisplay = { on: true, style: 'spin', amt: 1 };
      textSpinAngle.titleDisplay = 0; advanceTextSpin(0.5, 1); advanceTextSpin(0.5, 1);
      const two60 = textSpinAngle.titleDisplay;
      textSpinAngle.titleDisplay = 0; advanceTextSpin(0.5, 2);
      const one30 = textSpinAngle.titleDisplay;
      // 算参数只读角度：画到画布上一次、更新 DOM 一次，角度不能被推两次
      textSpinAngle.titleDisplay = 1.25;
      const a = computeTextBounceParams('titleDisplay', 0.5).extraRot;
      const b = computeTextBounceParams('titleDisplay', 0.5).extraRot;
      textBounce.titleDisplay = saved; textSpinAngle.titleDisplay = 0;

      // logo
      const img = document.createElement('canvas'); img.width = img.height = 8;
      const prev = { logoImg, logoVisible, logoBounceOn, logoBounceStyle, logoBounceAmt, logoSpinAngle, g2 };
      logoImg = img; logoVisible = true; logoBounceOn = true; logoBounceStyle = 'spin'; logoBounceAmt = 1;
      g2 = document.createElement('canvas').getContext('2d');
      logoSpinAngle = 0; drawLogo(0.5, 1); drawLogo(0.5, 1); const logo60 = logoSpinAngle;
      logoSpinAngle = 0; drawLogo(0.5, 2); const logo30 = logoSpinAngle;
      ({ logoImg, logoVisible, logoBounceOn, logoBounceStyle, logoBounceAmt, logoSpinAngle, g2 } = prev);
      return { two60, one30, a, b, logo60, logo30 };
    });
    expect(r.two60).toBeGreaterThan(0);
    expect(Math.abs(r.two60 - r.one30)).toBeLessThan(1e-9);
    expect(r.a).toBe(1.25);
    expect(r.b).toBe(1.25);
    expect(r.logo60).toBeGreaterThan(0);
    expect(Math.abs(r.logo60 - r.logo30)).toBeLessThan(1e-9);
  });
});

test('瀑布、拖尾、特效层淡出：按时间走，不按帧数走', async () => {
  await withApp('fps-2d-time', async win => {
    const r = await win.evaluate((install) => {
      eval('(' + install + ')')();
      try {
        // Bar Waterfall：1 秒里加的行数（每 50ms 一行 → 20 行）
        const rows = dt => { barWaterfallHist.length = 0; window.__runFor(1, dt, (now, d) => drawBarWaterfall(0.5, 100000 + now, d)); return barWaterfallHist.length; };
        const rows60 = rows(1), rows30 = rows(2);
        barWaterfallHist.length = 0;
        // Light Trails：拖尾覆盖的时间长度
        const span = dt => {
          ensureTrailOrbs(); trailOrbs.forEach(o => { o.trail.length = 0; o.trailSpan = 0; });
          window.__runFor(2, dt, (now, d) => drawLightTrails(0.5, 0.5, 100000 + now, d));
          const o = trailOrbs[0]; return o.trail[o.trail.length - 1].t - o.trail[0].t;
        };
        const span60 = span(1), span30 = span(2);
        // 时间倒退（模式缩略图用自己的时钟先跑过）：拖尾里不能留下比现在还「新」的点
        drawLightTrails(0.5, 0.5, 50000, 1);
        const futurePoints = trailOrbs.reduce((n, o) => n + o.trail.filter(p => p.t > 50000).length, 0);
        // 全局淡出：两帧 dt=1 剩下的，跟一帧 dt=2 剩下的一样
        const alpha = dt => +trailFadeStyle(dt).match(/,([\d.]+)\)$/)[1];
        return { rows60, rows30, span60, span30, futurePoints, keep60: (1 - alpha(1)) ** 2, keep30: 1 - alpha(2), a60: alpha(1) };
      } finally { window.__restore2DSim(); }
    }, install2DSim.toString());
    expect(r.rows60).toBeGreaterThanOrEqual(19);
    expect(Math.abs(r.rows60 - r.rows30), `瀑布每秒的行数：60fps ${r.rows60}、30fps ${r.rows30}`).toBeLessThanOrEqual(1);
    expect(r.span60).toBeGreaterThan(100);
    expect(Math.abs(r.span60 - r.span30), `拖尾长度（ms）：60fps ${r.span60}、30fps ${r.span30}`).toBeLessThanOrEqual(34);
    expect(r.futurePoints, '时间倒退后拖尾里还留着「未来」的点').toBe(0);
    expect(r.a60).toBeCloseTo(0.16, 4);   // 60fps 下跟原来一样
    expect(Math.abs(r.keep60 - r.keep30)).toBeLessThan(1e-3);
  });
});
