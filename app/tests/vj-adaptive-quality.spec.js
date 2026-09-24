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
