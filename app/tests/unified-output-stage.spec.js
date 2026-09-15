const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 这套测试守的是「固定逻辑输出舞台 + 自适应编辑预览」这个架构本身：
     - 右侧面板/Dock 打开关闭只能改变编辑器里的预览缩放，不能改变逻辑分辨率、
       不能挪动已保存的 transform、也不能让 Logo/文字跑出舞台或被面板压住。
     - Fullscreen 按钮能正常进出，且是编辑器 UI，不进录制。
     - 录制中开关面板不能碰录制缓冲区。
   历史 bug：面板打开曾经真的把 visualStage 逻辑宽度压窄 300px（不是遮挡），
   Logo 是纯 canvas 内容、靠 CX+logoOffX 定位，画布收窄后跟着跑出可视范围，
   于是被面板/画布边缘裁掉——根因是逻辑分辨率不该随编辑器 UI 变化。 */

async function launch(label) {
  const dir = newUserDataDir(label);
  const app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
  const win = await app.firstWindow();
  await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
  await win.evaluate(() => document.getElementById('intro')?.classList.add('hidden'));
  return { app, win, dir };
}

test('面板打开只改变编辑预览缩放，不改变逻辑输出舞台尺寸', async () => {
  const { app, win, dir } = await launch('stage-panel-logical');
  try {
    const before = await win.evaluate(() => ({
      w: visualStage.clientWidth, h: visualStage.clientHeight,
      W, H, scale: previewScale(),
    }));
    // 普通窗口里 Dock 本来就占掉一点高度，previewScale() 不一定是 1——这不是 bug
    // （Dock 和面板同一套"只缩预览、不动逻辑分辨率"的架构），这里只断言它是个合理正数。
    expect(before.scale).toBeGreaterThan(0.3);
    expect(before.scale).toBeLessThanOrEqual(1);

    await win.evaluate(() => document.getElementById('bgMenuBtn').click());
    await expect.poll(() => win.evaluate(() => document.getElementById('bgMenu').classList.contains('show'))).toBe(true);

    const after = await win.evaluate(() => ({
      w: visualStage.clientWidth, h: visualStage.clientHeight,
      W, H, scale: previewScale(),
      stageRect: (() => { const r = visualStage.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })(),
      panelRect: (() => { const r = document.getElementById('bgMenu').getBoundingClientRect(); return { left: r.left, top: r.top }; })(),
    }));

    // 逻辑分辨率必须原封不动——这是整个架构的核心断言。
    expect(after.w).toBe(before.w);
    expect(after.h).toBe(before.h);
    expect(after.W).toBe(before.W);
    expect(after.H).toBe(before.H);
    // 面板确实进一步吃掉了空间，预览缩放应该比开面板之前更小（否则测试本身没测到东西）。
    expect(after.scale).toBeLessThan(before.scale - 0.001);
    // 缩放后的舞台屏幕矩形必须完整落在面板左侧，不能被面板盖住一部分。
    expect(after.stageRect.right).toBeLessThanOrEqual(after.panelRect.left + 1);
  } finally {
    await closeApp(app, win);
    cleanupUserDataDir(dir);
  }
});

test('面板开关不清零/不跳位已保存的 Logo、背景、文字 transform', async () => {
  const { app, win, dir } = await launch('stage-panel-preserve');
  try {
    const before = await win.evaluate(() => {
      logoOffX = 140; logoOffY = -60; logoScale = 1.3; logoRotation = 0.2;
      // 拖拽前必须先让 bgImage 真正可见（有实际尺寸）——display:none 的元素
      // getBoundingClientRect() 全是 0，会被 clampPositionedElements() 当成"跑出界"误纠正，
      // 这不是要测的东西，只是没先加载背景图片的测试搭建问题。
      hasBgMedia = true; bgImageEl.style.display = 'block';
      bgImageEl._transform.set({ x: -80, y: 30, scale: 1.4, rotation: -0.15 });
      titleDisplay._transform?.set ? titleDisplay._transform.set({ x: 10, y: -5, scale: 1, rotation: 0 }) : null;
      return {
        logo: { logoOffX, logoOffY, logoScale, logoRotation },
        bg: bgImageEl._transform.state(),
      };
    });

    await win.evaluate(() => document.getElementById('bgMenuBtn').click());
    await expect.poll(() => win.evaluate(() => document.getElementById('bgMenu').classList.contains('show'))).toBe(true);
    await win.evaluate(() => document.getElementById('bgMenuBtn').click());
    await expect.poll(() => win.evaluate(() => document.getElementById('bgMenu').classList.contains('show'))).toBe(false);

    const after = await win.evaluate(() => ({
      logo: { logoOffX, logoOffY, logoScale, logoRotation },
      bg: bgImageEl._transform.state(),
    }));

    expect(after.logo).toEqual(before.logo);
    expect(after.bg).toEqual(before.bg);
  } finally {
    await closeApp(app, win);
    cleanupUserDataDir(dir);
  }
});

