const fs = require('fs');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');

const APP_DIR = path.join(__dirname, '..');
const ROOT_DIR = path.join(APP_DIR, '..');

// 字重必须与 61.html:16 原本请求的完全一致——
// 用一个该字体并不存在的字重去 check()，会得到假阴性。
const FAMILIES = [
  { name: 'Orbitron',      weights: [500, 800] },
  { name: 'Audiowide',     weights: [400] },
  { name: 'Oxanium',       weights: [500, 800] },
  { name: 'Exo 2',         weights: [500, 800] },
  { name: 'Rajdhani',      weights: [500, 700] },
  { name: 'Michroma',      weights: [400] },
  { name: 'Space Grotesk', weights: [500, 700] },
  { name: 'Chakra Petch',  weights: [500, 700] },
  { name: 'Bebas Neue',    weights: [400] },
  { name: 'Teko',          weights: [500, 700] },
];

test('61.html 不再引用任何在线字体服务', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, '61.html'), 'utf8');
  expect(html).not.toContain('fonts.googleapis.com');
  expect(html).not.toContain('fonts.gstatic.com');
});

test('每种字体的每个字重都有对应的本地文件', () => {
  const css = fs.readFileSync(path.join(ROOT_DIR, 'fonts', 'fonts.css'), 'utf8');

  // 逐个 @font-face 块解析出 (family, 字重范围, 文件名)。
  // Google 对可变字体可能输出 `font-weight: 500 800;` 这样的区间，
  // 对静态字体输出单个数值——两种都要能解析。
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => {
    const body = m[1];
    const family = (body.match(/font-family:\s*['"]([^'"]+)['"]/) || [])[1];
    const wRaw = (body.match(/font-weight:\s*([\d\s]+);/) || [])[1] || '400';
    const nums = wRaw.trim().split(/\s+/).map(Number);
    const file = (body.match(/url\(([^)]+)\)/) || [])[1];
    return {
      family,
      min: nums[0],
      max: nums.length > 1 ? nums[1] : nums[0],
      file: (file || '').replace(/['"]/g, ''),
    };
  });

  for (const { name, weights } of FAMILIES) {
    for (const w of weights) {
      const match = faces.find(f => f.family === name && w >= f.min && w <= f.max);
      expect(match, `缺少字体 ${name} ${w}`).toBeTruthy();

      const size = fs.statSync(path.join(ROOT_DIR, 'fonts', match.file)).size;
      // 真实的 woff2 子集至少几 KB；几百字节说明下到的是错误页
      expect(size, `${match.file} 太小，可能不是有效字体`).toBeGreaterThan(2000);
    }
  }
});

test('10 种字体在应用中全部实际加载成功', async () => {
  const dir = newUserDataDir('fonts');
  const app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
  try {
    const win = await app.firstWindow();

    const missing = await win.evaluate(async (families) => {
      await document.fonts.ready;
      const bad = [];
      for (const { name, weights } of families) {
        for (const w of weights) {
          // These fonts are only ever applied via the runtime font picker, never by
          // default on-page CSS, so nothing at load time triggers the browser to
          // actually fetch them — document.fonts.ready resolves without touching
          // them. document.fonts.check() alone never forces a fetch either, so we
          // must force-load each combination (exactly what happens when a user
          // picks it) before checking whether it's actually available.
          try {
            await document.fonts.load(`${w} 16px "${name}"`);
          } catch (e) {
            // fall through; check() below will report it as missing
          }
          if (!document.fonts.check(`${w} 16px "${name}"`)) bad.push(`${name} ${w}`);
        }
      }
      return bad;
    }, FAMILIES);

    await app.close();
    expect(missing).toEqual([]);
  } finally {
    cleanupUserDataDir(dir);
  }
});
