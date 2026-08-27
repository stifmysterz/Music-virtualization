const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');

const APP_DIR = path.join(__dirname, '..');

/* 播放控制的可发现性 + 状态同步。
 *
 * 背景：Play/Pause 按钮一直都在（dock 最左），但 .dock 是 max-width:94vw + overflow-x:auto
 * 且 ::-webkit-scrollbar{display:none} —— 窗口一窄，dock 里那十几个按钮就横向滚动，
 * Play 被滚出视野，而且完全没有滚动条提示。全屏时 applyDockVisibility() 更是直接把整个
 * dock display:none，除了空格键没有任何播放控制。用户的原话是「根本找不到按钮」。
 *
 * 另外 playing 这个标志和真实播放状态会脱节：mediaEl.play() 没有 catch，也没监听
 * pause/ended/error，从别处暂停后按钮文字就错了，再按一下等于没反应。
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
    if (app) { try { await app.close(); } catch (e) { /* 已经崩了就算了 */ } }
    try { cleanupUserDataDir(dir); } catch (e) { /* 临时目录清不掉不该让测试失败 */ }
  }
}

test('dock 横向滚动时 Play 按钮仍然钉在最左边，不会被滚出视野', async () => {
  await withApp('play-1', async (win) => {
    const res = await win.evaluate(() => {
      const dock = document.querySelector('.dock');
      const btn = document.getElementById('playBtn');
      // 把 dock 强行压窄，制造出用户窗口不够宽时的那种横向滚动
      dock.style.maxWidth = '320px';
      const scrollable = dock.scrollWidth > dock.clientWidth;
      dock.scrollLeft = dock.scrollWidth;   // 滚到最右
      const d = dock.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      return {
        scrollable,
        scrolledBy: dock.scrollLeft,
        position: getComputedStyle(btn).position,
        // 钉住的话按钮左边缘应该还贴在 dock 的内容区左侧（padding 10px 上下浮动几像素）
        offsetFromDockLeft: b.left - d.left,
        visibleWidth: Math.min(b.right, d.right) - Math.max(b.left, d.left)
      };
    });

    expect(res.scrollable).toBe(true);       // 前提：确实滚起来了，否则这条测试没有意义
    expect(res.scrolledBy).toBeGreaterThan(0);
    expect(res.position).toBe('sticky');
    expect(res.offsetFromDockLeft).toBeLessThan(20);
    // 整个按钮仍然完整可见，而不是被滚掉一半
    expect(res.visibleWidth).toBeGreaterThan(60);
  });
});

test('全屏时有独立的播放控制（dock 被隐藏后不至于没有任何按钮）', async () => {
  await withApp('play-2', async (win) => {
    const res = await win.evaluate(() => {
      const fsBtn = document.getElementById('fsPlayBtn');
      if (!fsBtn) return { exists: false };
      const readDisplay = () => getComputedStyle(fsBtn).display;

      document.body.classList.remove('is-fullscreen');
      const normal = readDisplay();
      document.body.classList.add('is-fullscreen');
      const fullscreen = readDisplay();
      document.body.classList.remove('is-fullscreen');

      // applyDockVisibility() 是唯一根据 document.fullscreenElement 决定 dock 显隐的地方，
      // is-fullscreen 这个 body class 必须由它一并维护，否则两者会各说各话
      applyDockVisibility();
      const afterApply = document.body.classList.contains('is-fullscreen');

      return {
        exists: true, normal, fullscreen,
        afterApply,
        reallyFullscreen: !!document.fullscreenElement,
        wired: typeof fsBtn.onclick === 'function'
      };
    });

    expect(res.exists).toBe(true);
    expect(res.normal).toBe('none');          // 非全屏时不该挡住画面
    expect(res.fullscreen).not.toBe('none');  // 全屏时是唯一的播放控制
    expect(res.wired).toBe(true);
    expect(res.afterApply).toBe(res.reallyFullscreen);
  });
});

test('播放状态跟真实的 media 元素同步（从别处暂停后按钮不会说谎）', async () => {
  await withApp('play-3', async (win) => {
    const res = await win.evaluate(() => {
      const el = new Audio();
      wireMediaElement(el);      // 就是 playFile() 建 mediaEl 时用的那套监听
      mediaEl = el;

      playing = true; updatePlayBtn();
      const labelWhilePlaying = document.getElementById('playBtn').textContent;

      // 模拟「从别处暂停了」——例如播放失败、播完、或系统媒体键
      el.dispatchEvent(new Event('pause'));
      const afterPause = { playing, label: document.getElementById('playBtn').textContent };

      el.dispatchEvent(new Event('play'));
      const afterPlay = { playing, label: document.getElementById('playBtn').textContent };

      el.dispatchEvent(new Event('ended'));
      const afterEnded = { playing };

      return { labelWhilePlaying, afterPause, afterPlay, afterEnded };
    });

    expect(res.afterPause.playing).toBe(false);
    expect(res.afterPause.label).not.toBe(res.labelWhilePlaying);   // 文字要跟着回到「播放」
    expect(res.afterPlay.playing).toBe(true);
    expect(res.afterPlay.label).toBe(res.labelWhilePlaying);
    expect(res.afterEnded.playing).toBe(false);
  });
});
