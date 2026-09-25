#!/usr/bin/env node
'use strict';
/* 截图 + 指标。对比网页和每批验收都用它:
   node scripts/vj-shots.js --out ../vj-shots/baseline --kinds vjChromeFlow,vjNeonTubeRoom
     [--tiers low,balanced,ultra] [--aa off|fxaa|smaa] [--record 4k|1440p|1080p]
     [--measure] [--crop 0.62,0.35] [--crops-only]
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
  measure: flag('measure'),
  cropsOnly: flag('crops-only'),
  crop: arg('crop', '0.5,0.5').split(',').map(Number),
};
if (!kinds.length) { console.error('--kinds is required'); process.exit(2); }

function capture({ tier, kind, aa, record, measure, cropsOnly, crop }) {
  document.getElementById('intro')?.classList.add('hidden');
  const sel = document.getElementById('vjQualitySel');
  if (sel.value !== tier) { sel.value = tier; sel.dispatchEvent(new Event('change')); }
  if (aa && typeof setBg3DPostAA === 'function') setBg3DPostAA(aa);
  if (record) { recordQuality = record; enterRecordingResolution(); }
  vjDropCachedScene(kind);
  seedBg3DBuilds(0x5EED);
  vjSpeedBassSmooth = 0;
  enableBg3D(kind);
  for (let i = 0; i < 42; i++) renderBg3D(0.5, 0.4, 0.3, 1);
  const gl = bg3DRenderer.getContext();
  let frameMs = null;
  if (measure) {
    const t = [];
    for (let i = 0; i < 30; i++) { const a = performance.now(); renderBg3D(0.5, 0.4, 0.3, 1); gl.finish(); t.push(performance.now() - a); }
    t.sort((x, y) => x - y);
    frameMs = +t[15].toFixed(2);
    renderBg3D(0.5, 0.4, 0.3, 1);
  }
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
  if (record) exitRecordingResolution();
  return {
    tier: vjQuality, kind, aa: typeof bg3DPostAA === 'string' ? bg3DPostAA : 'n/a', record,
    width: w, height: h, lit: +(lit / (w * h)).toFixed(4), vivid: +(vivid / Math.max(1, lit)).toFixed(4),
    hues: hues.size, frameMs,
    full: cropsOnly ? null : full.toDataURL('image/png').split(',')[1],
    crop: zoom.toDataURL('image/png').split(',')[1],
  };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-shots-'));
  let app = null, win = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await win.waitForFunction(() => (document.getElementById('cv')?.width || 0) > 300, null, { timeout: 30000 });
    const metrics = [];
    for (const tier of tiers) for (const kind of kinds) {
      const r = await win.evaluate(capture, { tier, kind, ...opts });
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
