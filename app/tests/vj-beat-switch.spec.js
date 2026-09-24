const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

test('VJ auto shuffle waits for a beat and fades the outgoing frame in preview and capture', async () => {
  const dir = newUserDataDir('vj-beat-switch');
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: path.join(__dirname, '..') });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      enableBg3D(VJ_TUNNEL_KINDS[0]);
      renderBg3D(0.4, 0.4, 0.4, 1);
      setVjShuffle(true);
    });
    await expect.poll(() => win.evaluate(() => vjPreparedKind && !!bg3DScenes[vjPreparedKind])).toBe(true);
    const result = await win.evaluate(() => {
      const prepared = vjPreparedKind;
      const preparedBeforeSwitch = prepared !== bg3DKind && Object.keys(bg3DScenes).length <= BG3D_SCENE_CACHE_LIMIT;
      musicState.onset = false;
      musicState.beatPhase = 0.8;
      runVjShuffleTick();
      const original = bg3DKind;
      const selectedPrepared = vjPendingSwitch?.target === prepared;
      updateVjAutoSwitch(performance.now());
      const waited = bg3DKind === original && !!vjPendingSwitch;
      musicState.beatPhase = 0.01;
      updateVjAutoSwitch(performance.now());
      const switched = bg3DKind !== original && vjTransitionFrame.style.display === 'block';
      const captureVisible = !!(hasBg3D && bg3DVisible && vjTransitionFrame.style.display !== 'none');
      updateVjAutoSwitch(vjTransitionStart + VJ_TRANSITION_MS + 1);
      const finished = vjTransitionFrame.style.display === 'none';
      setVjShuffle(false);
      return { preparedBeforeSwitch, selectedPrepared, waited, switched, captureVisible, finished };
    });
    expect(result).toEqual({ preparedBeforeSwitch:true, selectedPrepared:true, waited:true, switched:true, captureVisible:true, finished:true });
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
});
