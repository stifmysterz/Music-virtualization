const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 每一粒低音都要在画面上砸一下。
 *
 * 走完整条真实链路（假频谱 → detectBeat → lastBass/beat → renderBg3D）实测下来，
 * detectBeat 本身没问题（128BPM 的踢鼓，4.3 秒里 9 粒打中 8 粒），问题在后面两处：
 *
 * 1) beat 永远到不了 1，峰值只有 0.72 —— detectBeat() 里 beat=1 之后，同一次调用的
 *    末尾就 beat *= pow(0.72, dt) 把它打下去了。后果：
 *      · beatTunnel 里的 if(beat >= 0.999) 是死代码，那个特效的"按拍前进"从没跑过
 *      · 所有 beat 驱动的幅度都少 28%（logo punch、basspunch 的亮度闪、摄影机冲击）
 *    这是既有 bug（原来 beat *= 0.9 也一样），把衰减挪到判定之前就好。
 *
 * 2) 传给 119 个风格的 pulsedBass = min(1, bass + beat*0.4) 是直流。实测：
 *      干净素材  lastBass 峰峰 0.894   pulsedBass 峰峰 0.894
 *      压满素材  lastBass 峰峰 0.206   pulsedBass 峰峰 0.206
 *    两列一模一样 —— 压满的曲子 bass 常年 0.79~1，加 beat*0.4 只会撞 min(1,…) 的天花板，
 *    瞬态贡献为 0。所以"内容本身跟着砸"这件事指望不上风格内部。
 *    改 pulsedBass 的语义会动到全部 119 个风格的既有观感，所以不动它 ——
 *    改成在所有风格共用的那一层加一条独立的「每一粒砸一下」，跟中音摇摆/高音闪烁并列。
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

/* 直接驱动 detectBeat：喂一段"安静底噪 + 一粒踢鼓"的频谱，返回命中那一帧的 beat。
   不经过渲染循环，纯粹看检测器自己。 */
function beatHarness() {
  window.__b = {
    // level 直接决定 freq[2..28] 的值
    feed(level, now) {
      for (let i = 0; i < freq.length; i++) freq[i] = i < 30 ? level : 40;
      return detectBeat(now);
    },
    // 喂 n 帧的底噪，把 energyHist 的均值/标准差铺好
    settle(level, t0, n) { for (let i = 0; i < n; i++) window.__b.feed(level, t0 + i * 16.7); return t0 + n * 16.7; }
  };
  document.getElementById('intro')?.classList.add('hidden');
  const rp = document.getElementById('restorePrompt'); if (rp) rp.style.display = 'none';
  freq = new Uint8Array(1024); wave = new Uint8Array(2048);
  manualBPM = null;
  resetBeatDetector();
}

test('鼓点命中的那一帧，beat 就是 1（不是被同一次调用先打成 0.72）', async () => {
  await withApp('perhit-1', async (win) => {
    const res = await win.evaluate((h) => {
      eval('(' + h + ')')();
      const B = window.__b;
      let t = B.settle(20, 1000, 60);       // 安静底噪
      const beforeHit = beat;
      B.feed(220, t);                        // 一粒踢鼓
      const atHit = beat;
      t += 16.7; B.feed(60, t);              // 之后回落
      const oneFrameLater = beat;
      t += 16.7; B.feed(40, t);
      const twoFramesLater = beat;
      return { beforeHit: +beforeHit.toFixed(4), atHit: +atHit.toFixed(4),
               oneFrameLater: +oneFrameLater.toFixed(4), twoFramesLater: +twoFramesLater.toFixed(4) };
    }, beatHarness.toString());

    expect(res.beforeHit).toBeLessThan(0.01);
    // 修之前这里是 0.72 —— beat=1 之后同一次调用末尾就衰减了
    expect(res.atHit, `命中帧的 beat 只有 ${res.atHit}，beat>=0.999 的分支永远进不去`).toBeGreaterThanOrEqual(0.999);
    // 之后要衰减，否则就变成一直亮着而不是一粒一粒
    expect(res.oneFrameLater).toBeLessThan(res.atHit);
    expect(res.twoFramesLater).toBeLessThan(res.oneFrameLater);
  });
});

