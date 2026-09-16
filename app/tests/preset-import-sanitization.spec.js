const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* applyLogoSlotData() 曾经用 `ld.scale||1` 这类假值兜底给 logo 的数值字段赋值 —— 只挡得住
 * 缺失/0/undefined，挡不住一个手改坏了的 preset 文件里混进来的字符串、对象等非法类型。
 * 非法值会原样写进 s.scale/offX/offY/rotation/bounceAmt/opacity，参与 canvas 变换时
 * 变成 NaN，logo 从画面上悄悄消失，不报任何错误。
 *
 * 修法：换成 Number.isFinite() 校验的 numOr()，非数字（含 NaN 本身）一律回退到默认值。
 */

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app = null, win = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

test('导入 preset 时，logo 数值字段的非法类型不会变成 NaN', async () => {
  await withApp('preset-sanitize', async (win) => {
    const res = await win.evaluate(() => {
      applyPresetState({
        logos: [{
          offX: '12px', offY: {}, scale: 'huge', rotation: [1, 2],
          bounceAmt: 'lots', opacity: 'full', visible: true, layer: 'front'
        }]
      });
      const s = logos[0];
      return { offX: s.offX, offY: s.offY, scale: s.scale, rotation: s.rotation,
               bounceAmt: s.bounceAmt, opacity: s.opacity };
    });
    expect(res.offX).toBe(0);
    expect(res.offY).toBe(0);
    expect(res.scale).toBe(1);
    expect(res.rotation).toBe(0);
    expect(res.bounceAmt).toBe(0.6);
    expect(res.opacity).toBe(1);
  });
});

test('导入 preset 时，合法数值字段（含 0）原样保留', async () => {
  await withApp('preset-sanitize-valid', async (win) => {
    const res = await win.evaluate(() => {
      applyPresetState({
        logos: [{ offX: 42, offY: -7, scale: 1.8, rotation: 0, bounceAmt: 0, opacity: 0.5,
                   visible: true, layer: 'front' }]
      });
      const s = logos[0];
      return { offX: s.offX, offY: s.offY, scale: s.scale, rotation: s.rotation,
               bounceAmt: s.bounceAmt, opacity: s.opacity };
    });
    expect(res).toEqual({ offX: 42, offY: -7, scale: 1.8, rotation: 0, bounceAmt: 0, opacity: 0.5 });
  });
});
