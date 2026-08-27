const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 离屏图层画布的内存占用。
 *
 * 每个特效画在自己的离屏画布上（getLayerCtx），画布按 mode 索引缓存在 layerCanvases 里。
 * 原来这个缓存只增不减 —— 用过的特效永远留着一张全屏画布。实测：
 *     每张 3.08 MB（1352×597）
 *     自动轮换 60 次后   164 张 =  505 MB
 *     241 个特效全过一遍 241 张 =  742 MB
 * 录制时画布会切到 3840×2160，每张 33.2 MB，同样的轮换就是几个 GB。
 * 自动轮换本来就藏在 Looks 菜单里少有人用，现在挪到了 Mode 菜单，撞上的概率大增。
 *
 * 非活跃的层可以安全丢掉：layerCanvases 只有两个消费者 —— getLayerCtx 自己，
 * 以及 hitTestMode（它只遍历 activeModes 里的层）。转场快照拿的是 #cvFx，不是这些层。
 */

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

function primeAudio() {
  document.getElementById('intro')?.classList.add('hidden');
  freq = new Uint8Array(1024); wave = new Uint8Array(2048);
  for (let i = 0; i < freq.length; i++) freq[i] = 130 + (i % 80);
  for (let i = 0; i < wave.length; i++) wave[i] = 128;
  analyser = {
    frequencyBinCount: freq.length, fftSize: wave.length,
    getByteFrequencyData(a) { for (let i = 0; i < a.length; i++) a[i] = 130 + (i % 80); },
    getByteTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = 128; }
  };
}

test('换过很多特效之后，只留下当前在用的那几张离屏画布', async () => {
  await withApp('layermem-1', async (win) => {
    const res = await win.evaluate(async (prime) => {
      eval('(' + prime + ')')();
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });

      // 把全部特效都过一遍 —— 这是自动轮换跑久了的上限情形
      for (let i = 0; i < MODES.length; i++) { activeModes = [i]; focusModeIdx = i; await frames(1); }
      const afterAll = Object.keys(layerCanvases).length;

      // 再叠三个，看缓存跟着活跃集合走
      activeModes = [3, 7, 11]; focusModeIdx = 3;
      await frames(3);
      const afterThree = Object.keys(layerCanvases).length;

      const perCanvasMB = W * H * 4 / 1048576;
      return { totalModes: MODES.length, afterAll, afterThree, perCanvasMB, active: activeModes.length };
    }, primeAudio.toString());

    // 修之前这里等于 241（约 742MB）
    expect(res.afterAll).toBeLessThanOrEqual(4);
    expect(res.afterThree).toBe(res.active);
  });
});

test('叠多个特效时，每一个都还有自己的图层（回收不能误伤在用的）', async () => {
  await withApp('layermem-2', async (win) => {
    const res = await win.evaluate(async (prime) => {
      eval('(' + prime + ')')();
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });

      activeModes = [MODES.indexOf('radial'), MODES.indexOf('bars'), MODES.indexOf('starfield'), MODES.indexOf('neonGrid')];
      focusModeIdx = activeModes[0];
      await frames(4);

      const keys = Object.keys(layerCanvases).map(Number).sort((a, b) => a - b);
      const want = [...activeModes].sort((a, b) => a - b);
      // 每个活跃层都得有真实内容，别把正在用的画布回收掉
      const nonEmpty = activeModes.filter(idx => {
        const L = layerCanvases[idx];
        if (!L) return false;
        const d = L.ctx.getImageData(0, 0, L.canvas.width, L.canvas.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
        return false;
      }).length;
      return { keys, want, nonEmpty, activeCount: activeModes.length };
    }, primeAudio.toString());

    expect(res.keys).toEqual(res.want);
    expect(res.nonEmpty).toBe(res.activeCount);
  });
});

test('点击命中测试仍然正常（它读的就是这些图层）', async () => {
  await withApp('layermem-3', async (win) => {
    const res = await win.evaluate(async (prime) => {
      eval('(' + prime + ')')();
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });

      // 先换过一大堆特效，把回收逻辑充分触发
      for (let i = 0; i < 40; i++) { activeModes = [i]; focusModeIdx = i; await frames(1); }
      activeModes = [MODES.indexOf('radial')]; focusModeIdx = activeModes[0];
      await frames(4);

      const L = layerCanvases[activeModes[0]];
      // 找一个真有像素的点，命中测试应该指回这个 mode
      let hit = null;
      const d = L.ctx.getImageData(0, 0, L.canvas.width, L.canvas.height);
      outer:
      for (let y = 0; y < d.height; y += 7) {
        for (let x = 0; x < d.width; x += 7) {
          if (d.data[(y * d.width + x) * 4 + 3] > 40) { hit = hitTestMode(x, y); break outer; }
        }
      }
      return { hit, expected: activeModes[0], layerCount: Object.keys(layerCanvases).length };
    }, primeAudio.toString());

    expect(res.hit).toBe(res.expected);
    expect(res.layerCount).toBeLessThanOrEqual(4);
  });
});

test('复制出来的特效实例（小数索引）也有自己的图层，不被回收误伤', async () => {
  await withApp('layermem-4', async (win) => {
    const res = await win.evaluate(async (prime) => {
      eval('(' + prime + ')')();
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });

      activeModes = [MODES.indexOf('radial')]; focusModeIdx = activeModes[0];
      await frames(3);
      // 「➕ Duplicate」会加一个小数索引的独立副本（3 → 3.1），走的是同一条图层缓存
      document.getElementById('modeDuplicateBtn').click();
      await frames(4);

      const dup = activeModes.find(m => !Number.isInteger(m));
      const keys = Object.keys(layerCanvases).sort();
      const want = [...activeModes].map(String).sort();
      const dupHasLayer = dup != null && !!layerCanvases[dup];
      const dupHasPixels = (() => {
        const L = dup != null ? layerCanvases[dup] : null;
        if (!L) return false;
        const d = L.ctx.getImageData(0, 0, L.canvas.width, L.canvas.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
        return false;
      })();
      return { activeModes: [...activeModes], dup, keys, want, dupHasLayer, dupHasPixels };
    }, primeAudio.toString());

    expect(res.dup, '没有产生小数索引的副本').not.toBeNull();
    expect(res.dupHasLayer).toBe(true);
    expect(res.dupHasPixels).toBe(true);
    expect(res.keys).toEqual(res.want);   // 缓存的键和活跃集合完全一致
  });
});