test('Logo 拖到边缘后，面板打开仍完整落在缩放后的舞台内，不被裁切', async () => {
  const { app, win, dir } = await launch('stage-panel-logo-clip');
  try {
    // 把 Logo 推到舞台右下角热区（典型的品牌水印摆法——正是截图里复现问题的用法）。
    await win.evaluate(() => {
      logoOffX = W / 2 - 90; logoOffY = H / 2 - 90; logoScale = 1;
    });
    await win.evaluate(() => document.getElementById('bgMenuBtn').click());
    await expect.poll(() => win.evaluate(() => document.getElementById('bgMenu').classList.contains('show'))).toBe(true);

    const r = await win.evaluate(() => {
      const stageRect = visualStage.getBoundingClientRect();
      const s = previewScale();
      const cxScreen = stageRect.left + ((CX + logoOffX) / W) * stageRect.width;
      const cyScreen = stageRect.top + ((CY + logoOffY) / H) * stageRect.height;
      const radiusScreen = (logoScreenR / W) * stageRect.width;
      const panelRect = document.getElementById('bgMenu').getBoundingClientRect();
      return { cxScreen, cyScreen, radiusScreen, stageRect: { left: stageRect.left, right: stageRect.right, top: stageRect.top, bottom: stageRect.bottom }, panelLeft: panelRect.left };
    });

    // 圆环整体（含半径）必须完整落在缩放后的舞台矩形内。
    expect(r.cxScreen - r.radiusScreen).toBeGreaterThanOrEqual(r.stageRect.left - 1);
    expect(r.cxScreen + r.radiusScreen).toBeLessThanOrEqual(r.stageRect.right + 1);
    expect(r.cyScreen - r.radiusScreen).toBeGreaterThanOrEqual(r.stageRect.top - 1);
    expect(r.cyScreen + r.radiusScreen).toBeLessThanOrEqual(r.stageRect.bottom + 1);
    // 舞台矩形本身不能伸进面板底下。
    expect(r.stageRect.right).toBeLessThanOrEqual(r.panelLeft + 1);
  } finally {
    await closeApp(app, win);
    cleanupUserDataDir(dir);
  }
});

test('逻辑输出舞台的计算不依赖 Dock/全屏状态——只看窗口尺寸和 aspectMode', async () => {
  const { app, win, dir } = await launch('stage-logical-dock-independent');
  try {
    const windowed = await win.evaluate(() => ({ w: visualStage.clientWidth, h: visualStage.clientHeight }));
    const fsSimulated = await win.evaluate(() => {
      // 真实 requestFullscreen() 在无头/测试环境不可靠；直接假装 Dock 已经隐藏
      // （全屏时 applyDockVisibility() 会做的事），验证逻辑分辨率计算本身不读这个状态。
      const dockEl = document.querySelector('.dock');
      const prevDisplay = dockEl.style.display;
      dockEl.style.display = 'none';
      computeLogicalStage();
      const out = { w: visualStage.clientWidth, h: visualStage.clientHeight };
      dockEl.style.display = prevDisplay;
      computeLogicalStage();
      return out;
    });
    expect(fsSimulated.w).toBe(windowed.w);
    expect(fsSimulated.h).toBe(windowed.h);
  } finally {
    await closeApp(app, win);
    cleanupUserDataDir(dir);
  }
});

