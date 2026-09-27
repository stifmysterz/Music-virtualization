const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const APP_DIR = path.join(__dirname, '..');

/* Rainbow Coil Spiral:一条彩虹线圈绕自己的轴转。
 *
 * 原来的透视把两种单位混在一起:螺旋的深度 z 是像素(半径约 base*0.16,1080p 下一百多像素),
 * 相机距离 camDist = 3.4 却是归一化单位。于是缩放 focal/(z+camDist) 大部分时间只有约 0.02,
 * 整个螺旋缩成几个像素、几乎看不见(实测亮像素 0.04%);偶尔某一段的深度经过 0,缩放和线宽
 * 被放大几百倍,整屏闪一下彩色楔形。 */

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
}

test('Rainbow Coil 每一帧都看得见、画在画布里,不会忽然炸成整屏', async () => {
  await withApp('rainbow-coil', async win => {
    const r = await win.evaluate(() => {
      // 记录每一帧画了哪些点、线宽多少;不真的画
      let frame = null;
      const noop = () => {};
      const rec = new Proxy({}, {
        get: (t, k) => {
          if (k === 'moveTo' || k === 'lineTo') return (x, y) => frame.pts.push([x, y]);
          if (k === 'stroke') return () => { frame.maxWidth = Math.max(frame.maxWidth, t.lineWidth || 0); frame.strokes++; };
          return k in t ? t[k] : noop;
        },
        set: (t, k, v) => { t[k] = v; return true; },
      });
      const saved = { g2, fxOffX, fxOffY, freq };
      g2 = rec; fxOffX = 0; fxOffY = 0;
      freq = new Uint8Array(1024);
      const frames = [];
      let now = 0;
      try {
        for (let f = 0; f < 240; f++) {   // 4 秒、60 fps,低音和频谱都在变
          now += 16.7;
          const bass = 0.5 + 0.45 * Math.sin(now / 300);
          for (let i = 0; i < freq.length; i++) freq[i] = 120 + 120 * Math.sin(i * 0.05 + now / 200);
          frame = { pts: [], maxWidth: 0, strokes: 0 };
          drawRainbowCoil(bass, now, 1);
          frames.push(frame);
        }
      } finally { ({ g2, fxOffX, fxOffY, freq } = saved); }
      const base = Math.min(W, H);
      return {
        W, H, base, DPR,
        frames: frames.map(fr => {
          const xs = fr.pts.map(p => p[0]), ys = fr.pts.map(p => p[1]);
          return { n: fr.strokes, maxWidth: fr.maxWidth,
            minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
        }),
      };
    });

    const widths = r.frames.map(f => f.maxX - f.minX), heights = r.frames.map(f => f.maxY - f.minY);
    for (const [i, f] of r.frames.entries()) {
      expect(f.n, `第 ${i} 帧没画东西`).toBeGreaterThan(50);
      // 看得见:线圈的外框至少占短边的 30%(设计上半径 0.16、高 0.55)
      expect(widths[i], `第 ${i} 帧线圈只有 ${widths[i].toFixed(1)} px 宽`).toBeGreaterThan(r.base * 0.3);
      expect(heights[i], `第 ${i} 帧线圈只有 ${heights[i].toFixed(1)} px 高`).toBeGreaterThan(r.base * 0.4);
      // 不炸开:所有点都在画布里,线宽不会被放大几百倍
      expect(f.minX, `第 ${i} 帧画出了画布`).toBeGreaterThanOrEqual(0);
      expect(f.maxX, `第 ${i} 帧画出了画布`).toBeLessThanOrEqual(r.W);
      expect(f.minY, `第 ${i} 帧画出了画布`).toBeGreaterThanOrEqual(0);
      expect(f.maxY, `第 ${i} 帧画出了画布`).toBeLessThanOrEqual(r.H);
      expect(f.maxWidth, `第 ${i} 帧线宽 ${f.maxWidth.toFixed(1)}`).toBeLessThan(12 * r.DPR);
    }
    // 画面稳定:转动时外框大小只会平缓变化,不会一帧大一帧小
    expect(Math.max(...widths) / Math.min(...widths)).toBeLessThan(1.5);
  });
});
