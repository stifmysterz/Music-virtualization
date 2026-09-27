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
