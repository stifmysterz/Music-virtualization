const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');

const APP_DIR = path.join(__dirname, '..');

/* 调试用的界面元素不该默认出现在成品里。
 *
 * 两处：
 *   #bg3dDebug（61.html）—— 左上角的绿色数据面板（bass/mid/high/beat/hasBg3D/…），
 *     内联样式、z-index:99999、完全没有开关，永远可见，而且 draw() 每帧都重写它的
 *     textContent。打包版也是开着的。
 *   body.debug-outline —— 画布周围的青色虚线框，Tools 里有开关但默认是「开」，
 *     且状态不持久化（每次启动都回到开），按钮初始文字还硬编码成英文 On。
 *
 * 改成：两个都默认关，状态存 localStorage，文字接进现有的 STATEFUL_LABELS/i18n 体系；
 * 绿色面板隐藏时跳过每帧的 DOM 写入。
 */

async function withApp(label, fn, opts = {}) {
  const dir = opts.dir || newUserDataDir(label);
  let app = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    const win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win);
  } finally {
    if (app) { try { await app.close(); } catch (e) {} }
    if (!opts.keepDir) { try { cleanupUserDataDir(dir); } catch (e) {} }
  }
}

test('全新启动时两个调试元素都不出现', async () => {
  await withApp('debug-1', async (win) => {
    const res = await win.evaluate(() => ({
      hudDisplay: getComputedStyle(document.getElementById('bg3dDebug')).display,
      hudText: document.getElementById('bg3dDebug').textContent,
      outlineOnBody: document.body.classList.contains('debug-outline'),
      cvOutline: getComputedStyle(document.getElementById('cv')).outlineStyle,
      hasHudBtn: !!document.getElementById('bg3dDebugBtn')
    }));

    expect(res.hudDisplay).toBe('none');
    expect(res.hudText).toBe('');            // 隐藏时不该还在每帧写字符串进去
    expect(res.outlineOnBody).toBe(false);
    expect(res.cvOutline).toBe('none');
    expect(res.hasHudBtn).toBe(true);        // 但要留一个开关，排查 3D 背景时还用得上
  });
});

test('3D Debug 开关能把面板调出来，且开了才有每帧数据', async () => {
  await withApp('debug-2', async (win) => {
    const res = await win.evaluate(async () => {
      const hud = document.getElementById('bg3dDebug');
      document.getElementById('bg3dDebugBtn').click();
      const shownDisplay = getComputedStyle(hud).display;
      await new Promise(r => { let n = 4; const t = () => (--n <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
      const textWhenShown = hud.textContent;

      document.getElementById('bg3dDebugBtn').click();
      const hiddenDisplay = getComputedStyle(hud).display;
      await new Promise(r => { let n = 4; const t = () => (--n <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
      const textWhenHidden = hud.textContent;

      return { shownDisplay, textWhenShown, hiddenDisplay, textWhenHidden };
    });

    expect(res.shownDisplay).not.toBe('none');
    expect(res.textWhenShown).toContain('bass=');
    expect(res.hiddenDisplay).toBe('none');
    expect(res.textWhenHidden).toBe('');     // 关掉之后就该停止每帧写入并清空
  });
});

test('Canvas Outline 打开时四层画布都被框住', async () => {
  await withApp('debug-3', async (win) => {
    const res = await win.evaluate(() => {
      document.getElementById('debugOutlineBtn').click();
      const style = id => getComputedStyle(document.getElementById(id)).outlineStyle;
      return { cv: style('cv'), cvFx: style('cvFx'), cvBack: style('cvBack'), bgThree: style('bgThree') };
    });

    // 特效层和 back 层是这次新加的，作为布局检查工具就该一起框上
    expect(res.cv).toBe('dashed');
    expect(res.cvFx).toBe('dashed');
    expect(res.cvBack).toBe('dashed');
    expect(res.bgThree).toBe('dashed');
  });
});

test('两个开关的状态都跨重启存活', async () => {
  const dir = newUserDataDir('debug-4');
  try {
    await withApp('debug-4', async (win) => {
      await win.evaluate(() => {
        document.getElementById('bg3dDebugBtn').click();     // 都打开
        document.getElementById('debugOutlineBtn').click();
      });
    }, { dir, keepDir: true });

    await withApp('debug-4', async (win) => {
      const res = await win.evaluate(() => ({
        hudDisplay: getComputedStyle(document.getElementById('bg3dDebug')).display,
        outlineOnBody: document.body.classList.contains('debug-outline')
      }));
      expect(res.hudDisplay).not.toBe('none');
      expect(res.outlineOnBody).toBe(true);
    }, { dir, keepDir: true });
  } finally {
    cleanupUserDataDir(dir);
  }
});

test('两个按钮的文字跟随界面语言，不再是初始硬编码英文', async () => {
  await withApp('debug-5', async (win) => {
    const res = await win.evaluate(() => {
      const read = () => ({
        outline: document.getElementById('debugOutlineBtn').textContent,
        hud: document.getElementById('bg3dDebugBtn').textContent
      });
      applyLanguage('zh');
      const zh = read();
      applyLanguage('en');
      const en = read();
      return { zh, en };
    });

    // 关闭状态下，中文界面要显示「关」而不是 "Off"
    expect(res.zh.outline).toContain('关');
    expect(res.zh.hud).toContain('关');
    expect(res.en.outline).toContain('Off');
    expect(res.en.hud).toContain('Off');
  });
});
