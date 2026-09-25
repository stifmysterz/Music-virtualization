const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

/* 长时间演出：VJ 自动轮换 + 空闲预热 + 按拍淡入淡出 + Auto 画质来回切档。
 * 这几条路径都会反复建场景、丢场景，而 bg3d-performance-budget 那条只覆盖普通 enableBg3D。
 *
 * 曾经实测到的泄漏：内嵌 three.js r149 的 UnrealBloomPass.dispose() 漏了亮部提取材质，
 * 它留在 WebGLShaderCache 里，还拽着 bloom 渲染目标的纹理 —— 每回收一个带 bloom 的
 * 场景就多一个 ShaderMaterial + 一个 Texture，960 次切换涨 1.9 MB，而且不会趋平。
 *
 * 堆总量会被 V8 JIT 编译代码抬高、不适合当断言；这里直接数活着的 ShaderMaterial / Texture
 * 对象（CDP Runtime.queryObjects），两个同相位采样点之间不应该随切换次数增长。 */

async function liveCount(cdp, protoExpr) {
  const group = 'soak-count';
  await cdp.send('HeapProfiler.collectGarbage');
  const { result: proto } = await cdp.send('Runtime.evaluate', { expression: protoExpr, objectGroup: group });
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId, objectGroup: group });
  const { result } = await cdp.send('Runtime.callFunctionOn', {
    objectId: objects.objectId, functionDeclaration: 'function(){ return this.length; }', returnByValue: true,
  });
  // 查询结果数组本身会强引用这些对象，不释放的话下一次计数会把它们算进去
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: group });
  return result.value;
}

test('VJ 长时间自动轮换 + 预热 + 切档后，材质、纹理和 GPU 资源不随切换次数增长', async () => {
  test.setTimeout(300_000);
  const dir = newUserDataDir('vj-long-session-soak');
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: path.join(__dirname, '..') });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const cdp = await win.context().newCDPSession(win);

    await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      seedBg3DBuilds(0x50AC);
      enableBg3D(VJ_TUNNEL_KINDS[0]);
      document.getElementById('vjShuffleIntervalSel').value = 'change';   // 不开定时器，由测试逐步驱动
      setVjShuffle(true);
      window.__soakStep = 0;
    });
    // 每 40 次切换换一次画质档（丢掉全部场景重建）；采样点都落在切档之后、同一档上
    const run = n => win.evaluate(async n => {
      const idle = ms => new Promise(r => setTimeout(r, ms));
      const tiers = ['balanced', 'ultra', 'low'];
      for (let k = 0; k < n; k++) {
        const step = ++window.__soakStep;
        runVjShuffleTick();
        updateVjAutoSwitch(performance.now() + 1000);   // 越过 750ms 的等拍兜底
        updateVjAutoSwitch(performance.now() + 5000);   // 走完淡出
        renderBg3D(0.5, 0.4, 0.3, 1);
        await idle(30);                                  // 让 requestIdleCallback 里的预热跑起来
        if (step % 40 === 0) setVjQualityTier(tiers[(step / 40) % 3]);
      }
      await idle(300);
      const info = bg3DRenderer.info;
      return { step: window.__soakStep, tier: vjQuality, scenes: Object.keys(bg3DScenes).length,
        geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs.length,
        alpha: bg3DAlphaPasses.length, grade: bg3DGradePasses.length };
    }, n);
    const count = async () => ({
      shaderMaterials: await liveCount(cdp, 'THREE.ShaderMaterial.prototype'),
      textures: await liveCount(cdp, 'THREE.Texture.prototype'),
    });

    const gpuA = await run(120);
    const objA = await count();
    const gpuB = await run(360);
    const objB = await count();
    console.log(`step ${gpuA.step} → ${gpuB.step}  ShaderMaterial ${objA.shaderMaterials} → ${objB.shaderMaterials}  ` +
                `Texture ${objA.textures} → ${objB.textures}  programs ${gpuA.programs} → ${gpuB.programs}`);

    expect(gpuA.tier).toBe(gpuB.tier);   // 同一档上比较才有意义
    // 360 次切换里建了几百个场景；漏的话会多出同样数量级的对象，这里只留一点抖动余量
    expect(objB.shaderMaterials - objA.shaderMaterials, 'ShaderMaterial 随切换累积 —— 有 pass 的材质没被 dispose').toBeLessThanOrEqual(4);
    expect(objB.textures - objA.textures, 'Texture 随切换累积').toBeLessThanOrEqual(4);
    for (const g of [gpuA, gpuB]) {
      expect(g.scenes).toBeLessThanOrEqual(8);
      expect(g.alpha).toBeLessThanOrEqual(8);
      expect(g.grade).toBeLessThanOrEqual(8);
    }
    expect(gpuB.geometries).toBeLessThanOrEqual(gpuA.geometries + 8);
    expect(gpuB.textures).toBeLessThanOrEqual(gpuA.textures + 4);
    expect(gpuB.programs).toBeLessThanOrEqual(gpuA.programs + 6);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
});
