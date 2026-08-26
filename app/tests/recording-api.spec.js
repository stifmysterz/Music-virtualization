const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const APP_DIR = path.join(__dirname, '..');

// showSaveFilePicker 的有无是本任务要查明的事实，因此不对它断言，只打印。
// 但 captureStream 和 WebM 编码是录制功能的硬前提——它们必须成立，所以断言。
test('探测录制相关 API 在 Electron 渲染进程中的可用性', async () => {
  const app = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win = await app.firstWindow();

  const caps = await win.evaluate(() => ({
    showSaveFilePicker: typeof window.showSaveFilePicker,
    MediaRecorder: typeof window.MediaRecorder,
    captureStream: typeof document.createElement('canvas').captureStream,
    vp9Opus: window.MediaRecorder
      ? MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      : null,
    webm: window.MediaRecorder
      ? MediaRecorder.isTypeSupported('video/webm')
      : null,
  }));

  console.log('\n===== 录制能力探测结果 =====');
  console.log(JSON.stringify(caps, null, 2));
  console.log('============================\n');

  await app.close();

  // 录制功能的硬前提：这两条不成立的话，问题比 spec 5.2 严重得多
  expect(caps.captureStream, 'canvas.captureStream 不可用，录制无法工作').toBe('function');
  expect(caps.MediaRecorder, 'MediaRecorder 不可用，录制无法工作').toBe('function');
  expect(
    caps.vp9Opus || caps.webm,
    'Electron 不支持任何 WebM 编码，录制无法出片'
  ).toBe(true);

  // showSaveFilePicker 刻意不断言——它的取值就是本任务要查明的事实
});