test('Fullscreen 按钮：文案随状态切换，且不属于 visualStage（不会进入录制）', async () => {
  const { app, win, dir } = await launch('stage-fullscreen-btn');
  try {
    const r = await win.evaluate(() => {
      const btn = document.getElementById('fsToggleBtn');
      const menuBtn = document.getElementById('fullscreenBtn');
      const insideStage = visualStage.contains(btn);
      const normalLabel = btn.textContent;

      // document.fullscreenElement 在无头 Electron 测试里通常拿不到真的全屏状态，
      // 所以直接 mock 这个 getter，只验证「状态变了、文案就该跟着变」这条逻辑本身。
      const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'fullscreenElement');
      Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true });
      applyFullscreenBtnLabels();
      const fsLabel = btn.textContent;
      const fsMenuLabel = menuBtn.textContent;
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
      applyFullscreenBtnLabels();
      const restoredLabel = btn.textContent;
      if (desc) Object.defineProperty(document, 'fullscreenElement', desc);

      return { insideStage, normalLabel, fsLabel, fsMenuLabel, restoredLabel };
    });
    expect(r.insideStage).toBe(false);
    // 断言具体文案，不只是"变了"——只比较不等式曾经放过 t2() 查错表、退化成返回字面 key
    // 字符串（"fullscreenBtn"/"exitFullscreenBtn"）这种 bug：那种情况下两次文案依然
    // "不相等"，但都是错的。截图核验实测抓到过这个问题。
    expect(r.normalLabel).toBe('⛶ Full');
    expect(r.fsLabel).toBe('⛶ Exit Full');
    expect(r.fsLabel).toBe(r.fsMenuLabel);   // 悬浮按钮和菜单里那份文案必须同步
    expect(r.restoredLabel).toBe(r.normalLabel);
  } finally {
    await closeApp(app, win);
    cleanupUserDataDir(dir);
  }
});

test('预览已缩放时第一次拖动文字层，落点跟手（不因为缩放而跳位）', async () => {
  // ensurePositioned() 把「CSS 居中」换算成绝对 left/top 时，曾经把缩放后的屏幕矩形
  // 和未缩放的 offsetWidth 直接相减——面板打开、预览缩放不是 1 时会算出错误的落点。
  const { app, win, dir } = await launch('stage-first-drag-while-scaled');
  try {
    await win.evaluate(() => document.getElementById('bgMenuBtn').click());
    await expect.poll(() => win.evaluate(() => document.getElementById('bgMenu').classList.contains('show'))).toBe(true);
    const r = await win.evaluate(() => {
      const before = titleDisplay.getBoundingClientRect();
      const beforeCx = before.left + before.width / 2, beforeCy = before.top + before.height / 2;
      // 第一次拖动：不做位移(x:0,y:0)，只是把 CSS 居中换算成绝对定位——
      // 换算前后屏幕上的视觉中心不该跳动。
      titleDisplay._transform.set({ x: 0, y: 0, scale: 1, rotation: 0 });
      const after = titleDisplay.getBoundingClientRect();
      const afterCx = after.left + after.width / 2, afterCy = after.top + after.height / 2;
      return { dx: afterCx - beforeCx, dy: afterCy - beforeCy, scale: previewScale() };
    });
    expect(r.scale).toBeLessThan(0.999);   // 确认测试真的是在预览被缩放的状态下跑的
    expect(Math.abs(r.dx)).toBeLessThan(1.5);
    expect(Math.abs(r.dy)).toBeLessThan(1.5);
  } finally {
    await closeApp(app, win);
    cleanupUserDataDir(dir);
  }
});

test('录制中开关右侧面板不改变录制缓冲区尺寸', async () => {
  const { app, win, dir } = await launch('stage-record-panel-lock');
  try {
    const before = await win.evaluate(() => {
      enterRecordingResolution();
      return { w: cv.width, h: cv.height };
    });
    await win.evaluate(() => document.getElementById('bgMenuBtn').click());
    await expect.poll(() => win.evaluate(() => document.getElementById('bgMenu').classList.contains('show'))).toBe(true);
    const opened = await win.evaluate(() => ({ w: cv.width, h: cv.height }));
    await win.evaluate(() => document.getElementById('bgMenuBtn').click());
    await expect.poll(() => win.evaluate(() => document.getElementById('bgMenu').classList.contains('show'))).toBe(false);
    const closed = await win.evaluate(() => {
      const out = { w: cv.width, h: cv.height };
      exitRecordingResolution();
      return out;
    });
    expect(opened).toEqual(before);
    expect(closed).toEqual(before);
  } finally {
    await closeApp(app, win);
    cleanupUserDataDir(dir);
  }
});