test('beatTunnel 里那段 beat>=0.999 的「按拍前进」不再是死代码', async () => {
  await withApp('perhit-2', async (win) => {
    const res = await win.evaluate((h) => {
      eval('(' + h + ')')();
      const B = window.__b;
      const scene = BG3D_BUILDERS.beatTunnel();
      const ringZ = () => scene.scene.children.filter(c => c.isMesh).map(c => +c.position.z.toFixed(2));

      let t = B.settle(20, 1000, 60);
      const before = ringZ();
      scene.update(0.2, 0, 0, 1);
      const noHit = ringZ();                 // 没有鼓点，环不该跳格

      B.feed(220, t);                        // 一粒踢鼓 → beat 应该是 1
      const beatAtHit = beat;
      scene.update(0.2, 0, 0, 1);
      const afterHit = ringZ();

      return { beatAtHit: +beatAtHit.toFixed(4), before, noHit, afterHit,
               movedOnHit: JSON.stringify(afterHit) !== JSON.stringify(noHit),
               movedWithoutHit: JSON.stringify(noHit) !== JSON.stringify(before) };
    }, beatHarness.toString());

    expect(res.beatAtHit).toBeGreaterThanOrEqual(0.999);
    expect(res.movedWithoutHit, '没有鼓点环就不该跳格').toBe(false);
    expect(res.movedOnHit, 'beat>=0.999 的分支没进去，环没有按拍前进').toBe(true);
  });
});

test('每一粒都在 3D 上砸一下：zoom 冲击 + 亮度闪，跟风格无关', async () => {
  await withApp('perhit-3', async (win) => {
    const res = await win.evaluate(async (h) => {
      eval('(' + h + ')')();
      const B = window.__b;
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
      const filterVal = (name) => { const m = (bgThreeCanvas.style.filter || '').match(new RegExp(name + '\\(([-0-9.]+)')); return m ? parseFloat(m[1]) : null; };

      const out = [];
      let clock = 1000;                      // 时钟只能往前走：倒回去的话不应期检查 t-lastBeatAt
                                             // 会变成负数，第二个风格的鼓点就打不出来
      // 三个自己完全不看 beat 的风格 —— 砸的效果必须来自共用那一层
      for (const kind of ['tunnel', 'cherryBlossom', 'snowfallDrift']) {
        enableBg3D(kind);
        await frames(4);
        analyser = null;                     // 别让渲染循环覆盖我们喂进去的值
        bgBounceOn = false;                  // 把背景跳动关掉，只看共用那一层自己的效果
        resetBeatDetector();
        bg3DHit = 0;                         // 上一个风格残留的冲击会把这个风格的基准抬高
        let t = B.settle(20, clock, 60);
        clock = t + 5000;
        const s = bg3DScenes[kind];

        // 安静时的基准
        renderBg3D(0.2, 0, 0, 1);
        const quietZoom = s.camera.zoom, quietBright = filterVal('brightness');

        // 一粒踢鼓
        B.feed(220, t);
        renderBg3D(0.2, 0, 0, 1);
        const hitZoom = s.camera.zoom, hitBright = filterVal('brightness');

        // 130ms 之后应该衰下去，粒粒才分明
        for (let i = 1; i <= 8; i++) { t += 16.7; B.feed(40, t); renderBg3D(0.2, 0, 0, 1); }
        const decayedZoom = s.camera.zoom;

        out.push({
          kind,
          zoomPunchPct: +((hitZoom / quietZoom - 1) * 100).toFixed(1),
          brightPunchPct: +((hitBright / quietBright - 1) * 100).toFixed(1),
          leftAfter130ms: +((decayedZoom / quietZoom - 1) * 100).toFixed(1)
        });
      }
      disableBg3D();
      return out;
    }, beatHarness.toString());

    for (const r of res) {
      expect(r.zoomPunchPct, `${r.kind}: 鼓点没有把画面推近（${r.zoomPunchPct}%）`).toBeGreaterThan(15);
      expect(r.brightPunchPct, `${r.kind}: 鼓点没有把画面闪亮（${r.brightPunchPct}%）`).toBeGreaterThan(15);
      // 一粒一粒：130ms 后剩下的要明显少于砸下去那一刻，否则连成一片
      expect(r.leftAfter130ms, `${r.kind}: 冲击不衰减，会连成一片`).toBeLessThan(r.zoomPunchPct * 0.6);
    }
    // 跟风格无关：三个风格拿到的冲击应该一样
    const zooms = res.map(r => r.zoomPunchPct);
    expect(Math.max(...zooms) - Math.min(...zooms), '各风格拿到的冲击不一致: ' + JSON.stringify(res)).toBeLessThan(1);
  });
});

