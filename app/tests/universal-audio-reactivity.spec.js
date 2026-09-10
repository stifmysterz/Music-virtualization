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

test('全部 2D effects 不再被三频共用层统一缩放、摇摆或调色', async () => {
  await withApp('no-universal-2d-bands', async win => {
    const result = await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      twoDMotion = 'off'; twoDDirectorOn = false; twoDGradeOn = false;
      musicState.bassEnvelope = 0.82;
      musicState.midEnvelope = 0.73;
      musicState.highEnvelope = 0.91;
      musicState.beatPhase = 0;
      musicState.onset = true;
      twoDImpact = 0;
      const failed = [];
      for(let i=0; i<MODES.length; i++){
        activeModes = [i];
        applyTwoDPost(913, 1);
        const transform = cvFx.style.transform;
        const filter = cvFx.style.filter;
        if(transform !== 'translateX(-50%)' || filter !== 'none') failed.push(MODES[i]);
      }
      return { count: MODES.length, failed };
    });

    expect(result.count, '2D effects 被删除或减少了').toBeGreaterThanOrEqual(200);
    expect(result.failed, `这些 2D effects 仍被共用三频层改变: ${result.failed.join(', ')}`).toEqual([]);
  });
});

test('普通 3D 与 VJ 不再被三频共用层统一改变镜头或画面滤镜', async () => {
  await withApp('no-universal-3d-vj', async win => {
    const result = await win.evaluate(async () => {
      document.getElementById('intro')?.classList.add('hidden');
      bgBounceOn = false; bg3DDirectorOn = false; bg3DCameraMotion = 'off'; dirDropPunch = 0; beat = 1;
      const frame = () => new Promise(r => requestAnimationFrame(r));
      const probe = async kind => {
        enableBg3D(kind);
        await frame();
        const scene = bg3DScenes[kind];
        scene.update = () => {};
        const shot = (bass, mid, high) => {
          const rig = scene.scene.userData.vjPremiumRig;
          if(rig) rig.state.beats = 0;
          renderBg3D(bass, mid, high, 1);
          return {zoom:scene.camera.zoom, x:scene.camera.position.x, y:scene.camera.position.y,
            roll:scene.camera.rotation.z, filter:bgThreeCanvas.style.filter};
        };
        return { kind, quiet:shot(0,0,0), loud:shot(1,1,1) };
      };
      const regular = await probe(BG3D_ORDER[0]);
      const vj = await probe(VJ_TUNNEL_KINDS[VJ_TUNNEL_KINDS.length - 1]);
      disableBg3D();
      return {
        regular, vj,
        regularCount: BG3D_ORDER.length,
        vjCount: VJ_TUNNEL_KINDS.length,
        sharedRenderer: renderBg3D.toString(),
        sharedFilter: applyBg3DFilter.toString(),
        premiumPass: applyVjPremiumPass.toString()
      };
    });

    expect(result.regularCount, '普通 3D effects 被删除或减少了').toBeGreaterThanOrEqual(100);
    expect(result.vjCount, 'VJ effects 被删除或减少了').toBeGreaterThanOrEqual(40);
    for(const row of [result.regular, result.vj]){
      expect(row.loud.zoom, `${row.kind}: bass 仍在统一缩放镜头`).toBeCloseTo(row.quiet.zoom, 6);
      expect(row.loud.x, `${row.kind}: mid 仍在统一横向摇摆`).toBeCloseTo(row.quiet.x, 6);
      expect(row.loud.y, `${row.kind}: 三频仍在统一移动镜头`).toBeCloseTo(row.quiet.y, 6);
      expect(row.loud.roll, `${row.kind}: mid 仍在统一旋转镜头`).toBeCloseTo(row.quiet.roll, 6);
      expect(row.loud.filter, `${row.kind}: high 仍在统一改变滤镜`).toBe(row.quiet.filter);
      expect(row.loud.filter).not.toContain('hue-rotate(');
    }
    expect(result.sharedRenderer).not.toContain('beat*0.16');
    expect(result.sharedRenderer).not.toContain('bass*0.15');
    expect(result.sharedFilter).not.toMatch(/\b(mid|high)\b/);
    expect(result.premiumPass).not.toMatch(/\b(bass|mid|high)\b/);
  });
});
