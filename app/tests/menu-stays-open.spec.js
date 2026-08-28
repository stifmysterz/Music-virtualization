const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 换 mode 不该把你开着的选单收起来。
 *
 * 会换 mode 的路径有六条，其中五条本来就规规矩矩：M 键循环、Timing 面板的定时切换、
 * 载入 Look/预设、Mode drop-up 里点一项、大面板里选 —— 都不碰选单。
 * 只有 randomCombo() 第一行无条件关掉所有 .dock-dd.show，而它会被这些东西碰到：
 *   - 自动轮换定时器，每 N 秒一次        ← 完全不需要动手
 *   - 「⚡ On Sudden Change」，音乐一变就触发  ← 同上，时机更没法预料
 *   - ⏭ Next Look、三个 🎲 按钮、快捷键/MIDI 的 Random Shuffle
 * 于是「我正在 3D 选单里挑东西，选单自己没了」。
 *
 * 这一行本来是为「你在 Looks 菜单里点 🎲」写的 —— 那时候关掉说得通。但定时器调用时
 * 根本没有人点任何东西。规则改成：只有你自己动手才会关选单（点选单外面、再按一次
 * 那个按钮、按 Esc），换 mode 永远不碰它。
 *
 * 注意 drop-up 是互斥的（setupDockDropdown 开一个之前先关掉其他），所以「其它选单」
 * 在任何时刻都只有一个开着 —— 下面用 3D 选单当代表。
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

// 假音频：自动轮换本身是纯定时器不需要它，但「⚡ On Sudden Change」要读 lastBass
function primeAudio() {
  document.getElementById('intro')?.classList.add('hidden');
  const rp = document.getElementById('restorePrompt'); if (rp) rp.style.display = 'none';
  freq = new Uint8Array(1024); wave = new Uint8Array(2048);
  analyser = {
    frequencyBinCount: freq.length, fftSize: wave.length,
    getByteFrequencyData(a) { for (let i = 0; i < a.length; i++) a[i] = 130 + (i % 80); },
    getByteTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = 128; }
  };
}

test('自动轮换连换几轮，开着的 3D 选单还在', async () => {
  await withApp('stayopen-1', async (win) => {
    const res = await win.evaluate(async (prime) => {
      eval('(' + prime + ')')();
      const $ = id => document.getElementById(id);

      const iv = $('micShuffleIntervalSel');
      iv.value = 'custom'; iv.dispatchEvent(new Event('change', { bubbles: true }));
      $('micShuffleCustomSel').value = '1';
      $('micShuffleCustomSel').dispatchEvent(new Event('input', { bubbles: true }));
      $('micShuffleSourceSel').value = 'random';   // 走 randomCombo，不是 loadPreset

      $('bg3DMenuBtn').click();                    // 我正在这里面挑东西
      const openedAt = $('bg3DMenu').classList.contains('show');
      const modesBefore = [...activeModes];

      $('micShuffleToggle').click();
      await new Promise(r => setTimeout(r, 3500));   // 至少三轮
      const stillOpen = $('bg3DMenu').classList.contains('show');
      const modesAfter = [...activeModes];
      $('micShuffleToggle').click();

      document.querySelectorAll('.dock-dd.show').forEach(m => m.classList.remove('show'));
      return { openedAt, stillOpen, changed: JSON.stringify(modesBefore) !== JSON.stringify(modesAfter) };
    }, primeAudio.toString());

    expect(res.openedAt).toBe(true);
    expect(res.changed, '轮换根本没换 mode，这个测试就没在测东西').toBe(true);
    expect(res.stillOpen, '自动轮换把开着的 3D 选单收起来了').toBe(true);
  });
});

