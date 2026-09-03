const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 🎛 Now Playing：一眼看到现在有什么在跑，双击一行选中它或跳过去，✕ 移除。
 *
 * 这些信息本来散在三个菜单里 —— 2D 的活跃项混在 Mode 面板 241 个格子中间，
 * 3D/VJ 要各自打开菜单才知道。
 *
 * 两类行的双击含义不同，这是刻意的：2D 效果能拖拽/缩放/旋转，所以双击是把它设成
 * 手势的作用对象；3D/VJ 是背景，没有任何手势操作，设「焦点」不会有任何效果，
 * 所以双击改成直接打开它所属的菜单。
 */

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
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

const openPanel = async (win) => {
  await win.locator('#nowPlayingBtn').click();
  await expect(win.locator('#nowPlayingMenu')).toHaveClass(/show/);
};

test('列出正在跑的 2D 效果，最上层排最前，当前焦点有标记', async () => {
  test.setTimeout(180_000);
  await withApp('np-list', async (win) => {
    await win.evaluate(() => {
      activeModes = [MODES.indexOf('bars'), MODES.indexOf('wave'), MODES.indexOf('nebula')];
      focusModeIdx = MODES.indexOf('wave');
      disableBg3D();
    });
    await openPanel(win);
    const r = await win.evaluate(() => ({
      groups: [...document.querySelectorAll('#nowPlayingList .np-group')].map(g => g.firstChild.textContent),
      rows: [...document.querySelectorAll('#nowPlayingList .np-name')].map(b => b.textContent),
      focused: [...document.querySelectorAll('#nowPlayingList .np-name.focused')].map(b => b.textContent),
      empties: [...document.querySelectorAll('#nowPlayingList .np-empty')].length,
    }));
    expect(r.groups, '三层的分组标题不齐').toEqual(['2D Effects (3)', '3D Background', 'VJ Tunnel']);
    // activeModes 后面的画在上面，所以列表要倒过来 —— 最上层排最前，跟眼睛看到的一致
    // 显示的是 getModeLabel() 给的人类可读名，不是 MODES 里的 key（nebula → Nebula Cloud）
    expect(r.rows.map(t => t.replace('⊕ ', ''))).toEqual(['Nebula Cloud', 'Wave', 'Bars']);
    expect(r.focused, '当前焦点没有标出来').toEqual(['⊕ Wave']);
    expect(r.empties, '3D 和 VJ 都没开，应该各显示一行「无」').toBe(2);
  });
});

test('双击 2D 行把它设成手势的作用对象', async () => {
  test.setTimeout(180_000);
  await withApp('np-focus', async (win) => {
    await win.evaluate(() => {
      activeModes = [MODES.indexOf('bars'), MODES.indexOf('wave')];
      focusModeIdx = MODES.indexOf('wave');
    });
    await openPanel(win);
    // 列表是倒序的，最后一行是 activeModes[0] = bars
    await win.locator('#nowPlayingList .np-name').last().dblclick();
    expect(await win.evaluate(() => MODES[focusModeIdx]), '双击没有改变焦点').toBe('bars');
    // 标记也要跟着挪
    const focused = await win.evaluate(() =>
      [...document.querySelectorAll('#nowPlayingList .np-name.focused')].map(b => b.textContent));
    expect(focused).toEqual(['⊕ Bars']);
  });
});

test('✕ 只移除那一个 2D 效果，焦点落到还剩的上面', async () => {
  test.setTimeout(180_000);
  await withApp('np-remove', async (win) => {
    await win.evaluate(() => {
      activeModes = [MODES.indexOf('bars'), MODES.indexOf('wave'), MODES.indexOf('nebula')];
      focusModeIdx = MODES.indexOf('nebula');
    });
    await openPanel(win);
    // 第一行是最上层的 nebula，也正是当前焦点
    await win.locator('#nowPlayingList .np-del').first().click();
    const r = await win.evaluate(() => ({
      modes: activeModes.map(i => MODES[Math.floor(i)]),
      focus: focusModeIdx == null ? null : MODES[focusModeIdx],
      rows: [...document.querySelectorAll('#nowPlayingList .np-name')].map(b => b.textContent.replace('⊕ ', '')),
    }));
    expect(r.modes, '应该只移除被点的那一个').toEqual(['Bars', 'Wave'].map(x => x.toLowerCase()));
    expect(r.focus, '移除的正是焦点，焦点该落到还剩的上面').toBe('wave');
    expect(r.rows, '列表没跟着更新').toEqual(['Wave', 'Bars']);
  });
});

test('3D 和 VJ 各归各的组，双击打开它自己的菜单', async () => {
  test.setTimeout(180_000);
  await withApp('np-bg', async (win) => {
    // --- VJ 隧道 ---
    await win.evaluate(() => { activeModes = []; enableBg3D('vjNeonTubeRoom'); });
    await openPanel(win);
    let r = await win.evaluate(() => {
      const rows = [...document.querySelectorAll('#nowPlayingList .np-row')];
      const groups = [...document.querySelectorAll('#nowPlayingList .np-group')];
      // VJ 组在最后，所以那一行应该挂在 VJ 组下面
      return { count: rows.length, label: rows[0]?.querySelector('.np-name').textContent, groupCount: groups.length };
    });
    expect(r.count, 'VJ 开着时应该正好有一行').toBe(1);
    expect(r.label, '显示的名字不对').toMatch(/Neon Tube Room/);

    await win.locator('#nowPlayingList .np-name').first().dblclick();
    await expect(win.locator('#vjMenu'), '双击 VJ 行没有打开 🌀 VJ 菜单').toHaveClass(/show/);

    // --- 3D 背景 ---
    await win.evaluate(() => enableBg3D('synthwave'));
    await openPanel(win);
    await win.locator('#nowPlayingList .np-name').first().dblclick();
    await expect(win.locator('#bg3DMenu'), '双击 3D 行没有打开 🌌 3D 菜单').toHaveClass(/show/);
  });
});

