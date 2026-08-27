const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* Mode 的自动轮换。
 *
 * 这套机制本来就有、而且能用（实测：打开后 3.5 秒内 activeModes 从 [0] 变成
 * [116,95,127,58,139]，全程没有任何音频在播 —— 它是纯定时器，不依赖播放）。
 * 问题是位置：它在 Looks 菜单里，内部 id 还叫 micShuffle*（历史遗留，最早只在麦克风
 * 模式下用）。想让特效自动轮换的人会去 Mode 菜单找，找不到。
 *
 * 所以把开关、间隔、来源整块搬进 Mode drop-up。轮换整套 Look 的用法仍然可以从
 * Looks 面板里那个「自动轮换预设」按钮走 —— 那个按钮本来就存在，驱动的是同一份状态。
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

const CONTROLS = ['micShuffleToggle', 'micShuffleIntervalSel', 'micShuffleSourceSel', 'micShuffleCustomRow'];

test('自动轮换的整块控件都在 Mode drop-up 里，Looks 菜单里不再有', async () => {
  await withApp('modeshuf-1', async (win) => {
    const res = await win.evaluate((ids) => {
      const out = {};
      ids.forEach(id => {
        const el = document.getElementById(id);
        const menu = el ? el.closest('.dock-dd') : null;
        out[id] = menu ? menu.id : null;
      });
      return out;
    }, CONTROLS);

    CONTROLS.forEach(id => {
      expect(res[id], `${id} 应该在 modeMenu`).toBe('modeMenu');
    });
  });
});

test('从 Mode drop-up 打开后，特效真的会自动轮换（不需要播放任何音频）', async () => {
  await withApp('modeshuf-2', async (win) => {
    const res = await win.evaluate(async () => {
      // 用最短的自定义间隔，别让测试等太久
      const iv = document.getElementById('micShuffleIntervalSel');
      iv.value = 'custom';
      iv.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('micShuffleCustomSel').value = '1';
      document.getElementById('micShuffleCustomSel').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('micShuffleSourceSel').value = 'random';

      activeModes = [MODES.indexOf('radial')]; focusModeIdx = activeModes[0];
      const before = [...activeModes];

      document.getElementById('micShuffleToggle').click();
      const on = { flag: micShuffleOn, timer: micShuffleTimer !== null };
      await new Promise(r => setTimeout(r, 3500));
      const after = [...activeModes];

      document.getElementById('micShuffleToggle').click();
      const off = { flag: micShuffleOn, timer: micShuffleTimer !== null };
      await new Promise(r => setTimeout(r, 2500));
      const afterOff = [...activeModes];

      return { before, after, afterOff, on, off, playing };
    });

    expect(res.playing).toBe(false);          // 前提：全程没有音频在播
    expect(res.on.flag).toBe(true);
    expect(res.on.timer).toBe(true);
    expect(res.after).not.toEqual(res.before);   // 真的换了
    // 关掉之后就该停住不动
    expect(res.off.flag).toBe(false);
    expect(res.off.timer).toBe(false);
    expect(res.afterOff).toEqual(res.after);
  });
});

test('选「自定义」间隔时，秒数输入框才出现', async () => {
  await withApp('modeshuf-3', async (win) => {
    const res = await win.evaluate(() => {
      const iv = document.getElementById('micShuffleIntervalSel');
      const row = document.getElementById('micShuffleCustomRow');
      iv.value = '32000'; iv.dispatchEvent(new Event('change', { bubbles: true }));
      const hidden = getComputedStyle(row).display;
      iv.value = 'custom'; iv.dispatchEvent(new Event('change', { bubbles: true }));
      const shown = getComputedStyle(row).display;
      return { hidden, shown };
    });

    expect(res.hidden).toBe('none');
    expect(res.shown).not.toBe('none');
  });
});

test('轮换整套 Look 的入口仍然驱动同一份状态', async () => {
  await withApp('modeshuf-4', async (win) => {
    const res = await win.evaluate(() => {
      const btn = document.getElementById('presetAutoCycleBtn');
      if (!btn) return { missing: true };
      btn.click();   // 打开「自动轮换预设」
      const afterOn = { flag: micShuffleOn, source: document.getElementById('micShuffleSourceSel').value };
      btn.click();
      const afterOff = { flag: micShuffleOn };
      return { missing: false, afterOn, afterOff };
    });

    expect(res.missing).toBe(false);
    expect(res.afterOn.flag).toBe(true);
    expect(res.afterOn.source).toBe('presets');   // 它会把来源切到预设
    expect(res.afterOff.flag).toBe(false);
  });
});

test('Looks 菜单里 Next Look 的说明不再指向已经搬走的控件', async () => {
  await withApp('modeshuf-5', async (win) => {
    const res = await win.evaluate(() => {
      const btn = document.getElementById('nextLookBtn');
      return { inMenu: btn.closest('.dock-dd').id, title: btn.title };
    });

    expect(res.inMenu).toBe('looksMenu');
    // 原来写的是「using whatever Auto-Shuffle source is set below」——
    // 那几个控件已经搬到 Mode 菜单了，"below" 会把人指到空处
    expect(res.title.toLowerCase()).not.toContain('below');
  });
});
