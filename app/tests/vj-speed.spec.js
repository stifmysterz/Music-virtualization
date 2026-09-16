const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 守的是「50 个 VJ 的默认速度确实降低了，滑杆低速端也真的有用」，以及降速之后
   循环/运动方向没被破坏——不是重新验证每个效果的构图（vj-tunnels.spec.js 已经在
   守那个），这里只挑一个代表性效果做循环/方向检查，避免和那个文件重复跑 50 遍。 */

async function launch(label) {
  const dir = newUserDataDir(label);
  const app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
  const win = await app.firstWindow();
  await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
  await win.evaluate(() => document.getElementById('intro')?.classList.add('hidden'));
  return { app, win, dir };
}

test('vjSpeed() 默认基准比旧的 0.9/3.2 常数慢，且滑杆能调到明显更慢的低速端', async () => {
  const { app, win, dir } = await launch('vj-speed-baseline');
  try {
    const r = await win.evaluate(() => {
      // 让低音平滑状态先收敛，再读稳态值——不然残留状态会让单次读数不准。
      for (let i = 0; i < 30; i++) vjSpeed(0, 1);
      const settledNoBass = vjSpeed(0, 1);
      for (let i = 0; i < 30; i++) vjSpeed(1, 1);
      const settledFullBass = vjSpeed(1, 1);

      const sel = document.getElementById('vjSpeedSel');
      const minAttr = parseFloat(sel.min);
      setBg3DSpeed(100);
      const atDefault = { noBass: settledNoBass, fullBass: settledFullBass, bg3DSpeed };
      setBg3DSpeed(minAttr);
      const atMin = { bg3DSpeed, minPct: minAttr };
      setBg3DSpeed(100);   // 还原，别把状态带给别的测试
      return { atDefault, atMin };
    });

    // 旧基准是 (0.9 + bass*3.2)*dt；新基准必须明显更慢。
    expect(r.atDefault.noBass).toBeLessThan(0.9);
    expect(r.atDefault.fullBass).toBeLessThan(0.9 + 3.2);
    // 滑杆低速端要能明显低于 20%（旧的 min），并且确实把 bg3DSpeed 压到很低。
    expect(r.atMin.minPct).toBeLessThanOrEqual(10);
    expect(r.atMin.bg3DSpeed).toBeLessThanOrEqual(0.1 + 1e-6);
  } finally {
    await closeApp(app, win);
    cleanupUserDataDir(dir);
  }
});

test('低音瞬态不会让推进速度在一帧内失控跳变', async () => {
  const { app, win, dir } = await launch('vj-speed-bass-smoothing');
  try {
    const r = await win.evaluate(() => {
      for (let i = 0; i < 60; i++) vjSpeed(0, 1);   // 先在静音状态下收敛
      const quiet = vjSpeed(0, 1);
      const spike = vjSpeed(1, 1);   // 突然满值低音，只喂一帧
      return { quiet, spike };
    });
    // 旧实现(无平滑)会在一帧内从 0.9 跳到 4.1——四倍多。平滑之后，单帧涨幅应该温和得多。
    expect(r.spike / r.quiet).toBeLessThan(1.5);
  } finally {
    await closeApp(app, win);
    cleanupUserDataDir(dir);
  }
});

test('降速后循环依旧无缝：默认速度和手动调到最低速度都不破坏前进方向/循环回收', async () => {
  const { app, win, dir } = await launch('vj-speed-loop-integrity');
  try {
    const kind = 'vjChromeTube';
    for (const speedPct of [100, 10]) {
      const r = await win.evaluate(({ kind, speedPct }) => {
        seedBg3DBuilds(0x5EED);
        setBg3DSpeed(speedPct);
        enableBg3D(kind);
        for (let i = 0; i < 30; i++) renderBg3D(0.5, 0.5, 0.5, 1);   // warm up
        const zsOf = () => {
          const s = bg3DScenes[kind];
          const zs = [];
          s.scene.traverse(o => { if (o.isMesh || o.isPoints || o.isInstancedMesh) zs.push(o.position.z); });
          return zs;
        };
        let fwd = 0, back = 0;
        let prev = zsOf();
        for (let i = 0; i < 40; i++) {
          renderBg3D(0, 0, 0, 1);   // muted, so only the base cruise speed drives motion
          const cur = zsOf();
          const n = Math.min(prev.length, cur.length);
          for (let j = 0; j < n; j++) {
            const d = cur[j] - prev[j];
            if (d > 0.01) fwd++; else if (d < -0.01) back++;
          }
          prev = cur;
        }
        // 再多跑一大段，确认循环没有在低速下卡死或塌陷成一片。
        for (let i = 0; i < 300; i++) renderBg3D(0.5, 0.4, 0.45, 1);
        const gl = bg3DRenderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let lit = 0;
        for (let i = 0; i < w * h; i++) { if (Math.max(buf[i*4], buf[i*4+1], buf[i*4+2]) >= 40) lit++; }
        disableBg3D();
        setBg3DSpeed(100);
        return { fwd, back, litFrac: lit / (w * h) };
      }, { kind, speedPct });

      expect.soft(r.fwd, `speed=${speedPct}%: fwd=${r.fwd}`).toBeGreaterThan(0);
      expect.soft(r.fwd, `speed=${speedPct}%: fwd should exceed back`).toBeGreaterThan(r.back);
      expect.soft(r.litFrac, `speed=${speedPct}%: 循环跑了一大段之后几乎全黑`).toBeGreaterThan(0.01);
    }
  } finally {
    await closeApp(app, win);
    cleanupUserDataDir(dir);
  }
});
