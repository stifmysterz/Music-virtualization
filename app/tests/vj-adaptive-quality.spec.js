const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

test('VJ Auto quality follows sustained frame time and manual tier stays fixed', async () => {
  const dir = newUserDataDir('vj-adaptive-quality');
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: path.join(__dirname, '..') });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const result = await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      enableBg3D(VJ_TUNNEL_KINDS[0]);
      const sel=document.getElementById('vjQualitySel');
      sel.value='ultra'; sel.dispatchEvent(new Event('change'));
      sel.value='auto'; sel.dispatchEvent(new Event('change'));
      vjAdaptive.lastChangeAt=0;
      resetAdaptiveVjSamples();
      for(let i=0;i<220;i++) updateAdaptiveVjQuality(100000+i*30);
      const slowed=vjQuality==='balanced' && sel.value==='auto';
      vjAdaptive.lastChangeAt=0;
      resetAdaptiveVjSamples();
      for(let i=0;i<760;i++) updateAdaptiveVjQuality(120000+i*16.7);
      const recovered=vjQuality==='ultra' && sel.options[0].textContent.includes('Ultra');
      sel.value='low'; sel.dispatchEvent(new Event('change'));
      for(let i=0;i<220;i++) updateAdaptiveVjQuality(150000+i*30);
      return {slowed,recovered,manual:vjQuality==='low'&&!vjQualityAuto};
    });
    expect(result).toEqual({slowed:true,recovered:true,manual:true});
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
});

/* 4K 录制本身就会把帧时间拉长。Auto 如果把这当成「机器太慢」去降档，就会在录制中途
   丢掉全部缓存场景重建 —— 成片里出现卡顿/闪帧，而且前后两段画质不一样。 */
test('VJ Auto quality holds its tier while recording and resumes afterwards', async () => {
  const dir = newUserDataDir('vj-adaptive-quality-rec');
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: path.join(__dirname, '..') });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const result = await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      enableBg3D(VJ_TUNNEL_KINDS[0]);
      const sel=document.getElementById('vjQualitySel');
      sel.value='ultra'; sel.dispatchEvent(new Event('change'));
      sel.value='auto'; sel.dispatchEvent(new Event('change'));
      const sceneBefore=bg3DScenes[bg3DKind];
      vjAdaptive.lastChangeAt=0;
      resetAdaptiveVjSamples();
      setRecordingUi(true);
      for(let i=0;i<400;i++) updateAdaptiveVjQuality(100000+i*30);
      const duringRecording={tier:vjQuality, sameScene:bg3DScenes[bg3DKind]===sceneBefore};
      setRecordingUi(false);
      // 录制期间攒下的慢帧不能带到录制之后：停录后的前几帧不该立刻触发降档
      for(let i=0;i<5;i++) updateAdaptiveVjQuality(120000+i*30);
      const rightAfter=vjQuality;
      for(let i=0;i<220;i++) updateAdaptiveVjQuality(121000+i*30);
      return {duringRecording, rightAfter, afterRecording:vjQuality};
    });
    expect(result).toEqual({
      duringRecording:{tier:'ultra', sameScene:true},
      rightAfter:'ultra',
      afterRecording:'balanced'
    });
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
});
