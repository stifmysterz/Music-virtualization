const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');

const APP_DIR = path.join(__dirname, '..');

/* 断言失败时 app.close() 会被跳过，Electron 仍锁着 --user-data-dir，
   随后 finally 里的 rmSync 就抛 EPERM，把真正的失败原因整个盖掉。
   统一走这个包装：先关应用再清目录，且清理本身失败不掩盖测试的错误。 */
async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    const win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win);
  } finally {
    if (app) { try { await app.close(); } catch (e) { /* 已经崩了就算了 */ } }
    try { cleanupUserDataDir(dir); } catch (e) { /* 临时目录清不掉不该让测试失败 */ }
  }
}


/* 特效图层（cvFx）相关的回归测试。
 *
 * 背景：原先所有特效都画在 #cv 上，而 #cv 用 source-over 合成 —— 画上去的不透明像素
 * （最典型的是 glitchBars 系列那 30 个满屏实心竖条）会把用户的背景图/视频 100% 盖死。
 * 另外多特效叠加时，每多一层就往 #cv 上刷一次 rgba(0,0,0,0.35) 黑纱做前后层次提示，
 * 而 #cv 在背景之上 —— 那层黑纱连带把背景一起压黑了（开 5 个特效背景只剩 18% 亮度）。
 *
 * 修法：特效搬到独立的 #cvFx（mix-blend-mode:screen，所以背景永远透得出来），
 * 层次提示改用 destination-out 淡化已合成内容（透明区保持透明，不再刷黑）。
 */

// draw() 只有在 analyser 为真时才会跑特效，且要从 analyser 取频谱/波形。
// analyser / activeModes / hasBgMedia 都是 61.html 顶层的 let 绑定，可以直接赋值。
// hasBgMedia=true 是为了走「有背景图时每帧 clearRect」那条分支 —— 正是本次要修的场景。
function stubAudioAndModes() {
  // freq / wave 要等 ensureCtx() 建好真正的 AnalyserNode 才会分配（61.html:4321），
  // 测试里没有音频上下文，所以先自己按同样的尺寸建出来并填上稳定的假频谱，
  // 否则 draw() 里 analyser.getByteFrequencyData(freq) 会拿到 undefined，每帧抛异常、一个像素都不画。
  freq = new Uint8Array(1024);
  wave = new Uint8Array(2048);
  for (let i = 0; i < freq.length; i++) freq[i] = 90 + (i % 60);
  for (let i = 0; i < wave.length; i++) wave[i] = 128 + Math.round(Math.sin(i * 0.09) * 50);
  analyser = {
    frequencyBinCount: freq.length,
    fftSize: wave.length,
    // 数据已经填好了，这里只要不覆盖掉即可
    getByteFrequencyData(a) { for (let i = 0; i < a.length; i++) a[i] = 90 + (i % 60); },
    getByteTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = 128 + Math.round(Math.sin(i * 0.09) * 50); }
  };
  hasBgMedia = true;
  // radial 从中心向外发散（长度封顶 0.30*min(W,H)），bars 画在底部 —— 左上角必定没有特效像素
  activeModes = [MODES.indexOf('radial'), MODES.indexOf('bars')];
  focusModeIdx = activeModes[0];
}

// 等若干个渲染帧真正跑完
function waitFrames(n) {
  return new Promise(res => {
    let left = n;
    const tick = () => (--left <= 0 ? res(true) : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
}

test('特效层 cvFx 独立存在，用 screen 混合，且不吃鼠标事件', async () => {
  await withApp('fxlayer-1', async (win) => {
    const info = await win.evaluate(() => {
      const g = id => {
        const el = document.getElementById(id);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { blend: cs.mixBlendMode, pe: cs.pointerEvents, w: el.width, h: el.height };
      };
      return { back: g('cvBack'), fx: g('cvFx'), cv: g('cv') };
    });

    expect(info.fx).not.toBeNull();
    expect(info.back).not.toBeNull();
    // 特效层用 screen 混合 —— 这才是背景能透出来的原因（canvas 内部的合成模式做不到，它不改 alpha）
    expect(info.fx.blend).toBe('screen');
    // 另外两层保持普通混合，logo / 文字 / 选中框不受影响
    expect(info.cv.blend).toBe('normal');
    expect(info.back.blend).toBe('normal');
    // 只有最上层的 cv 接收指针事件，否则拖拽特效/logo 会被挡住
    expect(info.fx.pe).toBe('none');
    expect(info.back.pe).toBe('none');
    // 三层像素尺寸必须一致，否则合成会错位
    expect(info.fx.w).toBe(info.cv.w);
    expect(info.fx.h).toBe(info.cv.h);
    expect(info.back.w).toBe(info.cv.w);
    expect(info.back.h).toBe(info.cv.h);
  });
});

test('多特效叠加时不再往整屏刷黑纱 —— 空白处保持全透明，背景不会被压黑', async () => {
  await withApp('fxlayer-2', async (win) => {
    const alphas = await win.evaluate(async ({ stub, waiter }) => {
      eval('(' + stub + ')')();
      await eval('(' + waiter + ')')(8);
      const corner = id => {
        const el = document.getElementById(id);
        return el.getContext('2d').getImageData(2, 2, 1, 1).data[3];
      };
      return { fx: corner('cvFx'), cv: corner('cv'), back: corner('cvBack') };
    }, { stub: stubAudioAndModes.toString(), waiter: waitFrames.toString() });

    // 开了 2 个特效（会触发一次层次提示），左上角没有任何特效画到 ——
    // 三层在那里都必须是完全透明，背景才透得过来。
    // 修复前：那层 rgba(0,0,0,0.35) 黑纱会让 #cv 的这个像素 alpha ≈ 89。
    expect(alphas.fx).toBe(0);
    expect(alphas.cv).toBe(0);
    expect(alphas.back).toBe(0);
  });
});

test('截图/录像的合成帧仍然包含特效（特效搬层后不能丢）', async () => {
  await withApp('fxlayer-3', async (win) => {
    const res = await win.evaluate(async ({ stub, waiter }) => {
      eval('(' + stub + ')')();
      await eval('(' + waiter + ')')(8);
      const c = composeCaptureFrame();
      const ctx = c.getContext('2d');
      // 中心区域取一块，统计有多少像素是非透明的 —— radial 画在正中，必定有内容
      const box = 60;
      const d = ctx.getImageData(Math.floor(c.width / 2 - box / 2), Math.floor(c.height / 2 - box / 2), box, box).data;
      let opaque = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
      return { opaque, total: box * box, w: c.width, h: c.height, cvW: document.getElementById('cv').width };
    }, { stub: stubAudioAndModes.toString(), waiter: waitFrames.toString() });

    expect(res.w).toBe(res.cvW);           // 合成帧尺寸跟随 cv（录像切 4K 时也要跟上）
    expect(res.opaque).toBeGreaterThan(0); // 特效确实进了导出帧，没有因为搬层丢失
  });
});