test('「⚡ On Sudden Change」触发时，开着的选单也不收起来', async () => {
  await withApp('stayopen-2', async (win) => {
    const res = await win.evaluate(async (prime) => {
      eval('(' + prime + ')')();
      const $ = id => document.getElementById(id);

      $('micShuffleSourceSel').value = 'random';
      $('micShuffleIntervalSel').value = 'change';
      $('micShuffleIntervalSel').dispatchEvent(new Event('change', { bubbles: true }));
      micShuffleOn = true;                       // 直接置位：这条路不靠定时器，靠音频突变

      $('bgMenuBtn').click();
      const openedAt = $('bgMenu').classList.contains('show');
      const modesBefore = [...activeModes];

      // 先喂 4 秒的安静底噪把长时窗填满，再猛地拉高 —— 这就是「突然变化」
      lastChangeShuffleAt = -1e9;
      changeShortHist = []; changeLongHist = [];
      for (let i = 0; i < 240; i++) { lastBass = 0.05; checkSuddenChangeShuffle(1000 + i); }
      for (let i = 0; i < 30; i++) { lastBass = 0.9; checkSuddenChangeShuffle(2000 + i); }

      const stillOpen = $('bgMenu').classList.contains('show');
      const modesAfter = [...activeModes];
      micShuffleOn = false;
      document.querySelectorAll('.dock-dd.show').forEach(m => m.classList.remove('show'));
      return { openedAt, stillOpen, changed: JSON.stringify(modesBefore) !== JSON.stringify(modesAfter) };
    }, primeAudio.toString());

    expect(res.openedAt).toBe(true);
    expect(res.changed, '没触发到突变换 mode，这个测试就没在测东西').toBe(true);
    expect(res.stillOpen, '⚡ On Sudden Change 把开着的选单收起来了').toBe(true);
  });
});

test('手动的那几个入口也一样：🎲 Random、⏭ Next Look、快捷键的 Random Shuffle', async () => {
  await withApp('stayopen-3', async (win) => {
    const res = await win.evaluate(async (prime) => {
      eval('(' + prime + ')')();
      const $ = id => document.getElementById(id);
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
      $('micShuffleSourceSel').value = 'random';

      const check = async (label, menuBtnId, menuId, act) => {
        $(menuBtnId).click();
        await frames(2);
        const before = [...activeModes];
        act();
        await frames(2);
        const out = { label, open: $(menuId).classList.contains('show'),
                      changed: JSON.stringify(before) !== JSON.stringify(activeModes) };
        document.querySelectorAll('.dock-dd.show').forEach(m => m.classList.remove('show'));
        return out;
      };

      return [
        // Looks 菜单里的 🎲 —— 人就站在这个菜单里点的，留着才能连点几次重掷
        await check('looks-random', 'looksMenuBtn', 'looksMenu', () => $('randomBtn').click()),
        await check('next-look',    'looksMenuBtn', 'looksMenu', () => $('nextLookBtn').click()),
        // 快捷键 / MIDI 的 Random Shuffle：手根本不在选单上
        await check('midi-random',  'bg3DMenuBtn',  'bg3DMenu',
          () => MIDI_ACTIONS.find(a => a.key === 'randomShuffle').fn())
      ];
    }, primeAudio.toString());

    for (const r of res) {
      expect(r.changed, `${r.label} 没换 mode，这一条没在测东西`).toBe(true);
      expect(r.open, `${r.label} 把开着的选单收起来了`).toBe(true);
    }
  });
});

