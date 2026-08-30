const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 这个软件会装到配置差别很大的机器上，所以「够不够快」不能在开发机上一次测定就写死。
 *
 * 实测（Intel UHD 620，叠 3 个 mode + 录制合成）：
 *     4K 15.0fps / 1440p 31.6fps / 1080p 53.3fps
 * 换台带独显的机器数字会完全不同 —— 所以给的是两个旋钮，不是一个我猜出来的默认值：
 *   · 录制画质可选 4K / 1440p / 1080p（默认仍是 4K，不改变已有用户的行为）
 *   · 帧率读数带颜色分档，录制掉帧时直接说该怎么办
 */

/* 这两个按钮住在 Tools 下拉里，菜单不打开就点不到 —— 顺带也验证了它们确实在菜单里 */
async function openTools(win){
  await win.locator('#moreMenuBtn').click();
  await expect(win.locator('#moreMenu')).toHaveClass(/show/);
}

async function withApp(label, fn, dirOverride) {
  const dir = dirOverride || newUserDataDir(label);
  let app = null, win = null;
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${dir}`, '--disable-background-timer-throttling',
             '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
      cwd: APP_DIR
    });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.webContents.setBackgroundThrottling(false); w.show(); w.focus();
    });
    await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      const rp = document.getElementById('restorePrompt'); if (rp) rp.style.display = 'none';
    });
    await fn(win, app);
  } finally {
    await closeApp(app, win);
    if (!dirOverride) { try { cleanupUserDataDir(dir); } catch (e) {} }
  }
  return dir;
}

test('录制画质三档循环，而且真的改变录制缓冲区的尺寸', async () => {
  test.setTimeout(180_000);
  await withApp('recq', async (win) => {
    await openTools(win);
    const btn = win.locator('#recordQualityBtn');
    await expect(btn).toHaveText(/4K/);
    expect(await win.evaluate(() => recordDims())).toEqual([3840, 2160]);

    // 进录制分辨率后，画布缓冲区要跟着选的档走（CSS 显示尺寸不动）
    const dims = await win.evaluate(() => {
      const out = [];
      for (const q of ['4k', '1440p', '1080p']) {
        recordQuality = q;
        enterRecordingResolution();
        out.push([cv.width, cv.height, cvFx.width, cvFx.height, cvBack.width, cvBack.height]);
        exitRecordingResolution();
      }
      recordQuality = '4k';
      return out;
    });
    expect(dims[0]).toEqual([3840, 2160, 3840, 2160, 3840, 2160]);
    expect(dims[1]).toEqual([2560, 1440, 2560, 1440, 2560, 1440]);
    expect(dims[2]).toEqual([1920, 1080, 1920, 1080, 1920, 1080]);

    // 点击循环 4K -> 1440p -> 1080p -> 4K
    await btn.click(); await expect(btn).toHaveText(/1440p/);
    await btn.click(); await expect(btn).toHaveText(/1080p/);
    await btn.click(); await expect(btn).toHaveText(/4K/);

    // 切语言时标签跟着变（走的是 STATEFUL_LABELS，不是点击时写死的文字）
    await btn.click();   // 1440p
    await win.evaluate(() => applyLanguage('zh'));
    await expect(btn).toHaveText(/录制画质.*1440p/);
    await win.evaluate(() => applyLanguage('en'));
    await expect(btn).toHaveText(/Quality.*1440p/);
  });
});

test('录制中改画质会被挡住 —— 缓冲区尺寸一变，captureStream 的轨道就对不上了', async () => {
  test.setTimeout(180_000);
  await withApp('recq-lock', async (win) => {
    const alerts = [];
    win.on('dialog', d => { alerts.push(d.message()); d.dismiss().catch(() => {}); });
    await openTools(win);
    await win.evaluate(() => { isRecording = true; });
    await win.locator('#recordQualityBtn').click();
    await expect.poll(() => alerts.length).toBeGreaterThan(0);
    expect(await win.evaluate(() => recordQuality), '录制中画质不该被改掉').toBe('4k');
    await win.evaluate(() => { isRecording = false; });
  });
});

test('画质选择要能记住 —— 换台机器选一次就够了，不是每次开都得重选', async () => {
  test.setTimeout(240_000);
  const dir = newUserDataDir('recq-persist');
  try {
    await withApp('recq-persist', async (win) => {
      await openTools(win);
      await win.locator('#recordQualityBtn').click();   // -> 1440p
      await expect(win.locator('#recordQualityBtn')).toHaveText(/1440p/);
    }, dir);
    await withApp('recq-persist', async (win) => {
      await openTools(win);
      await expect(win.locator('#recordQualityBtn'), '重开之后画质没记住').toHaveText(/1440p/);
      expect(await win.evaluate(() => recordDims())).toEqual([2560, 1440]);
    }, dir);
  } finally {
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
});

test('帧率读数：默认关，打开后显示真实帧率并按快慢变色', async () => {
  test.setTimeout(180_000);
  await withApp('fps', async (win) => {
    await openTools(win);
    const hud = win.locator('#fpsHud');
    const btn = win.locator('#fpsHudBtn');
    await expect(hud).toBeHidden();
    await expect(btn).toHaveText(/Off/);

    await btn.click();
    await expect(hud).toBeVisible();
    await expect(btn).toHaveText(/On/);

    // 半秒一更新，等它出数
    await expect.poll(() => win.evaluate(() => document.getElementById('fpsHudNum').textContent),
                      { timeout: 10_000 }).toMatch(/^\d+ FPS$/);
    const shown = await win.evaluate(() => ({
      num: document.getElementById('fpsHudNum').textContent,
      color: document.getElementById('fpsHudNum').style.color,
      res: document.getElementById('fpsHudRes').textContent,
      value: fpsValue,
    }));
    console.log(`  读数：${shown.num}  ${shown.res}  颜色 ${shown.color}`);
    // 空闲的应用应该跑得动，读数要落在合理范围（不是 0，也不会超过刷新率太多）
    expect(shown.value).toBeGreaterThan(20);
    expect(shown.value).toBeLessThan(130);
    // 分辨率那行要跟当前画布对得上
    expect(shown.res).toMatch(/^\d+×\d+/);
    // 颜色是判断，不是让人自己解读数字：>=50 绿 / >=30 黄 / 否则红
    const expected = shown.value >= 50 ? 'rgb(91, 224, 138)' : shown.value >= 30 ? 'rgb(255, 207, 77)' : 'rgb(255, 107, 107)';
    expect(shown.color).toBe(expected);

    await btn.click();
    await expect(hud).toBeHidden();
  });
});

test('录制掉帧时才给建议，而且到了最低档就改口 —— 那时候瓶颈不在画质上', async () => {
  test.setTimeout(180_000);
  await withApp('fps-tip', async (win) => {
    await openTools(win);
    await win.locator('#fpsHudBtn').click();
    const tip = win.locator('#fpsHudTip');

    // 没在录制：再慢也不提示，平时掉几帧不值得打扰人
    await win.evaluate(() => {
      recordingResolutionActive = false;
      fpsValue = 10; fpsFrames = 999; fpsWindowStart = performance.now() - 5000;
      updateFpsHud(performance.now());
    });
    await expect(tip, '没在录制却弹了建议').toBeHidden();

    // 录制中 + 掉帧 + 还不是最低档 -> 建议调低画质
    const atQuality = await win.evaluate(() => {
      recordingResolutionActive = true; recordQuality = '4k';
      fpsFrames = 20; fpsWindowStart = performance.now() - 1000;   // 20fps
      updateFpsHud(performance.now());
      const el = document.getElementById('fpsHudTip');
      return { shown: el.style.display, text: el.textContent, res: document.getElementById('fpsHudRes').textContent };
    });
    expect(atQuality.shown).toBe('block');
    expect(atQuality.text).toMatch(/lower Quality/i);
    expect(atQuality.res, '录制中要标出来').toMatch(/recording/);

    // 已经是 1080p 还掉帧 -> 别再劝调画质了，改说少开几个 mode
    const atFloor = await win.evaluate(() => {
      recordQuality = '1080p';
      fpsFrames = 20; fpsWindowStart = performance.now() - 1000;
      updateFpsHud(performance.now());
      return document.getElementById('fpsHudTip').textContent;
    });
    expect(atFloor).toMatch(/fewer modes/i);

    // 录制中但帧率正常 -> 不打扰
    const ok = await win.evaluate(() => {
      fpsFrames = 60; fpsWindowStart = performance.now() - 1000;   // 60fps
      updateFpsHud(performance.now());
      return document.getElementById('fpsHudTip').style.display;
    });
    expect(ok, '帧率正常还在提示').toBe('none');

    await win.evaluate(() => { recordingResolutionActive = false; recordQuality = '4k'; });
  });
});
