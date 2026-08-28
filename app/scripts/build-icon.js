#!/usr/bin/env node
/*
 * 从 build/icon.png 生成 build/icon.ico（多尺寸）。
 *
 * 为什么要自己生成：electron-builder 能把 PNG 转成 exe 用的图标，但 NSIS 的
 * MUI_ICON / MUI_UNICON 只吃真正的 .ico —— 直接把 PNG 塞给 installerIcon 会得到
 * “Error while loading icon ...: invalid icon file”，整个安装包构建失败。
 *
 * 缩放用 Electron 自己的 canvas 完成（仓库里已经有 Electron，不必为此再装图像库）。
 *
 * 尺寸与编码：16/24/32/48/64/128 存成 32 位 BMP（BITMAPINFOHEADER + BGRA + AND 掩码），
 * 256 存成 PNG。这是兼容性最稳的组合 —— NSIS 3 认 PNG 条目，但小尺寸用传统 BMP
 * 在各处（资源管理器、任务栏、Alt+Tab）都不会出岔子。
 *
 * 用法：node scripts/build-icon.js     （在 app/ 目录下跑）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_DIR = path.join(__dirname, '..');
const SRC = path.join(APP_DIR, 'build', 'icon.png');
const OUT = path.join(APP_DIR, 'build', 'icon.ico');
const BMP_SIZES = [16, 24, 32, 48, 64, 128];
const PNG_SIZES = [256];
// 「实心」的门槛：源图外面那圈光晕的 alpha 在 8~128 之间，实心的耳机在 128 以上
const SOLID_ALPHA = 128;
const CROP_MARGIN = 0.04;   // 裁剪框四周留一点点，别让图案硬贴着边

function bmpEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);          // biSize
  header.writeInt32LE(size, 4);         // biWidth
  header.writeInt32LE(size * 2, 8);     // biHeight：XOR + AND 两张图叠起来的高度
  header.writeUInt16LE(1, 12);          // biPlanes
  header.writeUInt16LE(32, 14);         // biBitCount
  header.writeUInt32LE(0, 16);          // biCompression = BI_RGB

  // XOR 位图：BGRA，自下而上
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const s = (srcY * size + x) * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2];       // B
      xor[d + 1] = rgba[s + 1];   // G
      xor[d + 2] = rgba[s];       // R
      xor[d + 3] = rgba[s + 3];   // A
    }
  }
  // AND 掩码：32 位图靠 alpha 通道决定透明，掩码全 0 即可（每行按 4 字节对齐）
  const maskRow = Math.ceil(size / 8 / 4) * 4;
  const mask = Buffer.alloc(maskRow * size, 0);
  return Buffer.concat([header, xor, mask]);
}

function buildIco(entries) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);              // reserved
  dir.writeUInt16LE(1, 2);              // type = 1 (icon)
  dir.writeUInt16LE(entries.length, 4);

  const dirEntries = [];
  let offset = 6 + entries.length * 16;
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d.writeUInt8(e.size >= 256 ? 0 : e.size, 0);   // 256 在这里写 0
    d.writeUInt8(e.size >= 256 ? 0 : e.size, 1);
    d.writeUInt8(0, 2);                 // 调色板颜色数：真彩色写 0
    d.writeUInt8(0, 3);                 // reserved
    d.writeUInt16LE(1, 4);              // planes
    d.writeUInt16LE(32, 6);             // bit count
    d.writeUInt32LE(e.data.length, 8);
    d.writeUInt32LE(offset, 12);
    dirEntries.push(d);
    offset += e.data.length;
  }
  return Buffer.concat([dir, ...dirEntries, ...entries.map(e => e.data)]);
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`找不到源图：${SRC}`);
    process.exit(1);
  }
  const { _electron: electron } = require('@playwright/test');
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'subremix-icon-'));
  const app = await electron.launch({ args: ['.', `--user-data-dir=${udd}`], cwd: APP_DIR });
  const win = await app.firstWindow();
  await new Promise((r) => setTimeout(r, 2500));

  const srcDataUrl = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64');
  const rendered = await win.evaluate(async ({ dataUrl, bmpSizes, pngSizes, solidAlpha, margin }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });

    /* 先裁到「实心内容」再缩放。
       源图外面罩着一大圈很淡的光晕（alpha 8~128），铺满整张 360x360 画布，而实心的
       耳机只占 257x245 —— 也就是七成。整张直接缩放的话，小尺寸上等于把本来就小的
       图案又白白缩掉三成，16px 的任务栏图标尤其吃亏。
       只在这里裁：build/icon.png 必须保持和 61.html 的 LOGO_SRC 逐字节相同（有测试盯着），
       所以源文件一个字节都不能动。 */
    const full = document.createElement('canvas');
    full.width = img.width; full.height = img.height;
    const fx = full.getContext('2d', { willReadFrequently: true });
    fx.drawImage(img, 0, 0);
    const fd = fx.getImageData(0, 0, full.width, full.height).data;
    let minX = full.width, minY = full.height, maxX = -1, maxY = -1;
    for (let y = 0; y < full.height; y++) for (let x = 0; x < full.width; x++) {
      if (fd[(y * full.width + x) * 4 + 3] > solidAlpha) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    let crop;
    if (maxX < 0) {
      crop = { x: 0, y: 0, side: Math.min(full.width, full.height) };   // 找不到实心像素就别裁
    } else {
      // 裁剪框必须是正方形，否则图案会被拉扁；以内容中心为心，边长取长边再留一点边距
      const cx = (minX + maxX + 1) / 2, cy = (minY + maxY + 1) / 2;
      let side = Math.max(maxX - minX + 1, maxY - minY + 1) * (1 + margin * 2);
      side = Math.min(side, full.width, full.height);
      let x0 = Math.round(cx - side / 2), y0 = Math.round(cy - side / 2);
      x0 = Math.max(0, Math.min(x0, full.width - side));
      y0 = Math.max(0, Math.min(y0, full.height - side));
      crop = { x: x0, y: y0, side: Math.round(side) };
    }

    const draw = (size) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size);
      return c;
    };
    const out = { bmp: {}, png: {}, crop, srcW: full.width, srcH: full.height,
                  solidBox: maxX < 0 ? null : { w: maxX - minX + 1, h: maxY - minY + 1 } };
    for (const s of bmpSizes) out.bmp[s] = Array.from(draw(s).getContext('2d').getImageData(0, 0, s, s).data);
    for (const s of pngSizes) out.png[s] = draw(s).toDataURL('image/png').split(',')[1];
    return out;
  }, { dataUrl: srcDataUrl, bmpSizes: BMP_SIZES, pngSizes: PNG_SIZES, solidAlpha: SOLID_ALPHA, margin: CROP_MARGIN });

  // 关闭守卫会问「要不要保存」，这里替它按「不保存退出」，否则 close() 会一直等
  const closing = app.close().catch(() => {});
  try {
    await win.waitForFunction(() => {
      const el = document.getElementById('exitSavePrompt');
      return !!el && getComputedStyle(el).display !== 'none';
    }, null, { timeout: 5000 });
    await win.evaluate(() => document.getElementById('exitSaveNoBtn').click());
  } catch (e) { /* 没弹出来就直接等它关 */ }
  await closing;
  try { fs.rmSync(udd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {}

  const entries = [];
  for (const s of BMP_SIZES) entries.push({ size: s, data: bmpEntry(s, rendered.bmp[s]) });
  for (const s of PNG_SIZES) entries.push({ size: s, data: Buffer.from(rendered.png[s], 'base64') });

  fs.writeFileSync(OUT, buildIco(entries));
  const c = rendered.crop, sb = rendered.solidBox;
  if (sb) {
    console.log(`源图 ${rendered.srcW}x${rendered.srcH}，实心内容 ${sb.w}x${sb.h}（占 ${(Math.max(sb.w, sb.h) / rendered.srcW * 100).toFixed(0)}%）`);
    console.log(`裁到 ${c.side}x${c.side} @ (${c.x},${c.y}) —— 图案在每个尺寸上放大约 ${((rendered.srcW / c.side - 1) * 100).toFixed(0)}%`);
  }
  console.log(`写出 ${path.relative(APP_DIR, OUT)}  ${entries.length} 个尺寸  ${fs.statSync(OUT).size} 字节`);
}

main().catch((err) => { console.error(err); process.exit(1); });