test('回归：你自己动手关选单的那三种方式仍然有效', async () => {
  await withApp('stayopen-4', async (win) => {
    const res = await win.evaluate(async (prime) => {
      eval('(' + prime + ')')();
      const $ = id => document.getElementById(id);
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });

      // 1. 点选单外面
      $('bg3DMenuBtn').click(); await frames(2);
      document.body.click(); await frames(2);
      const afterOutsideClick = $('bg3DMenu').classList.contains('show');

      // 2. 再按一次那个按钮
      $('bg3DMenuBtn').click(); await frames(2);
      const reopened = $('bg3DMenu').classList.contains('show');
      $('bg3DMenuBtn').click(); await frames(2);
      const afterSecondClick = $('bg3DMenu').classList.contains('show');

      // 3. Esc
      $('bg3DMenuBtn').click(); await frames(2);
      const openBeforeEsc = $('bg3DMenu').classList.contains('show');   // 先确认真的开着，否则下一句在测空气
      // Esc 是整条链的最后一格，前面任何一格中了它就轮不到 —— 断言失败时把这些一起带出来
      const escGuards = { liveBarOn, bgAdjustOn, exitSave: !!exitSaveResolve,
                          activeTag: document.activeElement && document.activeElement.tagName,
                          modePanel: modePanel.classList.contains('show'),
                          textStyle: textStylePanel.classList.contains('show'),
                          preset: presetPanel.classList.contains('show'),
                          timing: timingPanel.classList.contains('show'),
                          midi: midiPanel.classList.contains('show'),
                          help: helpPanel.classList.contains('show') };
      dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await frames(2);
      const afterEscape = $('bg3DMenu').classList.contains('show');

      /* 4. Live Bar 上的 🎲 —— 它跑的也是 randomCombo，但它自己在选单外面，
            所以这一下是「点选单外面」而不是「换 mode」，照旧关掉才对。
            拿它跟直接调 randomCombo()（不经过任何 DOM 点击）对照，证明关掉的原因
            确实是那一下点击，不是换 mode 本身。 */
      $('bg3DMenuBtn').click(); await frames(2);
      randomCombo();                       // 纯换 mode，没有任何点击
      await frames(2);
      const afterBareRandomCombo = $('bg3DMenu').classList.contains('show');
      $('liveRandomBtn').click(); await frames(2);
      const afterLiveBarClick = $('bg3DMenu').classList.contains('show');

      // 换到另一个选单时，前一个仍然要让位（drop-up 是互斥的）
      $('bg3DMenuBtn').click(); await frames(2);
      $('bgMenuBtn').click(); await frames(2);
      const exclusive = { bg3D: $('bg3DMenu').classList.contains('show'), bg: $('bgMenu').classList.contains('show') };
      document.querySelectorAll('.dock-dd.show').forEach(m => m.classList.remove('show'));

      return { afterOutsideClick, reopened, afterSecondClick, openBeforeEsc, escGuards, afterEscape,
               afterBareRandomCombo, afterLiveBarClick, exclusive };
    }, primeAudio.toString());

    expect(res.afterOutsideClick, '点选单外面没关掉').toBe(false);
    expect(res.reopened).toBe(true);
    expect(res.afterSecondClick, '再按一次按钮没关掉').toBe(false);
    expect(res.openBeforeEsc, '按 Esc 之前选单就没开着，这一条没在测东西').toBe(true);
    expect(res.afterEscape, 'Esc 没关掉，Esc 链前面的状态 = ' + JSON.stringify(res.escGuards)).toBe(false);
    // 同一个 randomCombo：不点击就留着，点 Live Bar（在选单外面）就关掉 —— 关的是点击，不是换 mode
    expect(res.afterBareRandomCombo, '光是换 mode 就把选单收起来了').toBe(true);
    expect(res.afterLiveBarClick, '点了选单外面的 Live Bar，选单却没关').toBe(false);
    expect(res.exclusive.bg3D, '开新选单时旧的没让位').toBe(false);
    expect(res.exclusive.bg).toBe(true);
  });
});

test('打开大面板/帮助这类整屏的东西时，drop-up 仍然要让位', async () => {
  await withApp('stayopen-5', async (win) => {
    const res = await win.evaluate(async (prime) => {
      eval('(' + prime + ')')();
      const $ = id => document.getElementById(id);
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });

      $('bg3DMenuBtn').click(); await frames(2);
      openModePanel(); await frames(2);
      const afterModePanel = { dd: $('bg3DMenu').classList.contains('show'), panel: modePanel.classList.contains('show') };
      closeModePanel();

      $('bg3DMenuBtn').click(); await frames(2);
      openHelpPanel(); await frames(2);
      const afterHelp = { dd: $('bg3DMenu').classList.contains('show'), panel: helpPanel.classList.contains('show') };
      closeHelpPanel();
      document.querySelectorAll('.dock-dd.show').forEach(m => m.classList.remove('show'));

      return { afterModePanel, afterHelp };
    }, primeAudio.toString());

    expect(res.afterModePanel.panel).toBe(true);
    expect(res.afterModePanel.dd, '大面板盖上来了，drop-up 还留着').toBe(false);
    expect(res.afterHelp.panel).toBe(true);
    expect(res.afterHelp.dd, '帮助面板盖上来了，drop-up 还留着').toBe(false);
  });
});
