const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* dock 在窄窗口上够不着最右边的按钮。
 *
 * 实测（1920 窗口）：dock 一排要 1232px，也就是窗口至少 1311px 才不用横向滚 —— 而
 * dock 的 overflow-x:auto 是特意藏掉滚动条的，用户看不到任何「还能往右滑」的提示，
 * 只会觉得 ⚙ Tools 消失了。#playBtn 的 position:sticky 就是为这个打的补丁，但它只
 * 救得了最左边那一个。
 *
 * 更麻烦的是 dock 宽度不是固定的：Mode 按钮显示当前效果名，
 *   「Bars」                            →  76px  ⇒ 窗口 ≥ 1311px
 *   「Glitch Bars: Rainbow Gradient +2」 → 278px  ⇒ 窗口 ≥ 1526px
 * 同一台 1366×768 的笔记本，切个效果就从「刚好够」变成「够不着」。
 *
 * 两件事一起治：
 *   · Mode 按钮限宽 —— dock 的宽度不再随选了什么效果浮动
 *   · 窄窗口换行成两排 —— 横向滚是隐藏功能，换行是看得见的
 */

const LONG_LABEL = 'Glitch Bars: Rainbow Gradient';   // 241 个 mode 里最长的一个

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app = null, win = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      const rp = document.getElementById('restorePrompt'); if (rp) rp.style.display = 'none';
    });
    await fn(win, async (w, h = 900) => {
      await app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0].setSize(size.w, size.h);
      }, { w, h });
      await win.waitForTimeout(350);
    });
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

const dockMetrics = (win) => win.evaluate(() => {
  const d = document.querySelector('.dock');
  return { scrollW: d.scrollWidth, clientW: Math.round(d.clientWidth), h: Math.round(d.getBoundingClientRect().height), inner: innerWidth };
});

test('Mode 按钮再长的效果名也不撑宽 dock，但叠了几层的计数要留着', async () => {
  test.setTimeout(180_000);
  await withApp('dock-modebtn', async (win) => {
    const r = await win.evaluate((LONG) => {
      const btn = document.getElementById('modeBtn');
      const w = () => Math.round(btn.getBoundingClientRect().width);
      activeModes = [MODES.indexOf('bars')];
      focusModeIdx = activeModes[0];
      refreshStatefulLabels();
      const short = { w: w(), txt: btn.textContent };

      const longKey = MODES.find(k => getModeLabel(k) === LONG);
      activeModes = [MODES.indexOf('bars'), MODES.indexOf('wave'), MODES.indexOf(longKey)];
      focusModeIdx = MODES.indexOf(longKey);
      refreshStatefulLabels();
      const long = { w: w(), txt: btn.textContent, full: getModeLabel(longKey) };
      return { short, long };
    }, LONG_LABEL);

    console.log(`  「${r.short.txt}」 ${r.short.w}px  →  「${r.long.txt}」 ${r.long.w}px`);
    expect(r.short.txt, '短名不该被截').toBe('Bars');
    expect(r.long.w, 'Mode 按钮被最长的效果名撑爆了，dock 会跟着变宽').toBeLessThanOrEqual(180);
    // 截掉的是名字，不是计数 —— 「还叠着另外 2 个」这件事比看到完整名字重要
    expect(r.long.txt, '截断之后没有留下叠加计数 +2').toMatch(/\+2$/);
    expect(r.long.txt, '被截了就要有省略号，不然看起来像效果本来就叫这个名').toContain('…');
    expect(r.long.full, '完整名字本身不该被改掉 —— Mode 菜单和 Now Playing 还要用').toBe(LONG_LABEL);
  });
});

test('窄窗口 dock 换行成两排，不靠那条藏起来的横向滚动条', async () => {
  test.setTimeout(180_000);
  await withApp('dock-wrap', async (win, resize) => {
    // 先撑到最坏情况：最长的效果名 + 叠加计数
    await win.evaluate((LONG) => {
      const longKey = MODES.find(k => getModeLabel(k) === LONG);
      activeModes = [MODES.indexOf('bars'), MODES.indexOf('wave'), MODES.indexOf(longKey)];
      focusModeIdx = MODES.indexOf(longKey);
      refreshStatefulLabels();
    }, LONG_LABEL);

    for (const w of [1280, 1100, 1024]) {
      await resize(w);
      const m = await dockMetrics(win);
      const over = m.scrollW - m.clientW;
      const rows = Math.round((m.h - 18) / 43);   // padding 8×2 + 边框；每排约 43px（35 高 + 8 间距）
      console.log(`  窗口 ${m.inner} → dock ${m.clientW}px 宽 / ${m.h}px 高（${rows} 排），溢出 ${over}px`);
      expect(over, `窗口 ${m.inner}px 时 dock 还在横向溢出 ${over}px —— 右边的按钮够不着`).toBeLessThanOrEqual(1);
      // 光「不溢出」不够：position:fixed + left:50% 会让可用宽度只剩右半边视口，
      // 那样也不溢出，但会折成又窄又高的三四排，占掉半个画面
      expect(rows, `dock 折成了 ${rows} 排 —— 换行按的是半个视口的宽度，不是 94vw`).toBeLessThanOrEqual(2);
      expect(m.clientW, `dock 只有 ${m.clientW}px 宽，没有用满 94vw（${Math.round(m.inner * 0.94)}px）`)
        .toBeGreaterThan(m.inner * 0.8);
    }
  });
});

