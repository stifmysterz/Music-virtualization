const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const APP_DIR = path.join(__dirname, '..');

/* 画质档（low / balanced / ultra）在这套测试出现之前从来没有被覆盖过 ——
   59 个 spec 文件没有一个提到 vjQuality，全部只跑默认的 balanced。
   这是个真实的风险面：low 档会把受光材质整体退回不受光的 MeshBasicMaterial，
   材质参数和灯光全部失效，逐实例颜色直接变成最终像素颜色。
   金属那批效果是按「有灯有反射」重写的，所以 low 档最容易悄悄变成一片灰或纯黑，
   而低配机器恰恰用的就是这一档。                                              */

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app = null, win = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => document.getElementById('intro')?.classList.add('hidden'));
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
}

// 被改造成受光材质的那批 + 两个仍走不受光路径的对照
const KINDS = ['vjChromeTube', 'vjChromeBubbles', 'vjLiquidSpine', 'vjRustPipes',
               'vjMercuryPool', 'vjBlackGoldFluid', 'vjLiquidGrid',
               'vjDustShaft', 'vjWarpJump'];

// 页面内采样：切档 -> 逐个效果渲染若干帧 -> 读回像素统计
const probe = ({ quality, kinds }) => {
  const sel = document.getElementById('vjQualitySel');
  sel.value = quality;
  sel.dispatchEvent(new Event('change'));      // 会丢弃全部缓存场景并按新档重建
  const out = [];
  for (const kind of kinds) {
    enableBg3D(kind);
    for (let i = 0; i < 30; i++) renderBg3D(0.6, 0.5, 0.55, 16);
    const gl = bg3DRenderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let lit = 0, vivid = 0, white = 0;
    for (let i = 0; i < w * h; i++) {
      const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx >= 35) { lit++; if ((mx - mn) / mx > 0.32) vivid++; }
      if (mn >= 225) white++;
    }
    out.push({ kind, total: w * h, lit, vivid, white, actualQuality: vjQuality });
  }
  return out;
};

for (const quality of ['low', 'balanced', 'ultra']) {
  test(`${quality} 画质档：每个效果都画得出东西，不黑屏也不过曝`, async () => {
    test.setTimeout(240_000);
    await withApp(`quality-${quality}`, async (win) => {
      const errors = [];
      win.on('pageerror', e => errors.push(String(e)));
      win.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

      const results = await win.evaluate(probe, { quality, kinds: KINDS });

      for (const r of results) {
        expect(r.actualQuality, `画质档没切过去`).toBe(quality);
        console.log(`${quality}/${r.kind}`.padEnd(28), `white=${((r.white/r.total)*100).toFixed(2)}%`);
        /* 下限刻意放得比 vj-tunnels 的 25% 松：这里守的是「这一档下它还活着」，
           不是「构图够饱满」——后者已经有专门的测试在 balanced 档上守了。
           2% 能抓住真正的事故：全黑、材质编译失败、灯光缺失导致整片死黑。 */
        expect(r.lit / r.total, `${quality}/${r.kind} 几乎全黑`).toBeGreaterThan(0.02);
        // 阈值收紧自 0.06 —— 高光 shader 调参后实测这 9 个效果在三档下 white 都是 0.00%。
        expect(r.white / r.total, `${quality}/${r.kind} 过曝白场`).toBeLessThan(0.02);
      }

      /* low 档不受光，逐实例颜色就是最终像素颜色，必须仍然是高饱和的。
         如果哪个效果在 low 档把「受光用的低饱和反射染色」直接送出去，
         画面会变成一版灰扑扑的褪色版本 —— 这条就是守这个的。 */
      if (quality === 'low') {
        for (const r of results) {
          const v = r.vivid / Math.max(1, r.lit);
          // soft：一次看到全部偏灰的效果，而不是卡在第一个
          expect.soft(v, `low/${r.kind} 颜色发灰 (vivid=${(v * 100).toFixed(1)}%)，` +
            `可能把受光档的低饱和色送进了不受光路径`).toBeGreaterThan(0.35);
        }
      }

      expect(errors, `${quality} 档有 console / page 错误`).toEqual([]);
    });
  });
}
