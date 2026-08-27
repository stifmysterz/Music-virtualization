const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 退出时询问是否保存。
 *
 * 原来关窗口只有一道守卫：录制中会确认一次，其余情况直接关掉。设定虽然每 8 秒
 * 自动存进 localStorage（下次启动问「要恢复上次的状态吗」），但用户想要的是退出时
 * 明确问一次、并且能把这一套存成命名的 Look 留在 Looks 列表里。
 *
 * 分工：命名和交互放在渲染进程（那里已经有样式、i18n 和 savePreset()），主进程只负责
 * 拦住 close、等一个结果、按结果决定关不关。
 *
 * 安全底线：渲染进程没响应（页面崩了、脚本异常、超时）时一律放行关闭 —— 和现有那道
 * 录制守卫同一个原则，绝不能把人困在一个关不掉的窗口里。
 */

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app = null, win = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win, app);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

test('confirmExitSave() 弹出浮层，默认名字带日期时间', async () => {
  await withApp('exitsave-1', async (win) => {
    const res = await win.evaluate(() => {
      if (typeof confirmExitSave !== 'function') return { missing: true };
      const before = getComputedStyle(document.getElementById('exitSavePrompt')).display;
      confirmExitSave();   // 故意不 await —— 只看浮层有没有出来
      const el = document.getElementById('exitSavePrompt');
      const input = document.getElementById('exitSaveNameIn');
      return {
        missing: false, before,
        during: getComputedStyle(el).display,
        defaultName: input.value,
        buttons: ['exitSaveYesBtn', 'exitSaveNoBtn', 'exitSaveCancelBtn'].map(i => !!document.getElementById(i))
      };
    });

    expect(res.missing).toBe(false);
    expect(res.before).toBe('none');
    expect(res.during).not.toBe('none');
    expect(res.buttons).toEqual([true, true, true]);
    expect(res.defaultName).toMatch(/\d{4}-\d{2}-\d{2}/);   // 带日期，不用自己想名字
  });
});

test('选「保存并退出」会把当前 Look 存进 Looks 列表，并回报 save', async () => {
  await withApp('exitsave-2', async (win) => {
    const res = await win.evaluate(async () => {
      // 造一个能认出来的状态，验证存下去的确实是当前这套
      activeModes = [MODES.indexOf('starfield')]; focusModeIdx = activeModes[0];
      refreshModePanelActive();

      const p = confirmExitSave();
      document.getElementById('exitSaveNameIn').value = 'my exit look';
      document.getElementById('exitSaveYesBtn').click();
      const answer = await p;

      const raw = localStorage.getItem(PRESET_PREFIX + 'my exit look');
      return {
        answer,
        saved: !!raw,
        savedModes: raw ? JSON.parse(raw).activeModes : null,
        expected: [MODES.indexOf('starfield')],
        hidden: getComputedStyle(document.getElementById('exitSavePrompt')).display
      };
    });

    expect(res.answer).toBe('save');
    expect(res.saved).toBe(true);
    expect(res.savedModes).toEqual(res.expected);
    expect(res.hidden).toBe('none');
  });
});

test('选「不保存退出」不写任何 Look，回报 discard；选「取消」回报 cancel', async () => {
  await withApp('exitsave-3', async (win) => {
    const res = await win.evaluate(async () => {
      const countLooks = () => Object.keys(localStorage).filter(k => k.startsWith(PRESET_PREFIX)).length;

      const before = countLooks();
      let p = confirmExitSave();
      document.getElementById('exitSaveNameIn').value = 'should not exist';
      document.getElementById('exitSaveNoBtn').click();
      const discard = await p;
      const afterDiscard = countLooks();

      p = confirmExitSave();
      document.getElementById('exitSaveCancelBtn').click();
      const cancel = await p;

      return { discard, cancel, before, afterDiscard,
               strayLook: !!localStorage.getItem(PRESET_PREFIX + 'should not exist') };
    });

    expect(res.discard).toBe('discard');
    expect(res.cancel).toBe('cancel');
    expect(res.afterDiscard).toBe(res.before);
    expect(res.strayLook).toBe(false);
  });
});

test('名字留空时用默认名，不会存出一个没有名字的 Look', async () => {
  await withApp('exitsave-4', async (win) => {
    const res = await win.evaluate(async () => {
      const p = confirmExitSave();
      const fallback = document.getElementById('exitSaveNameIn').value;
      document.getElementById('exitSaveNameIn').value = '   ';   // 只有空格
      document.getElementById('exitSaveYesBtn').click();
      await p;
      return {
        fallback,
        savedUnderFallback: !!localStorage.getItem(PRESET_PREFIX + fallback),
        savedUnderBlank: !!localStorage.getItem(PRESET_PREFIX + '') ||
                         !!localStorage.getItem(PRESET_PREFIX + '   ')
      };
    });

    expect(res.savedUnderFallback).toBe(true);
    expect(res.savedUnderBlank).toBe(false);
  });
});

test('浮层文字跟随界面语言', async () => {
  await withApp('exitsave-5', async (win) => {
    const res = await win.evaluate(() => {
      const read = () => document.getElementById('exitSavePromptText').textContent;
      applyLanguage('zh');
      const zh = read();
      applyLanguage('en');
      const en = read();
      return { zh, en };
    });

    expect(res.zh).not.toBe(res.en);
    expect(res.zh.length).toBeGreaterThan(0);
    expect(res.en.length).toBeGreaterThan(0);
  });
});

test('主进程的关闭守卫会走这个流程，且渲染进程失灵时仍然放得掉窗口', async () => {
  const fs = require('fs');
  const mainSrc = fs.readFileSync(path.join(APP_DIR, 'main.js'), 'utf8');

  // 关闭时确实会去问渲染进程要不要保存
  expect(mainSrc).toContain('confirmExitSave');
  // 录制那道守卫仍在最前面，先问录制再问保存
  expect(mainSrc.indexOf('isRecording')).toBeLessThan(mainSrc.indexOf('confirmExitSave'));
  // 兜底：查询失败/超时一律放行关闭，绝不能把人困住
  expect(mainSrc).toMatch(/catch\s*\(/);
  expect(mainSrc).toContain('EXIT_PROMPT_TIMEOUT_MS');
});
