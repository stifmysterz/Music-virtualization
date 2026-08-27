const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');

const APP_DIR = path.join(__dirname, '..');

/* 背景跟鼓点跳动。
 *
 * 背景动画系统本来就有：computeBgBounceParams() 产出一个参数包，DOM 背景
 * （updateBgBounceDom）和 3D 背景相机（applyBgBounceToCamera）共用同一份。
 * 但原有的 10 种风格里，对 bass 的反应都很弱（breathe 只有 bass*0.04），
 * 而且没有任何一种用到 beat —— 也就是 detectBeat() 那个「命中即 1、之后每帧
 * ×0.9 衰减」的鼓点瞬态。所以背景只会慢慢呼吸，不会跟着鼓点砸。
 *
 * 新增三种吃 beat 的风格：basspunch / bassshake / basszoom。
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

const NEW_STYLES = ['basspunch', 'bassshake', 'basszoom'];

test('三种新风格都出现在选单里，且中英文都有名字', async () => {
  await withApp('bounce-1', async (win) => {
    const res = await win.evaluate((styles) => {
      const sel = document.getElementById('bgBounceStyleSel');
      const values = [...sel.options].map(o => o.value);
      return {
        values,
        en: styles.map(s => BG_BOUNCE_STYLE_NAMES.en[s]),
        zh: styles.map(s => BG_BOUNCE_STYLE_NAMES.zh[s])
      };
    }, NEW_STYLES);

    NEW_STYLES.forEach(s => expect(res.values).toContain(s));
    res.en.forEach(n => expect(typeof n === 'string' && n.length > 0).toBe(true));
    res.zh.forEach(n => expect(typeof n === 'string' && n.length > 0).toBe(true));
  });
});

test('新风格真的吃 beat：鼓点命中和不命中差别明显', async () => {
  await withApp('bounce-2', async (win) => {
    const res = await win.evaluate((styles) => {
      bgBounceOn = true;
      bgBounceAmt = 1;
      const out = {};
      styles.forEach(style => {
        bgBounceStyle = style;
        beat = 1;                                        // 鼓点命中
        const hit = computeBgBounceParams(0.5, 0.3, 0.3, 0);
        beat = 0;                                        // 完全没鼓点
        const rest = computeBgBounceParams(0.5, 0.3, 0.3, 0);
        out[style] = {
          hitScale: hit.scale, restScale: rest.scale,
          hitBright: hit.brightness,
          hitOff: Math.hypot(hit.offX, hit.offY), restOff: Math.hypot(rest.offX, rest.offY),
          hitBlur: hit.blur
        };
      });

      // 对照：现有里对 bass 最敏感的 breathe，看看原来有多弱
      bgBounceStyle = 'breathe';
      beat = 1;  const bHit = computeBgBounceParams(0.5, 0.3, 0.3, 0);
      beat = 0;  const bRest = computeBgBounceParams(0.5, 0.3, 0.3, 0);
      out.breatheDelta = Math.abs(bHit.scale - bRest.scale);
      return out;
    }, NEW_STYLES);

    // 现有风格对 beat 完全无感 —— 这正是「不够跳」的原因
    expect(res.breatheDelta).toBeCloseTo(0, 6);

    // basspunch：鼓点上明显放大 + 提亮
    expect(res.basspunch.hitScale - res.basspunch.restScale).toBeGreaterThan(0.1);
    expect(res.basspunch.hitBright).toBeGreaterThan(1.15);

    // bassshake：鼓点上产生位移，没鼓点时不动
    expect(res.bassshake.hitOff).toBeGreaterThan(5);
    expect(res.bassshake.restOff).toBeCloseTo(0, 6);

    // basszoom：猛推镜头 + 带一点动态模糊
    expect(res.basszoom.hitScale - res.basszoom.restScale).toBeGreaterThan(0.25);
    expect(res.basszoom.hitBlur).toBeGreaterThan(1);
  });
});

test('关掉 Bounce 时新风格不产生任何效果', async () => {
  await withApp('bounce-3', async (win) => {
    const res = await win.evaluate((styles) => {
      bgBounceOn = false;
      bgBounceAmt = 1;
      beat = 1;
      return styles.map(style => {
        bgBounceStyle = style;
        const p = computeBgBounceParams(1, 1, 1, 0);
        return { scale: p.scale, offX: p.offX, brightness: p.brightness, blur: p.blur };
      });
    }, NEW_STYLES);

    res.forEach(p => {
      expect(p.scale).toBe(1);
      expect(p.offX).toBe(0);
      expect(p.brightness).toBe(1);
      expect(p.blur).toBe(0);
    });
  });
});

test('照片背景和 3D 背景相机都吃到同一份跳动参数', async () => {
  await withApp('bounce-4', async (win) => {
    const res = await win.evaluate(() => {
      // 装一张背景图并打开跳动
      const el = document.getElementById('bgImage');
      const c = document.createElement('canvas'); c.width = c.height = 64;
      c.getContext('2d').fillRect(0, 0, 64, 64);
      el.src = c.toDataURL(); el.style.display = 'block';
      hasBgMedia = true; hasBgVideo = false;
      bgBounceOn = true; bgBounceAmt = 1; bgBounceStyle = 'basspunch';

      beat = 1;
      updateBgBounceDom(0.5, 0.3, 0.3, 0);
      const domHit = el.style.transform;
      const mHit = /scale\(([\d.]+)\)/.exec(domHit);

      beat = 0;
      updateBgBounceDom(0.5, 0.3, 0.3, 0);
      const mRest = /scale\(([\d.]+)\)/.exec(el.style.transform);

      // 3D 那侧：applyBgBounceToCamera 把 scale 写进 camera.zoom
      const fakeCam = { position: { x: 0, y: 0 }, rotation: { z: 0 }, zoom: 1, userData: {}, updateProjectionMatrix() {} };
      beat = 1;
      applyBgBounceToCamera(fakeCam, computeBgBounceParams(0.5, 0.3, 0.3, 0));
      const camHit = fakeCam.zoom;
      beat = 0;
      applyBgBounceToCamera(fakeCam, computeBgBounceParams(0.5, 0.3, 0.3, 0));
      const camRest = fakeCam.zoom;

      return {
        domHit: mHit ? parseFloat(mHit[1]) : null,
        domRest: mRest ? parseFloat(mRest[1]) : null,
        camHit, camRest
      };
    });

    expect(res.domHit).not.toBeNull();
    expect(res.domHit - res.domRest).toBeGreaterThan(0.1);   // 照片背景跟着砸
    expect(res.camHit - res.camRest).toBeGreaterThan(0.1);   // 3D 背景相机也跟着砸
  });
});
