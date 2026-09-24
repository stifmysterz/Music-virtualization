const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

test('取消录制保存对话框后不开始录制或切换画布分辨率', async () => {
  const dir = newUserDataDir('record-picker-cancel');
  let app = null, win = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);

    const result = await win.evaluate(async () => {
      const originalPicker = window.showSaveFilePicker;
      const originalWidth = cv.width;
      let pickerCalls = 0;
      window.showSaveFilePicker = async () => {
        pickerCalls++;
        throw new DOMException('User cancelled', 'AbortError');
      };
      try {
        const started = await startRecording();
        return {
          started, pickerCalls, width:cv.width, originalWidth,
          resolutionActive:recordingResolutionActive,
          recorderCreated:mediaRecorder !== null,
          usingFileSystemWrite, isRecording
        };
      } finally {
        window.showSaveFilePicker = originalPicker;
      }
    });

    expect(result).toEqual({
      started:false, pickerCalls:1, width:result.originalWidth,
      originalWidth:result.originalWidth, resolutionActive:false,
      recorderCreated:false, usingFileSystemWrite:false, isRecording:false
    });
    await expect(win.locator('#recordingHud')).not.toHaveClass(/show/);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
});
