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
  const rendered = await win.evaluate(async ({ dataUrl, bmpSizes, pngSizes }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const draw = (size) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, size, size);
      return c;
    };
    const out = { bmp: {}, png: {} };
    for (const s of bmpSizes) out.bmp[s] = Array.from(draw(s).getContext('2d').getImageData(0, 0, s, s).data);
    for (const s of pngSizes) out.png[s] = draw(s).toDataURL('image/png').split(',')[1];
    return out;
  }, { dataUrl: srcDataUrl, bmpSizes: BMP_SIZES, pngSizes: PNG_SIZES });

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
  console.log(`写出 ${path.relative(APP_DIR, OUT)}  ${entries.length} 个尺寸  ${fs.statSync(OUT).size} 字节`);
}

main().catch((err) => { console.error(err); process.exit(1); });
