#!/usr/bin/env node
'use strict';
/* 截图 + 指标。对比网页和每批验收都用它:
   node scripts/vj-shots.js --out ../vj-shots/baseline --kinds vjChromeFlow,vjNeonTubeRoom
     [--tiers low,balanced,ultra] [--aa off|smaa] [--record 4k|1440p|1080p] [--record-sharp] [--dpr 2]
     [--measure] [--crop 0.62,0.35] [--crops-only] [--html <另一个版本的 61.html>]
   每张图都是固定种子、全新建场景、固定音频输入下的第 42 帧,不同批次之间可直接对比。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');
const { closeApp } = require('../tests/helpers/close-app');

const APP_DIR = path.join(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const flag = name => process.argv.includes(`--${name}`);

const out = path.resolve(arg('out', path.join(APP_DIR, '..', 'vj-shots', 'latest')));
const kinds = (arg('kinds', '') || '').split(',').filter(Boolean);
const tiers = arg('tiers', 'low,balanced,ultra').split(',');
const opts = {
  aa: arg('aa', null),
  record: arg('record', null),
  recordSharp: flag('record-sharp'),
  measure: flag('measure'),
  cropsOnly: flag('crops-only'),
  crop: arg('crop', '0.5,0.5').split(',').map(Number),
};
const dpr = arg('dpr', null);   // 模拟高分屏:--force-device-scale-factor
// 拍另一个版本(vj-review 拍改前用):文件要放在仓库根目录,fonts/ 等相对路径才对得上
const html = arg('html', null) && path.resolve(arg('html'));
if (!kinds.length) { console.error('--kinds is required'); process.exit(2); }

function capture({ tier, kind, aa, record, recordSharp, measure, cropsOnly, crop }) {
  document.getElementById('intro')?.classList.add('hidden');
  // 基线版本里还没有的隧道:跳过,不能让 enableBg3D 走到报错弹窗那条路
  if (typeof BG3D_BUILDERS[kind] !== 'function') throw new Error(`这个版本没有 ${kind}`);
  const sel = document.getElementById('vjQualitySel');
  if (sel.value !== tier) { sel.value = tier; sel.dispatchEvent(new Event('change')); }
  if (aa && typeof setBg3DPostAA === 'function') setBg3DPostAA(aa);
  if (record) {
    // 录制时 3D 清晰度是用户开关(默认按屏幕尺寸):--record-sharp 拍打开后的成片
    if (typeof setRecord3DSharp === 'function') setRecord3DSharp(recordSharp);
    recordQuality = record; enterRecordingResolution();
  }
  vjDropCachedScene(kind);
  seedBg3DBuilds(0x5EED);
  vjSpeedBassSmooth = 0;
  enableBg3D(kind);
  for (let i = 0; i < 42; i++) renderBg3D(0.5, 0.4, 0.3, 1);
  const gl = bg3DRenderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let lit = 0, vivid = 0; const hues = new Set();
  for (let i = 0; i < w * h; i++) {
    const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 40) continue;
    lit++;
    if ((mx - mn) / mx > 0.5) { vivid++; hues.add(Math.round(Math.atan2(g - b, r - g) * 6)); }
  }
  // 3D 层是自定义 alpha 管线:不把 alpha 强制成 255,看图器会把透明像素垫成白底,误判成过曝
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  const full = document.createElement('canvas'); full.width = w; full.height = h;
  full.getContext('2d').putImageData(img, 0, 0);
  // 录制模式裁的是成片合成帧 —— 3D 层被放大进成片时发软,只有这里看得出来
  const src = record ? composeCaptureFrame() : full;
  const CW = 220, CH = 124;
  const sx = Math.round(src.width * crop[0] - CW / 2), sy = Math.round(src.height * crop[1] - CH / 2);
  const zoom = document.createElement('canvas'); zoom.width = CW * 3; zoom.height = CH * 3;
  const zc = zoom.getContext('2d'); zc.imageSmoothingEnabled = false;
  zc.drawImage(src, sx, sy, CW, CH, 0, 0, CW * 3, CH * 3);
  // 先截图再计时:带不带 --measure,截到的都是第 42 帧
  let frameMs = null;
  if (measure) {
    // gl.finish() 在 ANGLE 下不等 GPU 画完,量到的只是提交时间;读回 1 个像素才是真正的同步点
    const px = new Uint8Array(4), t = [];
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let i = 0; i < 30; i++) { const a = performance.now(); renderBg3D(0.5, 0.4, 0.3, 1); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); t.push(performance.now() - a); }
    t.sort((x, y) => x - y);
    frameMs = +t[15].toFixed(2);
  }
  if (record) exitRecordingResolution();
  return {
    tier: vjQuality, kind, aa: typeof bg3DPostAA === 'string' ? bg3DPostAA : 'n/a', record,
    width: w, height: h, lit: +(lit / (w * h)).toFixed(4), vivid: +(vivid / Math.max(1, lit)).toFixed(4),
    hues: hues.size, frameMs, page: decodeURIComponent(location.pathname.split('/').pop()),
    full: cropsOnly ? null : full.toDataURL('image/png').split(',')[1],
    crop: zoom.toDataURL('image/png').split(',')[1],
  };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-shots-'));
  let app = null, win = null;
  try {
    app = await electron.launch({ args: [...(dpr ? [`--force-device-scale-factor=${dpr}`] : []), '.', `--user-data-dir=${userData}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await win.waitForFunction(() => (document.getElementById('cv')?.width || 0) > 300, null, { timeout: 30000 });
    if (html) {
      // 主进程直接换页:不改 main.js,也不碰工作区的 61.html
      await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].loadFile(p), html);
      await win.waitForFunction(name => decodeURIComponent(location.pathname).endsWith('/' + name) &&
        (document.getElementById('cv')?.width || 0) > 300, path.basename(html), { timeout: 30000 });
    }
    const metrics = [];
    for (const tier of tiers) for (const kind of kinds) {
      let r;
      try { r = await win.evaluate(capture, { tier, kind, ...opts }); }
      catch (e) { console.error(`跳过 ${tier}/${kind}:${e.message.split('\n')[0]}`); continue; }
      if (r.full) fs.writeFileSync(path.join(out, `${tier}-${kind}.png`), Buffer.from(r.full, 'base64'));
      fs.writeFileSync(path.join(out, `${tier}-${kind}-crop.png`), Buffer.from(r.crop, 'base64'));
      delete r.full; delete r.crop;
      metrics.push(r);
      console.log(JSON.stringify(r));
    }
    fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(metrics, null, 2));
  } finally {
    await closeApp(app, win);
    fs.rmSync(userData, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
