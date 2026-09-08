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

test('2D motion、Auto Director、Film Grade 在 Mode，See Through 继续复用 Background 控制', async () => {
  await withApp('2d-post-controls', async win => {
    const result = await win.evaluate(() => ({
      motionInMode: !!document.getElementById('twoDMotionSel')?.closest('#modeMenu'),
      directorInMode: !!document.getElementById('twoDDirectorBtn')?.closest('#modeMenu'),
      gradeInMode: !!document.getElementById('twoDGradeBtn')?.closest('#modeMenu'),
      seeThroughInBackground: !!document.getElementById('fxBlendToggle')?.closest('#bgMenu'),
      motionValues: [...document.getElementById('twoDMotionSel').options].map(o => o.value)
    }));
    expect(result).toEqual({
      motionInMode: true,
      directorInMode: true,
      gradeInMode: true,
      seeThroughInBackground: true,
      motionValues: ['off', 'shake']
    });
  });
});

test('Shake Impact 由 onset 触发、平滑衰减且不改写任何单个 2D effect', async () => {
  await withApp('2d-post-shake', async win => {
    const result = await win.evaluate(() => {
      twoDMotion = 'shake'; twoDDirectorOn = false; twoDGradeOn = false;
      twoDImpact = 0;
      musicState.onset = true; musicState.bassEnvelope = 0.8;
      applyTwoDPost(1000, 1);
      const first = { transform:cvFx.style.transform, impact:twoDImpact };
      musicState.onset = false;
      applyTwoDPost(1016.7, 1);
      return { first, secondImpact:twoDImpact, activeModes:[...activeModes] };
    });
    expect(result.first.transform).toContain('translate(');
    expect(result.first.transform).not.toBe('translateX(-50%)');
    expect(result.first.impact).toBe(1);
    expect(result.secondImpact).toBeLessThan(1);
    expect(result.activeModes.length).toBeGreaterThan(0);
  });
});

test('Auto Director 用时间窗口识别 Drop，并触发一次镜头冲击', async () => {
  await withApp('2d-post-director', async win => {
    const result = await win.evaluate(() => {
      twoDDirectorOn = true; twoDDirectorPhase = 'normal'; twoDDirectorPunch = 0;
      twoDDirectorSamples = [];
      for(let t=0;t<=4400;t+=100) twoDDirectorSamples.push({t, v:0.24});
      for(let t=4500;t<=5000;t+=100) twoDDirectorSamples.push({t, v:0.92});
      twoDDirectorLastSampleAt = 5000;
      musicState.energyEnvelope = 0.92;
      updateTwoDDirector(5051);
      return { phase:twoDDirectorPhase, punch:twoDDirectorPunch, label:document.getElementById('twoDDirectorBtn').textContent };
    });
    expect(result.phase).toBe('drop');
    expect(result.punch).toBe(1);
    expect(result.label).toContain('Drop!');
  });
});

test('Film Grade 可开关，并跟 2D 设置一起保存进 Look', async () => {
  await withApp('2d-post-grade-preset', async win => {
    const result = await win.evaluate(() => {
      twoDMotion = 'shake'; twoDDirectorOn = true; twoDGradeOn = true; fxBlendOn = true;
      musicState.onset = false;
      applyTwoDPost(1000, 1);
      const filterOn = cvFx.style.filter;
      const saved = getPresetState().twoDPost;
      twoDMotion = 'off'; twoDDirectorOn = false; twoDGradeOn = false; fxBlendOn = false;
      applyPresetState({ activeModes:[0], modePositions:{}, twoDPost:saved });
      return { filterOn, saved, restored:{twoDMotion,twoDDirectorOn,twoDGradeOn,fxBlendOn} };
    });
    expect(result.filterOn).toContain('contrast(1.12)');
    expect(result.filterOn).toContain('sepia(0.045)');
    expect(result.saved).toEqual({ motion:'shake', directorOn:true, gradeOn:true, seeThrough:true });
    expect(result.restored).toEqual({ twoDMotion:'shake', twoDDirectorOn:true, twoDGradeOn:true, fxBlendOn:true });
  });
});

test('录制 composite 对 2D 层使用 DOM-aware 路径，保留 motion、grade 和 blend', async () => {
  await withApp('2d-post-recording', async win => {
    const result = await win.evaluate(() => {
      twoDMotion = 'shake'; twoDGradeOn = true; twoDDirectorOn = false; fxBlendOn = true;
      musicState.onset = true; musicState.bassEnvelope = 0.7;
      applyTwoDPost(1234, 1);
      const seen = [];
      const original = drawCaptureElement;
      drawCaptureElement = function(el, targetRect, replacedElement){
        seen.push({ id:el.id, transform:getComputedStyle(el).transform, filter:getComputedStyle(el).filter,
          blend:captureCtx ? captureCtx.globalCompositeOperation : null });
        return original(el, targetRect, replacedElement);
      };
      try { composeCaptureFrame(); } finally { drawCaptureElement = original; }
      return seen.find(item => item.id==='cvFx');
    });
    expect(result).toBeTruthy();
    expect(result.transform).not.toBe('none');
    expect(result.filter).not.toBe('none');
    expect(result.blend).toBe('screen');
  });
});
