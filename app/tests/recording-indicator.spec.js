const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

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

test('录制成功开始后显示动态 REC bar、已录时间，停止后自动收起', async () => {
  await withApp('recording-indicator-state', async win => {
    const initial = await win.evaluate(() => ({
      visible:document.getElementById('recordingHud').classList.contains('show'),
      elapsed:document.getElementById('recordingElapsed').textContent
    }));
    expect(initial).toEqual({ visible:false, elapsed:'00:00' });

    // Route through the real Record button handler while replacing only the slow encoder setup.
    await win.evaluate(() => {
      window.__originalStartRecording = startRecording;
      startRecording = async () => true;
      document.getElementById('recordBtn').click();
    });
    await expect(win.locator('#recordingHud')).toHaveClass(/show/);
    await expect(win.locator('#recordBtn')).toHaveText(/Stop/);
    await expect.poll(() => win.locator('#recordingElapsed').textContent(), { timeout:5_000 }).toMatch(/^00:0[1-9]$/);

    const animation = await win.evaluate(() => ({
      sweep:getComputedStyle(document.querySelector('.recording-sweep')).animationName,
      dot:getComputedStyle(document.querySelector('.recording-dot')).animationName,
      timerRunning:recordingHudTimer!==null
    }));
    expect(animation).toEqual({ sweep:'recordSweep', dot:'recordDot', timerRunning:true });

    await win.evaluate(() => document.getElementById('recordBtn').click());
    await expect(win.locator('#recordingHud')).not.toHaveClass(/show/);
    await expect(win.locator('#recordBtn')).toHaveText(/Record/);
    expect(await win.evaluate(() => ({ elapsed:document.getElementById('recordingElapsed').textContent, timer:recordingHudTimer })))
      .toEqual({ elapsed:'00:00', timer:null });
  });
});

test('录制提示跟随语言，并且不会烧进 composite 视频画面', async () => {
  await withApp('recording-indicator-overlay', async win => {
    const result = await win.evaluate(() => {
      setRecordingUi(true);
      applyLanguage('zh');
      const drawn = [];
      const original = drawCaptureElement;
      drawCaptureElement = function(el, targetRect, replacedElement){
        drawn.push(el.id);
        return original(el, targetRect, replacedElement);
      };
      try { composeCaptureFrame(); } finally { drawCaptureElement = original; }
      const snapshot = {
        label:document.getElementById('recordingHudLabel').textContent,
        aria:document.getElementById('recordingHud').getAttribute('aria-label'),
        drawn
      };
      setRecordingUi(false);
      return snapshot;
    });
    expect(result.label).toBe('录制中');
    expect(result.aria).toBe('正在录制');
    expect(result.drawn).not.toContain('recordingHud');
  });
});

test('MediaRecorder 没有真正启动时不显示假的录制状态', async () => {
  await withApp('recording-indicator-failure', async win => {
    const result = await win.evaluate(async () => {
      const original = cv.captureStream;
      cv.captureStream = null;
      const started = await startRecording();
      cv.captureStream = original;
      return { started, isRecording, visible:document.getElementById('recordingHud').classList.contains('show') };
    });
    expect(result).toEqual({ started:false, isRecording:false, visible:false });
  });
});
