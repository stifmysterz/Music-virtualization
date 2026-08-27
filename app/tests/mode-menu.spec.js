const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

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

test('✕ 删除按钮也收进 drop-up，dock 上不再有它', async () => {
  await withApp('modemenu-7', async (win) => {
    const res = await win.evaluate(() => {
      const del = document.getElementById('modeDeleteBtn');
      const inDock = !!del.closest('.dock');
      const inMenu = !!del.closest('#modeMenu');

      document.getElementById('modeBtn').click();
      document.querySelector('#modeMenuList [data-mode-key="starfield"]').click();
      const before = [...activeModes];

      document.getElementById('modeBtn').click();
      const visibleWithMode = getComputedStyle(del).display;
      del.click();
      const after = [...activeModes];
      const visibleWithNone = getComputedStyle(del).display;

      return { inDock, inMenu, before, after, visibleWithMode, visibleWithNone,
               dockButtons: [...document.querySelectorAll('.dock button')].map(b => b.id) };
    });

    expect(res.inDock).toBe(false);
    expect(res.inMenu).toBe(true);
    expect(res.dockButtons).not.toContain('modeDeleteBtn');
    // 功能不变：删掉当前聚焦的那个
    expect(res.before.length).toBe(1);
    expect(res.after.length).toBe(0);
    // 有特效时才显示，一个都没有时自己藏起来
    expect(res.visibleWithMode).not.toBe('none');
    expect(res.visibleWithNone).toBe('none');
  });
});

/* 桌面（有鼠标）上，61.html 的 (hover:hover) and (pointer:fine) 媒体查询把「所有」
   .dock-dd 都改成了右侧 300px 全高侧栏 —— 包括 Mode。用户要的是从下面的 menubar
   往上弹的 drop-up，所以 #modeMenu 要从那条规则里单独豁免出来。
   其余菜单（Logo/Sound/Background/3D/Looks/Tools）保持侧栏不变：Background 有四个
   滑杆、3D 有 120+ 项，侧栏更好用。 */
test('桌面上 Mode 选单是真正的 drop-up：锚在 menubar 上方，不是右侧全高侧栏', async () => {
  await withApp('modemenu-8', async (win) => {
    const res = await win.evaluate(() => {
      document.getElementById('modeBtn').click();
      const menu = document.getElementById('modeMenu').getBoundingClientRect();
      const btn = document.getElementById('modeBtn').getBoundingClientRect();
      const dock = document.querySelector('.dock').getBoundingClientRect();
      return {
        desktop: matchMedia('(hover:hover) and (pointer:fine)').matches,
        menu: { top: menu.top, bottom: menu.bottom, left: menu.left, right: menu.right, w: menu.width, h: menu.height },
        btnCentre: btn.left + btn.width / 2,
        dockTop: dock.top,
        vh: innerHeight, vw: innerWidth
      };
    });

    expect(res.desktop).toBe(true);   // 前提：这台机器命中的确实是桌面分支
    // 底边贴在 dock 上方 —— 这才叫从 menubar 弹出来
    expect(res.menu.bottom).toBeLessThanOrEqual(res.dockTop + 2);
    // 不是全高侧栏
    expect(res.menu.h).toBeLessThan(res.vh - 40);
    // 也不是贴着右边缘的 300px 宽侧栏
    expect(res.menu.right).toBeLessThan(res.vw - 4);
    // 水平上大致对准 Mode 按钮（贴边时会被夹住，所以给宽一点的容差）
    const menuCentre = res.menu.left + res.menu.w / 2;
    expect(Math.abs(menuCentre - res.btnCentre)).toBeLessThan(res.menu.w / 2 + 20);
  });
});

test('其他 dock 菜单仍然是右侧全高侧栏，没被这次改动波及', async () => {
  await withApp('modemenu-9', async (win) => {
    const res = await win.evaluate(() => {
      const out = {};
      ['bgMenuBtn', 'looksMenuBtn', 'moreMenuBtn'].forEach(id => {
        document.getElementById(id).click();
        const menuId = { bgMenuBtn: 'bgMenu', looksMenuBtn: 'looksMenu', moreMenuBtn: 'moreMenu' }[id];
        const r = document.getElementById(menuId).getBoundingClientRect();
        out[menuId] = { h: r.height, right: r.right };
      });
      return { out, vh: innerHeight, vw: innerWidth };
    });

    Object.entries(res.out).forEach(([id, r]) => {
      expect(r.h, id).toBeGreaterThan(res.vh - 4);      // 全高
      expect(r.right, id).toBeGreaterThan(res.vw - 4);  // 贴右边缘
    });
  });
});

test('打开 Mode drop-up 不会把画布缩窄（那是侧栏才需要的让位）', async () => {
  await withApp('modemenu-10', async (win) => {
    const res = await win.evaluate(async () => {
      const settle = () => new Promise(r => setTimeout(r, 350));
      const widthBefore = cv.width;
      document.getElementById('modeBtn').click();
      await settle();
      const withMode = { cvWidth: cv.width, safeZone: PANEL_SAFE_ZONE };
      document.querySelectorAll('.dock-dd.show').forEach(m => m.classList.remove('show'));
      await settle();

      // 对照：侧栏式的菜单该照旧让位
      document.getElementById('bgMenuBtn').click();
      await settle();
      const withSidebar = { cvWidth: cv.width, safeZone: PANEL_SAFE_ZONE };
      return { widthBefore, withMode, withSidebar };
    });

    expect(res.withMode.safeZone).toBe(0);
    expect(res.withMode.cvWidth).toBe(res.widthBefore);
    // 侧栏仍然让位，这条逻辑没被改坏
    expect(res.withSidebar.safeZone).toBeGreaterThan(0);
    expect(res.withSidebar.cvWidth).toBeLessThan(res.widthBefore);
  });
});

test('drop-up 高度封顶在 menubar 上方的可用空间内，内容多了自己滚动', async () => {
  await withApp('modemenu-11', async (win) => {
    const res = await win.evaluate(() => {
      document.getElementById('modeBtn').click();
      const menu = document.getElementById('modeMenu');
      // 展开一个大分类，把内容撑起来
      [...menu.querySelectorAll('.mode-cat-header')][0].click();
      const r = menu.getBoundingClientRect();
      const dock = document.querySelector('.dock').getBoundingClientRect();
      return {
        h: r.height, top: r.top, dockTop: dock.top,
        scrollable: menu.scrollHeight > menu.clientHeight,
        overflowY: getComputedStyle(menu).overflowY,
        listColumn: getComputedStyle(document.getElementById('modeMenuList')).flexDirection
      };
    });

    expect(res.top).toBeGreaterThanOrEqual(0);        // 不能超出屏幕顶端
    expect(res.h).toBeLessThanOrEqual(res.dockTop);   // 不能盖过 menubar
    expect(res.overflowY).toBe('auto');
    expect(res.scrollable).toBe(true);                // 展开大分类后确实要滚
    expect(res.listColumn).toBe('column');            // 竖排一项一行，不是横向平铺
  });
});
