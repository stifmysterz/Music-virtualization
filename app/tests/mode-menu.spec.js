const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');

const APP_DIR = path.join(__dirname, '..');

/* dock 精简 + Mode 快速切换。
 *
 * 1) ⚡ Live Bar 暂时用不上，从 dock 移进 Tools 菜单。功能不变 —— 开了之后那条现场快捷条
 *    照旧出现在 dock 上方，只是开关不再占着 dock 的位置。
 *
 * 2) Mode 按钮原本点开的是右侧那个大面板（搜索 / 缩略图 / 亮度 / 收藏 / 前后层）。
 *    现在改成先出一个 drop-up：按 MODE_CATEGORIES 的 23 个分类折叠，点一项就切过去
 *    （只留选中的那个，和 3D 背景菜单一致），底部留一个入口进大面板。
 *    这套结构照抄已有的 #bg3DMenu —— 那个 drop-up 已经装着 120+ 项、同样按分类折叠。
 *
 *    注意：dock 上那个按钮本来就会显示当前 mode 名（STATEFUL_LABELS.modeBtn，
 *    多个时显示「Radial +2」），这部分不是新加的，但下面会一并断言它跟着切换更新。
 */

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    const win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win);
  } finally {
    if (app) { try { await app.close(); } catch (e) {} }
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

test('Live Bar 开关移进 Tools 菜单，dock 上不再有它，功能照旧', async () => {
  await withApp('modemenu-1', async (win) => {
    const res = await win.evaluate(() => {
      const btn = document.getElementById('liveBarToggleBtn');
      const bar = document.getElementById('liveBar');
      const before = getComputedStyle(bar).display;
      btn.click();
      const on = getComputedStyle(bar).display;
      btn.click();
      const off = getComputedStyle(bar).display;
      return {
        inDock: !!btn.closest('.dock'),
        inTools: !!btn.closest('#moreMenu'),
        dockButtons: [...document.querySelectorAll('.dock button')].map(b => b.id),
        before, on, off
      };
    });

    expect(res.inDock).toBe(false);
    expect(res.inTools).toBe(true);
    expect(res.dockButtons).not.toContain('liveBarToggleBtn');
    // 功能本身不能丢
    expect(res.before).toBe('none');
    expect(res.on).not.toBe('none');
    expect(res.off).toBe('none');
  });
});

test('点 Mode 出 drop-up，不再直接弹大面板', async () => {
  await withApp('modemenu-2', async (win) => {
    const res = await win.evaluate(() => {
      document.getElementById('modeBtn').click();
      return {
        menuOpen: document.getElementById('modeMenu')?.classList.contains('show') ?? null,
        panelOpen: document.getElementById('modePanel').classList.contains('show')
      };
    });

    expect(res.menuOpen).toBe(true);
    expect(res.panelOpen).toBe(false);
  });
});

test('drop-up 按 MODE_CATEGORIES 分类折叠，默认收起，点分类头展开', async () => {
  await withApp('modemenu-3', async (win) => {
    const res = await win.evaluate(() => {
      document.getElementById('modeBtn').click();
      const list = document.getElementById('modeMenuList');
      const headers = [...list.querySelectorAll('.mode-cat-header')];
      const firstCat = headers[0].dataset.modeCat;
      const itemsOf = cat => [...list.querySelectorAll('[data-mode-cat="' + cat + '"]')]
        .filter(el => !el.classList.contains('mode-cat-header'));

      const collapsed = itemsOf(firstCat).map(el => el.style.display);
      headers[0].click();
      const expanded = itemsOf(firstCat).map(el => el.style.display);
      headers[0].click();
      const recollapsed = itemsOf(firstCat).map(el => el.style.display);

      return {
        headerCount: headers.length,
        categoryCount: MODE_CATEGORIES.length,
        itemCount: itemsOf(firstCat).length,
        collapsedAllHidden: collapsed.every(d => d === 'none'),
        expandedAllShown: expanded.every(d => d !== 'none'),
        recollapsedAllHidden: recollapsed.every(d => d === 'none')
      };
    });

    expect(res.headerCount).toBe(res.categoryCount);   // 23 个分类全在
    expect(res.itemCount).toBeGreaterThan(0);
    // 200+ 个 mode 一次铺开没法用，所以默认收起
    expect(res.collapsedAllHidden).toBe(true);
    expect(res.expandedAllShown).toBe(true);
    expect(res.recollapsedAllHidden).toBe(true);
  });
});

test('点一项就切过去：只留选中的那个，dock 按钮文字跟着变', async () => {
  await withApp('modemenu-4', async (win) => {
    const res = await win.evaluate(() => {
      // 先叠两个，验证切换会把其他的清掉
      activeModes = [MODES.indexOf('radial'), MODES.indexOf('bars')];
      focusModeIdx = activeModes[0];
      refreshModePanelActive();
      const before = { active: [...activeModes], label: document.getElementById('modeBtn').textContent };

      document.getElementById('modeBtn').click();
      const target = 'neonGrid';
      const btn = document.querySelector('#modeMenuList [data-mode-key="' + target + '"]');
      if (!btn) return { missing: true };
      btn.click();

      return {
        missing: false,
        before,
        after: {
          active: [...activeModes],
          focus: focusModeIdx,
          label: document.getElementById('modeBtn').textContent
        },
        expectedIdx: MODES.indexOf(target),
        expectedLabel: getModeLabel(target)
      };
    });

    expect(res.missing).toBe(false);
    expect(res.before.active.length).toBe(2);
    // 切换 = 只留一个
    expect(res.after.active).toEqual([res.expectedIdx]);
    expect(res.after.focus).toBe(res.expectedIdx);
    // dock 上要看得出现在用的是哪个
    expect(res.after.label).toContain(res.expectedLabel);
    expect(res.after.label).not.toContain('+');   // 只剩一个，不该再有 "+1"
  });
});

test('当前正在用的 mode 在 drop-up 里被标出来', async () => {
  await withApp('modemenu-5', async (win) => {
    const res = await win.evaluate(() => {
      document.getElementById('modeBtn').click();
      const pick = 'starfield';
      document.querySelector('#modeMenuList [data-mode-key="' + pick + '"]').click();
      document.getElementById('modeBtn').click();   // 重新打开，看标记
      const el = document.querySelector('#modeMenuList [data-mode-key="' + pick + '"]');
      const other = document.querySelector('#modeMenuList [data-mode-key="radial"]');
      return { picked: el.classList.contains('active'), other: other.classList.contains('active') };
    });

    expect(res.picked).toBe(true);
    expect(res.other).toBe(false);
  });
});

test('drop-up 底部的入口能打开原来的大面板', async () => {
  await withApp('modemenu-6', async (win) => {
    const res = await win.evaluate(() => {
      document.getElementById('modeBtn').click();
      const more = document.getElementById('modeMoreBtn');
      if (!more) return { missing: true };
      more.click();
      return {
        missing: false,
        panelOpen: document.getElementById('modePanel').classList.contains('show'),
        menuOpen: document.getElementById('modeMenu').classList.contains('show')
      };
    });

    expect(res.missing).toBe(false);
    expect(res.panelOpen).toBe(true);
    expect(res.menuOpen).toBe(false);   // 开大面板时 drop-up 该收起
  });
});
