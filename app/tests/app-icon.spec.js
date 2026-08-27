const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const APP_DIR = path.join(__dirname, '..');
const ICON_PNG = path.join(APP_DIR, 'build', 'icon.png');
const pkg = require('../package.json');

/* 应用图标。
 *
 * 打包一直用的是 Electron 的默认图标（提交 1f80ef7 里明确写了「先出安装包，图标以后再选」，
 * 构建日志也会打一行 "default Electron icon is used"）。现在改成用应用自己的 logo：
 * 从 61.html 的 LOGO_SRC 导出成 app/build/icon.png，exe、桌面快捷方式和安装向导都用它。
 *
 * 桌面快捷方式的图标不需要单独配置 —— NSIS 建的快捷方式指向 exe，图标跟着 exe 走。
 */

test('图标源文件存在，是带透明通道的正方形 PNG，且足够大', () => {
  expect(fs.existsSync(ICON_PNG), 'app/build/icon.png 不存在').toBe(true);

  const buf = fs.readFileSync(ICON_PNG);
  expect(buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), '不是 PNG').toBe(true);

  // IHDR：宽 4 字节、高 4 字节、位深 1 字节、颜色类型 1 字节
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const colourType = buf[25];

  expect(w).toBe(h);                    // 正方形，否则做成图标会被压扁或留白
  expect(w).toBeGreaterThanOrEqual(256); // electron-builder 生成 .ico 的下限
  // 颜色类型 6 = RGBA、4 = 灰度+alpha。图标必须有透明通道，否则会带一块黑底方块
  expect([4, 6]).toContain(colourType);
});

test('图标就是应用自己的 logo，不是随便一张图', () => {
  const html = fs.readFileSync(path.join(APP_DIR, '..', '61.html'), 'utf8');
  const m = /const LOGO_SRC\s*=\s*"data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(html);
  expect(m, '61.html 里找不到 LOGO_SRC').not.toBeNull();

  const fromHtml = Buffer.from(m[1], 'base64');
  const onDisk = fs.readFileSync(ICON_PNG);
  // 逐字节相同 —— 图标是从 LOGO_SRC 导出来的，不是另找的一张图
  expect(onDisk.equals(fromHtml)).toBe(true);
});

test('打包配置把 exe 和安装向导都指向这个图标', () => {
  const b = pkg.build;
  expect(b.win.icon).toBeTruthy();
  expect(b.nsis.installerIcon).toBeTruthy();
  expect(b.nsis.uninstallerIcon).toBeTruthy();
  expect(b.nsis.installerHeaderIcon).toBeTruthy();

  // 配置里写的路径必须真的指到这个文件（相对 app/ 解析）
  [b.win.icon, b.nsis.installerIcon, b.nsis.uninstallerIcon, b.nsis.installerHeaderIcon]
    .forEach(rel => expect(fs.existsSync(path.join(APP_DIR, rel)), rel).toBe(true));

  // 桌面快捷方式的图标跟着 exe 走，所以这个开关必须还开着
  expect(b.nsis.createDesktopShortcut).toBe(true);
});

test('生成的 .ico 尺寸齐全，小尺寸用 BMP、256 用 PNG', () => {
  const ICO = path.join(APP_DIR, 'build', 'icon.ico');
  expect(fs.existsSync(ICO), 'app/build/icon.ico 不存在，先跑 npm run icon').toBe(true);
  const b = fs.readFileSync(ICO);
  expect(b.readUInt16LE(2)).toBe(1);   // type = icon

  const count = b.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const size = b.readUInt8(o) || 256;
    const offset = b.readUInt32LE(o + 12);
    const len = b.readUInt32LE(o + 8);
    const isPng = b.slice(offset, offset + 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    entries.push({ size, offset, len, isPng, bits: b.readUInt16LE(o + 6) });
  }

  expect(entries.map(e => e.size).sort((a, x) => a - x)).toEqual([16, 24, 32, 48, 64, 128, 256]);
  entries.forEach(e => expect(e.bits, `${e.size}px`).toBe(32));
  // NSIS 认 PNG 条目，但小尺寸用传统 BMP 在资源管理器/任务栏/Alt+Tab 各处都最稳
  expect(entries.find(e => e.size === 256).isPng).toBe(true);
  entries.filter(e => e.size < 256).forEach(e => expect(e.isPng, `${e.size}px 不该是 PNG`).toBe(false));
});

test.describe('构建产物', () => {
  const DIST = path.join(APP_DIR, '..', 'dist');
  const EXE = path.join(DIST, 'win-unpacked', `${pkg.build.productName}.exe`);
  const INSTALLER = path.join(DIST, `${pkg.build.productName} Setup ${pkg.version}.exe`);
  test.skip(() => !fs.existsSync(EXE), '尚未构建，先跑 npm run dist');

  test('exe 和安装包里带的都是我们这张图标，不是 Electron 默认图标', () => {
    const ico = fs.readFileSync(path.join(APP_DIR, 'build', 'icon.ico'));
    const exe = fs.readFileSync(EXE);
    const installer = fs.readFileSync(INSTALLER);
    // 原版 electron.exe 作对照组：我们的图标数据在它里面一个字节都不该出现
    const stock = fs.readFileSync(path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'));

    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const o = 6 + i * 16;
      const size = ico.readUInt8(o) || 256;
      const offset = ico.readUInt32LE(o + 12);
      const isPng = ico.slice(offset, offset + 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      // BMP 条目在资源里是去掉 ICONDIR 后原样存放的，跳过 40 字节的 BITMAPINFOHEADER
      // 取一段像素当指纹；PNG 条目则整块原样保留
      const probe = ico.slice(isPng ? offset : offset + 40, (isPng ? offset : offset + 40) + 256);

      expect(exe.includes(probe), `${size}px 没进 exe`).toBe(true);
      expect(installer.includes(probe), `${size}px 没进安装包`).toBe(true);
      expect(stock.includes(probe), `${size}px 在原版 electron.exe 里也有？对照组失效`).toBe(false);
    }
  });
});