test('✕ 掉背景那一行就是关掉 3D 背景', async () => {
  test.setTimeout(180_000);
  await withApp('np-bg-remove', async (win) => {
    await win.evaluate(() => { activeModes = []; enableBg3D('vjGridMorph'); });
    await openPanel(win);
    expect(await win.evaluate(() => hasBg3D)).toBe(true);
    await win.locator('#nowPlayingList .np-del').first().click();
    const r = await win.evaluate(() => ({
      has: hasBg3D,
      kind: bg3DKind,
      rows: [...document.querySelectorAll('#nowPlayingList .np-row')].length,
      empties: [...document.querySelectorAll('#nowPlayingList .np-empty')].length,
    }));
    expect(r.has, '没有真的关掉 3D 背景').toBe(false);
    expect(r.kind).toBe(null);
    expect(r.rows, '关掉之后不该还有行').toBe(0);
    expect(r.empties, '三组都空了，应该三行「无」').toBe(3);
  });
});

test('每层标题标出这一层的轮换状态 —— 不然选中的东西会被 shuffle 换掉还以为是 bug', async () => {
  test.setTimeout(180_000);
  await withApp('np-shuffle', async (win) => {
    await win.evaluate(() => {
      activeModes = [MODES.indexOf('bars')];
      enableBg3D('vjLiquidGrid');
      micShuffleOn = false;
      document.getElementById('vjShuffleIntervalSel').value = 'change';
      setVjShuffle(true);
      document.getElementById('bg3DShuffleIntervalSel').value = '8000';
      // 注意 setBg3DShuffle 会因为互斥把 VJ 关掉，所以这里只测 VJ 开着的样子
    });
    await openPanel(win);
    const r = await win.evaluate(() =>
      [...document.querySelectorAll('#nowPlayingList .np-shuffle')].map(e => ({ txt: e.textContent, on: e.classList.contains('on') })));
    expect(r.length).toBe(3);
    expect(r[0].txt, '2D 没开轮换，该显示 Off').toMatch(/Off/);
    expect(r[0].on).toBe(false);
    expect(r[2].txt, 'VJ 选的是突变档，该显示出来').toMatch(/On change/);
    expect(r[2].on, '开着的那一层该高亮').toBe(true);

    // 换成定时档，标签要跟着变成秒数
    await win.evaluate(() => {
      document.getElementById('vjShuffleIntervalSel').value = '16000';
      startVjShuffleTimer();
      renderNowPlaying();
    });
    const again = await win.evaluate(() =>
      [...document.querySelectorAll('#nowPlayingList .np-shuffle')].map(e => e.textContent));
    expect(again[2]).toMatch(/every 16s/);
  });
});

test('自动轮换换掉画面后，面板会自己刷新跟上', async () => {
  test.setTimeout(180_000);
  await withApp('np-refresh', async (win) => {
    await win.evaluate(() => { activeModes = []; enableBg3D('vjLiquidGrid'); });
    await openPanel(win);
    const before = await win.evaluate(() =>
      document.querySelector('#nowPlayingList .np-name').textContent);
    // 模拟 Auto-Shuffle 在面板开着的时候换了一个
    await win.evaluate(() => enableBg3D('vjCoasterRush'));
    await expect.poll(async () => win.evaluate(() =>
      document.querySelector('#nowPlayingList .np-name')?.textContent), { timeout: 5000 }).not.toBe(before);
    const after = await win.evaluate(() =>
      document.querySelector('#nowPlayingList .np-name').textContent);
    expect(after).toMatch(/Coaster Rush/);
  });
});

test('关掉面板就停掉刷新定时器，不在后台白烧 CPU', async () => {
  test.setTimeout(180_000);
  await withApp('np-timer', async (win) => {
    expect(await win.evaluate(() => !!nowPlayingTimer), '还没打开就在刷了').toBe(false);
    await openPanel(win);
    await expect.poll(() => win.evaluate(() => !!nowPlayingTimer)).toBe(true);
    // 点画布把下拉关掉
    await win.evaluate(() => document.body.click());
    await expect.poll(() => win.evaluate(() => !!nowPlayingTimer), { timeout: 5000 }).toBe(false);
  });
});

test('切语言时分组标题和轮换状态都跟着变', async () => {
  test.setTimeout(180_000);
  await withApp('np-i18n', async (win) => {
    await win.evaluate(() => { activeModes = [MODES.indexOf('bars')]; disableBg3D(); });
    await openPanel(win);
    const r = await win.evaluate(() => {
      applyLanguage('zh');
      renderNowPlaying();
      const zh = {
        groups: [...document.querySelectorAll('#nowPlayingList .np-group')].map(g => g.firstChild.textContent),
        shuffle: document.querySelector('#nowPlayingList .np-shuffle').textContent,
        btn: document.getElementById('nowPlayingBtn').textContent,
      };
      applyLanguage('en');
      renderNowPlaying();
      const en = {
        groups: [...document.querySelectorAll('#nowPlayingList .np-group')].map(g => g.firstChild.textContent),
        btn: document.getElementById('nowPlayingBtn').textContent,
      };
      return { zh, en };
    });
    expect(r.zh.groups).toEqual(['2D 效果 (1)', '3D 背景', 'VJ 隧道']);
    expect(r.zh.shuffle).toMatch(/关/);
    expect(r.zh.btn).toMatch(/正在播放/);
    expect(r.en.groups).toEqual(['2D Effects (1)', '3D Background', 'VJ Tunnel']);
    expect(r.en.btn).toMatch(/Now Playing/);
  });
});
