const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

/* 建场景时新建的贴图(CanvasTexture 之类),回收场景时必须一起释放:vjDropCachedScene 只 dispose
 * 几何和材质,贴图要么做成全局只建一次,要么挂在材质的 userData.vjOwnedMap 上让它顺手释放。
 * 否则每切一次画质、每被缓存挤掉一次就漏一张 —— 长时间演出里会一直涨。
 * 光数活着的 JS 对象不够:没 dispose 的贴图,JS 对象照样会被垃圾回收,但它在 GPU 上的那份只能等
 * 浏览器哪天回收包装对象时才释放,时机不可控。three.js 的 info.memory.textures 是「上传了、还没
 * dispose」的计数,两个都要看。
 * 做法:每条 VJ 先建一次、丢一次(让全局只建一次的贴图先建好),记下两个数;再反复建丢三次,都不能变。 */

async function liveTextures(cdp) {
  const group = 'rebuild-leak';
  await cdp.send('HeapProfiler.collectGarbage');
  const { result: proto } = await cdp.send('Runtime.evaluate', { expression: 'THREE.Texture.prototype', objectGroup: group });
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId, objectGroup: group });
  const { result } = await cdp.send('Runtime.callFunctionOn', {
    objectId: objects.objectId, functionDeclaration: 'function(){ return this.length; }', returnByValue: true,
  });
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: group });
  return result.value;
}

test('每条 VJ 反复建场景、回收场景,活着的贴图数量不增长', async () => {
  test.setTimeout(300_000);
  const dir = newUserDataDir('vj-rebuild-leak');
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: path.join(__dirname, '..') });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const cdp = await win.context().newCDPSession(win);
    const kinds = await win.evaluate(() => { document.getElementById('intro')?.classList.add('hidden'); return VJ_TUNNEL_KINDS.slice(); });
    const cycle = (kind, times) => win.evaluate(({ kind, times }) => {
      for (let n = 0; n < times; n++) {
        enableBg3D(kind);
        renderBg3D(0.5, 0.4, 0.3, 1);
        vjDropCachedScene(kind);
      }
      disableBg3D();
      return bg3DRenderer.info.memory.textures;   // GPU 上还没 dispose 的贴图
    }, { kind, times });
    const leaks = [];
    for (const kind of kinds) {
      const gpuBefore = await cycle(kind, 1);
      const before = await liveTextures(cdp);
      const gpuAfter = await cycle(kind, 3);
      const after = await liveTextures(cdp);
      if (after > before) leaks.push(`${kind}: 活着的贴图对象 +${after - before}`);
      if (gpuAfter > gpuBefore) leaks.push(`${kind}: GPU 上未释放的贴图 +${gpuAfter - gpuBefore}`);
    }
    expect(leaks, '这些隧道每重建一次就多留下贴图').toEqual([]);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
});
