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

test('2D 共用合成层把 bass、mid、high 映射到不同动作', async () => {
  await withApp('universal-2d-bands', async win => {
    const r = await win.evaluate(() => {
      const at = 913;
      return {
        quiet: computeUniversal2DBandResponse(at, 0, 0, 0, 0, 0.4),
        bass: computeUniversal2DBandResponse(at, 1, 0, 0, 0, 0),
        mid: computeUniversal2DBandResponse(at, 0, 1, 0, 0, 0.4),
        high: computeUniversal2DBandResponse(at, 0, 0, 1, 0, 0.4)
      };
    });

    expect(r.bass.scale, 'bass 没有推动缩放').toBeGreaterThan(r.quiet.scale + 0.015);
    expect(r.bass.y, 'bass 没有推动上下冲击').toBeLessThan(r.quiet.y);
    expect(Math.abs(r.mid.x - r.quiet.x), 'mid 没有推动横向摇摆').toBeGreaterThan(0.2);
    expect(Math.abs(r.mid.rotation - r.quiet.rotation), 'mid 没有推动滚转').toBeGreaterThan(0.01);
    expect(r.high.brightness, 'high 没有推动亮度').toBeGreaterThan(r.quiet.brightness + 0.02);
    expect(r.high.contrast, 'high 没有推动对比度').toBeGreaterThan(r.quiet.contrast + 0.02);
  });
});

test('全部 2D effects 都经过三频共用层，原有效果数量不变', async () => {
  await withApp('universal-all-2d', async win => {
    const result = await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      twoDMotion = 'off'; twoDDirectorOn = false; twoDGradeOn = false;
      musicState.bassEnvelope = 0.82;
      musicState.midEnvelope = 0.73;
      musicState.highEnvelope = 0.91;
      musicState.beatPhase = 0;
      musicState.onset = false;
      twoDImpact = 0;
      const failed = [];
      for(let i=0; i<MODES.length; i++){
        activeModes = [i];
        const pos = getModePos(i);
        pos.useBass = pos.useMid = pos.useHigh = true;
        applyTwoDPost(913, 1);
        const transform = cvFx.style.transform;
        const filter = cvFx.style.filter;
        if(!transform.includes('scale(') || !transform.includes('rotate(') ||
           !filter.includes('brightness(') || !filter.includes('contrast(')) failed.push(MODES[i]);
      }
      return { count: MODES.length, failed };
    });

    expect(result.count, '2D effects 被删除或减少了').toBeGreaterThanOrEqual(200);
    expect(result.failed, `这些 2D effects 没经过共用三频层: ${result.failed.join(', ')}`).toEqual([]);
  });
});

test('普通 3D 与 VJ 都走同一个 bass/mid/high 共用渲染层', async () => {
  await withApp('universal-3d-vj', async win => {
    const result = await win.evaluate(async () => {
      document.getElementById('intro')?.classList.add('hidden');
      const frame = () => new Promise(r => requestAnimationFrame(r));
      const probe = async kind => {
        enableBg3D(kind);
        await frame();
        const scene = bg3DScenes[kind];
        beat = 0;
        renderBg3D(0, 0, 0, 1);
        const quietZoom = scene.camera.zoom;
        renderBg3D(1, 0, 0, 1);
        const bassZoom = scene.camera.zoom;
        renderBg3D(0, 1, 1, 1);
        const filter = bgThreeCanvas.style.filter;
        return { kind, quietZoom, bassZoom, filter };
      };
      const regular = await probe(BG3D_ORDER[0]);
      const vj = await probe(VJ_TUNNEL_KINDS[VJ_TUNNEL_KINDS.length - 1]);
      disableBg3D();
      return {
        regular, vj,
        regularCount: BG3D_ORDER.length,
        vjCount: VJ_TUNNEL_KINDS.length,
        sharedRenderer: renderBg3D.toString()
      };
    });

    expect(result.regularCount, '普通 3D effects 被删除或减少了').toBeGreaterThanOrEqual(100);
    expect(result.vjCount, 'VJ effects 被删除或减少了').toBeGreaterThanOrEqual(40);
    for(const row of [result.regular, result.vj]){
      expect(row.bassZoom, `${row.kind}: bass 没有推动镜头`).toBeGreaterThan(row.quietZoom + 0.1);
      expect(row.filter, `${row.kind}: 没有 high 亮度反应`).toMatch(/brightness\(/);
      expect(row.filter, `${row.kind}: 没有 mid/high 色相反应`).toMatch(/hue-rotate\((?!0(?:\.0+)?deg)/);
    }
    expect(result.sharedRenderer).toContain('s.camera.rotation.z += sway * mid');
    expect(result.sharedRenderer).toContain('applyBg3DFilter(mid, high');
  });
});