test('安静的时候不砸', async () => {
  await withApp('perhit-4', async (win) => {
    const res = await win.evaluate(async (h) => {
      eval('(' + h + ')')();
      const B = window.__b;
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
      const filterVal = (name) => { const m = (bgThreeCanvas.style.filter || '').match(new RegExp(name + '\\(([-0-9.]+)')); return m ? parseFloat(m[1]) : null; };
      enableBg3D('tunnel');
      await frames(4);
      analyser = null; bgBounceOn = false;
      let t = B.settle(18, 1000, 80);        // 一直是安静的底噪，没有任何鼓点
      const s = bg3DScenes.tunnel;
      let lo = Infinity, hi = -Infinity, bLo = Infinity, bHi = -Infinity;
      for (let i = 0; i < 40; i++) {
        t += 16.7; B.feed(18 + (i % 3), t);   // 一点点噪声抖动
        renderBg3D(0.07, 0, 0, 1);
        lo = Math.min(lo, s.camera.zoom); hi = Math.max(hi, s.camera.zoom);
        const b = filterVal('brightness'); bLo = Math.min(bLo, b); bHi = Math.max(bHi, b);
      }
      disableBg3D();
      return { zoomPP: +((hi / lo - 1) * 100).toFixed(2), brightPP: +((bHi / bLo - 1) * 100).toFixed(2) };
    }, beatHarness.toString());

    expect(res.zoomPP, `安静时画面自己在推拉 ${res.zoomPP}%`).toBeLessThan(3);
    expect(res.brightPP, `安静时画面自己在闪 ${res.brightPP}%`).toBeLessThan(3);
  });
});

test('连续的鼓点粒粒分明，不会累积成一片', async () => {
  await withApp('perhit-5', async (win) => {
    const res = await win.evaluate(async (h) => {
      eval('(' + h + ')')();
      const B = window.__b;
      const frames = n => new Promise(r => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
      enableBg3D('tunnel');
      await frames(4);
      analyser = null; bgBounceOn = false;
      let t = B.settle(20, 1000, 60);
      const s = bg3DScenes.tunnel;

      // 128BPM = 469ms 一粒，跑 6 粒，记下每粒的峰和粒间的谷
      const peaks = [], troughs = [];
      for (let k = 0; k < 6; k++) {
        B.feed(220, t); renderBg3D(0.2, 0, 0, 1);
        let peak = s.camera.zoom;
        let trough = Infinity;
        for (let i = 1; i < 28; i++) {        // 28 帧 ≈ 469ms
          t += 16.7; B.feed(40, t); renderBg3D(0.2, 0, 0, 1);
          peak = Math.max(peak, s.camera.zoom);
          if (i > 6) trough = Math.min(trough, s.camera.zoom);
        }
        t += 16.7;
        peaks.push(+peak.toFixed(4)); troughs.push(+trough.toFixed(4));
      }
      disableBg3D();
      return { peaks, troughs };
    }, beatHarness.toString());

    // 每一粒的峰都要明显高过它后面的谷
    res.peaks.forEach((p, i) => {
      expect(p / res.troughs[i], `第 ${i + 1} 粒的峰谷比只有 ${(p / res.troughs[i]).toFixed(3)}`).toBeGreaterThan(1.15);
    });
    // 峰值不能一粒比一粒高（那就是在累积）
    const drift = Math.max(...res.peaks) / Math.min(...res.peaks);
    expect(drift, '冲击在累积，峰值一粒比一粒高: ' + JSON.stringify(res.peaks)).toBeLessThan(1.05);
  });
});