test('宽窗口仍然是一排，不要没事找事换行', async () => {
  test.setTimeout(180_000);
  await withApp('dock-wide', async (win, resize) => {
    await win.evaluate(() => {
      activeModes = [MODES.indexOf('bars')];
      focusModeIdx = activeModes[0];
      refreshStatefulLabels();
    });
    await resize(1600);
    const m = await dockMetrics(win);
    console.log(`  窗口 ${m.inner} → dock ${m.h}px 高`);
    expect(m.h, '宽窗口下 dock 变成两排了').toBeLessThan(70);
    expect(m.scrollW - m.clientW, '宽窗口下不该有溢出').toBeLessThanOrEqual(1);
  });
});

test('dock 变两排时，Live Bar 跟着往上让，不压在一起', async () => {
  test.setTimeout(180_000);
  await withApp('dock-livebar', async (win, resize) => {
    await win.evaluate((LONG) => {
      const longKey = MODES.find(k => getModeLabel(k) === LONG);
      activeModes = [MODES.indexOf('bars'), MODES.indexOf('wave'), MODES.indexOf(longKey)];
      focusModeIdx = MODES.indexOf(longKey);
      refreshStatefulLabels();
      liveBarOn = true; applyLiveBarVisibility();
    }, LONG_LABEL);

    for (const w of [1600, 1024]) {
      await resize(w);
      const r = await win.evaluate(() => {
        const d = document.querySelector('.dock').getBoundingClientRect();
        const l = document.getElementById('liveBar').getBoundingClientRect();
        return { dockTop: Math.round(d.top), liveBottom: Math.round(l.bottom), rows: Math.round(d.height) > 70 ? 2 : 1, inner: innerWidth };
      });
      const gap = r.dockTop - r.liveBottom;
      console.log(`  窗口 ${r.inner} → dock ${r.rows} 排，Live Bar 底边到 dock 顶边 ${gap}px`);
      expect(gap, `窗口 ${r.inner}px 时 Live Bar 和 dock 叠在一起了（间距 ${gap}px）`).toBeGreaterThan(0);
    }
  });
});

test('侧栏菜单开着时，dock 整条都还点得到 —— 不能有按钮被压在侧栏底下', async () => {
  test.setTimeout(180_000);
  await withApp('dock-sidebar', async (win, resize) => {
    /* 这是换行改动顺带暴露出来的旧问题：桌面上 dock 的下拉菜单是整屏高的右侧栏
     * （width:300px, z-index:25），而 dock 是居中铺满 94vw 的（z-index:10）——
     * 菜单一开，dock 右端那 300px 里的按钮就全被盖住点不到。
     * 改之前是 💾 Looks / ⏱ Timing / ⚙ Tools 三个，换行之后变成 🌀 VJ / 💾 Looks，
     * 也就是说这个坑一直在，只是每次被埋的按钮不一样。 */
    const RIGHT_EDGE_BTNS = ['bg3DMenuBtn', 'vjMenuBtn', 'looksMenuBtn', 'timingBtn', 'moreMenuBtn'];

    for (const w of [1600, 1176]) {
      await resize(w);
      const r = await win.evaluate((ids) => {
        // 按钮是开合两用的，第二次循环时它已经开着，再点一下会把它关掉
        document.querySelectorAll('.dock-dd.show').forEach(m => m.classList.remove('show'));
        document.getElementById('bg3DMenuBtn').click();          // 开一个侧栏菜单
        const bar = document.getElementById('bg3DMenu').getBoundingClientRect();
        const covered = ids.filter(id => {
          const b = document.getElementById(id).getBoundingClientRect();
          return b.right > bar.left;      // 只要右半边探进侧栏就算被盖
        });
        return { inner: innerWidth, sidebarLeft: Math.round(bar.left), covered, shown: document.getElementById('bg3DMenu').classList.contains('show') };
      }, RIGHT_EDGE_BTNS);

      console.log(`  窗口 ${r.inner} → 侧栏从 x=${r.sidebarLeft} 开始，被盖住的按钮：${r.covered.length ? r.covered.join(', ') : '（无）'}`);
      expect(r.shown, '侧栏没打开，这条测试就没意义').toBe(true);
      expect(r.covered, `窗口 ${r.inner}px 时这些按钮被侧栏盖住点不到`).toEqual([]);
    }
  });
});

test('Mode 的 drop-up 不是侧栏，开它的时候 dock 不该跟着挪', async () => {
  test.setTimeout(180_000);
  await withApp('dock-dropup', async (win, resize) => {
    await resize(1600);
    const r = await win.evaluate(() => {
      const dock = document.querySelector('.dock');
      const before = Math.round(dock.getBoundingClientRect().left);
      document.getElementById('modeBtn').click();
      const open = document.getElementById('modeMenu').classList.contains('show');
      return { before, after: Math.round(dock.getBoundingClientRect().left), open };
    });
    expect(r.open, 'Mode drop-up 没打开').toBe(true);
    // drop-up 锚在 Mode 按钮正上方，dock 一挪它就指错地方
    expect(r.after, `dock 跟着 drop-up 挪了 ${r.before - r.after}px`).toBe(r.before);
  });
});
