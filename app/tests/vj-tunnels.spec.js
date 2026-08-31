const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 🌀 VJ 菜单：10 个「隧道穿梭」循环视觉。
 *
 * 三件事必须成立，缺一个就不是 VJ loop 而是普通 3D 背景：
 *   1) 真的画出东西 —— 每个隧道渲染出来的画面得有亮像素，而且颜色够鲜艳
 *   2) 真的从后面飞到前面 —— 场景里的元素 z 要往 +z（镜头）走，不是原地转
 *   3) 真的能一直循环 —— 跑够一整个循环长度之后画面还在，元素不会飞光
 *
 * 顺带守住接线：10 个都注册进 BG3D_BUILDERS 了，但一个都不许漏进 BG3D_CATALOG
 * ——漏进去的话 🌌 3D 菜单的列表和它的 ⏭ Next 顺序就被搅乱了。
 */

const KINDS = ['vjLiquidGrid','vjHexPulse','vjNeonRibbon','vjPrismShards','vjWaveCorridor',
               'vjPlasmaRings','vjStarLane','vjKaleido','vjChromeTube','vjCubeMatrix',
               /* 第二批：LuChrome / LiquidGrids / CyborgSpace / AntiGravityRacing /
                  CreatureFeature / Void / AIRealms / NeonRoom / Voyage /
                  TheNextDimension / LunaPark */
               'vjChromeFlow','vjMetalTwist','vjGridMorph','vjFractalWell',
               'vjCyborgCorridor','vjRaceTrack','vjSpeedGates','vjHoverCity',
               'vjTentacleTunnel','vjBioMembrane','vjVoidNebula','vjEventHorizon',
               'vjCandyOrbs','vjDataBloom','vjNeonTubeRoom','vjNeonArches',
               'vjHorizonVoyage','vjLightWell','vjHyperCube','vjCoasterRush'];

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

/* 装一个"音乐在放"的假音频源，并把每帧的 requestAnimationFrame 换成手动步进 ——
   渲染帧数由测试说了算，不然 headless 下的帧率会让「跑满一个循环」变得不可预期。 */
function harness() {
  document.getElementById('intro')?.classList.add('hidden');
  const rp = document.getElementById('restorePrompt'); if (rp) rp.style.display = 'none';
  window.__vj = {
    // 直接驱动 renderBg3D()，绕开主循环，bass/mid/high 由测试给定
    step(n, bass, mid, high) { for (let i = 0; i < n; i++) renderBg3D(bass, mid, high, 1); },
    // 把当前场景里所有 Object3D 的 z（含 InstancedMesh 的实例）收成一个数组
    zs() {
      const s = bg3DScenes[bg3DKind];
      const out = [];
      s.scene.traverse(o => {
        // Group 要单独记：加速门那种把整扇门装进 Group 再整体推，
        // 子 Mesh 的 position.z 是相对 Group 的，恒为 0，只看子 Mesh 会以为它没动
        if (o.isGroup && o !== s.scene) { out.push(o.position.z); return; }
        if (o.isInstancedMesh) {
          const m = o.instanceMatrix.array;
          for (let i = 0; i < o.count; i++) out.push(m[i * 16 + 14]);
        } else if (o.isMesh || o.isLine || o.isLineSegments || o.isPoints) {
          out.push(o.position.z);
          const p = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
          if (p && o.position.z === 0) for (let i = 0; i < p.count; i++) out.push(p.array[i * 3 + 2]);
        }
      });
      return out;
    },
    // 画布上最亮的一批像素，用来判断"画出来了"和"够鲜艳"
    pixels() {
      const gl = bg3DRenderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let lit = 0, vivid = 0, hues = new Set();
      for (let i = 0; i < w * h; i++) {
        const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx < 40) continue;
        lit++;
        // 饱和度 = (max-min)/max。鲜艳 = 亮且饱和，灰白和暗色都不算
        if ((mx - mn) / mx > 0.5) { vivid++; hues.add(Math.round(Math.atan2(g - b, r - g) * 6)); }
      }
      return { total: w * h, lit, vivid, hueBuckets: hues.size };
    },
    /* n 帧的平均亮像素数。等离子光环那类环的不透明度本来就跟着拍子呼吸，
       单帧取样一次高一次低，比出来的是相位差不是循环有没有接上。 */
    avgLit(n, bass, mid, high) {
      let sum = 0;
      for (let i = 0; i < n; i++) { window.__vj.step(1, bass, mid, high); sum += window.__vj.pixels().lit; }
      return sum / n;
    }
  };
}

test('10 个 VJ 隧道都注册好了，而且一个都没漏进 🌌 3D 菜单', async () => {
  await withApp('vj-wiring', async (win) => {
    const res = await win.evaluate((kinds) => ({
      order: VJ_TUNNEL_KINDS,
      missingBuilder: kinds.filter(k => typeof BG3D_BUILDERS[k] !== 'function'),
      leakedIntoCatalog: kinds.filter(k => BG3D_ORDER.includes(k)),
      menuItems: [...document.querySelectorAll('#vjMenuList .dock-dd-item')].map(b => b.dataset.kind),
      // 菜单项的名字要真的翻出来了，不能是原样的 id
      labels: [...document.querySelectorAll('#vjMenuList .dock-dd-item')].map(b => b.textContent),
      inPresetSelect: kinds.filter(k => !![...document.getElementById('presetBg3DSel').options].find(o => o.value === k)),
    }), KINDS);

    expect(res.order).toEqual(KINDS);
    expect(res.missingBuilder, '这些 kind 没有对应的 builder').toEqual([]);
    expect(res.leakedIntoCatalog, '这些漏进了 BG3D_CATALOG，会搅乱 3D 菜单的 Next 顺序').toEqual([]);
    expect(res.menuItems).toEqual(KINDS);
    expect(res.labels.filter(t => /^bg3D/.test(t)), '这些菜单项没有 UI_STRINGS 名字').toEqual([]);
    expect(res.inPresetSelect, '存 Look 时选不到这些').toEqual(KINDS);
  });
});

test('dock 上的 🌀 VJ 按钮能开合菜单，点一项就切过去', async () => {
  await withApp('vj-menu', async (win) => {
    await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      const rp = document.getElementById('restorePrompt'); if (rp) rp.style.display = 'none';
    });
    const btn = win.locator('#vjMenuBtn');
    await expect(btn, 'dock 上没有 🌀 VJ 按钮').toBeVisible();
    await btn.click();
    await expect(win.locator('#vjMenu')).toHaveClass(/show/);

    // 开 🌌 3D 时 VJ 菜单要让位 —— 两个都是右侧栏，叠一起会互相盖住
    await win.locator('#bg3DMenuBtn').click();
    await expect(win.locator('#vjMenu')).not.toHaveClass(/show/);

    await btn.click();
    await win.locator('#bg3DVjKaleidoBtn').click();
    expect(await win.evaluate(() => [bg3DKind, hasBg3D])).toEqual(['vjKaleido', true]);
  });
});

test('🎲 Random 3D 和 Auto-Shuffle 不会自己切到 VJ 隧道上', async () => {
  test.setTimeout(180_000);
  await withApp('vj-random', async (win) => {
    /* VJ loop 是从 🌀 VJ 菜单主动挑的，不该在 3D 背景轮换时冒出来。
       randomBg3D() 是 🎲 Random 3D、菜单里的 🎲 Random 和 Auto-Shuffle 三者
       共用的唯一随机来源（Auto-Shuffle 的 setInterval 直接调它），所以测它就够。 */
    const res = await win.evaluate((kinds) => {
      const seen = new Set();
      for (let i = 0; i < 400; i++) { randomBg3D(); seen.add(bg3DKind); }
      return {
        hitVj: [...seen].filter(k => kinds.includes(k)),
        distinct: seen.size,
        allInCatalog: [...seen].every(k => BG3D_ORDER.includes(k)),
        shuffleUsesRandom: String(startBg3DShuffleTimer).includes('randomBg3D'),
      };
    }, KINDS);
    expect(res.hitVj, '3D 随机切到了 VJ 隧道上').toEqual([]);
    expect(res.allInCatalog, '随机到了 BG3D_CATALOG 之外的东西').toBe(true);
    expect(res.distinct, '400 次只转出这么几个，随机池可能被缩没了').toBeGreaterThan(30);
    expect(res.shuffleUsesRandom, 'Auto-Shuffle 不再走 randomBg3D 了，这条测试覆盖不到它').toBe(true);

    // 反过来：VJ 菜单自己的 🎲 只在 VJ 池里挑
    const vjOnly = await win.evaluate((kinds) => {
      const seen = new Set();
      for (let i = 0; i < 120; i++) { document.getElementById('vjRandomBtn').click(); seen.add(bg3DKind); }
      return { seen: [...seen], allVj: [...seen].every(k => kinds.includes(k)) };
    }, KINDS);
    expect(vjOnly.allVj, 'VJ 菜单的随机跑到 VJ 之外去了').toBe(true);
    expect(vjOnly.seen.length, 'VJ 随机只转出这么几个').toBeGreaterThan(5);
  });
});

test('每个隧道都画得出鲜艳的画面，而且元素是从后面往镜头飞', async () => {
  test.setTimeout(180_000);
  await withApp('vj-motion', async (win) => {
    await win.evaluate(harness);
    for (const kind of KINDS) {
      const r = await win.evaluate((k) => {
        enableBg3D(k);
        window.__vj.step(30, 0.5, 0.4, 0.3);   // 先跑起来，避开第一帧的初始状态
        /* 鲜艳度连采 8 帧取平均。单帧不够稳：棱镜碎片的位置和色相是 Math.random()
           初始化的，霓虹飘带的 bloom 光晕也随相位起伏，实测同一个 kind 单帧能在
           44%~68% 之间跳，会偶发误报。 */
        const px = (() => {
          const acc = { total: 0, lit: 0, vivid: 0, hueBuckets: 0 };
          for (let f = 0; f < 8; f++) {
            window.__vj.step(3, 0.5, 0.4, 0.3);
            const p = window.__vj.pixels();
            acc.total = p.total; acc.lit += p.lit; acc.vivid += p.vivid;
            acc.hueBuckets = Math.max(acc.hueBuckets, p.hueBuckets);
          }
          return { total: acc.total, lit: acc.lit / 8, vivid: acc.vivid / 8, hueBuckets: acc.hueBuckets };
        })();

        /* 运动方向。一帧一帧地比，而且是在静音下比：
           整齐排列的隧道（液态网格、六角、方块阵…）所有元素共用同一个 scroll 相位，
           所以要么整屏一起往前走，要么整屏一起回收 —— 单看一帧会 50% 撞上回收帧。
           静音时每帧只走 0.9，比最密的环距 4.8 小得多，回收帧只占 19%，
           连采 20 帧就能清楚看出「绝大多数帧都在往镜头走」。 */
        let fwdFrames = 0, backFrames = 0;
        for (let f = 0; f < 20; f++) {
          const before = window.__vj.zs();
          window.__vj.step(1, 0, 0, 0);
          const after = window.__vj.zs();
          let fwd = 0, back = 0;
          for (let i = 0; i < Math.min(before.length, after.length); i++) {
            const d = after[i] - before[i];
            if (d > 0.01) fwd++; else if (d < -0.01) back++;
          }
          if (fwd > back) fwdFrames++; else if (back > fwd) backFrames++;
        }
        return { kind: k, fwdFrames, backFrames, ...px };
      }, kind);

      console.log(`${kind.padEnd(16)} lit=${(r.lit / r.total * 100).toFixed(1)}%  ` +
                  `vivid=${(r.vivid / r.lit * 100).toFixed(0)}%  hues=${r.hueBuckets}  ` +
                  `fwd=${r.fwdFrames}/back=${r.backFrames}`);
      // 用 soft 断言：一次跑完看到三十个的全貌，而不是卡在第一个失败上
      /* 「画质要饱满」是明确要求，所以下限定在 25%，而不是「别全黑」的 2%。
         第一批原本走线框路子，最稀的星轨只点亮 6.8% 的像素，投影上很单薄；
         补上实体的体积层之后全都在 32% 以上。这条守的就是别再退回去。 */
      expect.soft(r.lit / r.total, `${kind}: 画面太稀，不够饱满`).toBeGreaterThan(0.25);
      // 鲜艳：亮像素里大半是高饱和的，而且色相不止一种。发灰通常是 bloom 开太猛，
      // 把细线糊成一片泛白的光晕 —— 那就是"不够靓"，得回去调 bloom，不是放宽这条
      expect.soft(r.vivid / r.lit, `${kind}: 颜色发灰，不够鲜艳`).toBeGreaterThan(0.5);
      expect.soft(r.hueBuckets, `${kind}: 整屏只有一个色调`).toBeGreaterThan(2);
      // 20 帧里绝大多数都在往镜头走，剩下的少数是跨过回收线的那几帧
      expect.soft(r.fwdFrames, `${kind}: 往镜头飞的帧太少（fwd=${r.fwdFrames} back=${r.backFrames}）`).toBeGreaterThanOrEqual(10);
      expect.soft(r.fwdFrames, `${kind}: 在往后退，不是飞过来（fwd=${r.fwdFrames} back=${r.backFrames}）`).toBeGreaterThan(r.backFrames);
    }
  });
});

test('跑满一整个循环之后画面还在 —— 元素没有飞光，也没有堆到一处', async () => {
  test.setTimeout(180_000);
  await withApp('vj-loop', async (win) => {
    await win.evaluate(harness);
    for (const kind of KINDS) {
      const r = await win.evaluate((k) => {
        enableBg3D(k);
        window.__vj.step(30, 0.5, 0.4, 0.3);
        const warmLit = window.__vj.avgLit(20, 0.5, 0.4, 0.3);   // 热身之后的平均亮度，当基准
        // 有音乐时每帧走 2.5 —— 400 帧 = 1000 单位 = 四圈半
        window.__vj.step(400, 0.5, 0.4, 0.3);
        const lit = window.__vj.avgLit(20, 0.5, 0.4, 0.3);
        const zs = window.__vj.zs();
        return { lit, warmLit, total: window.__vj.pixels().total, spread: Math.max(...zs) - Math.min(...zs) };
      }, kind);
      /* 跟热身时的亮度比，而不是定一个绝对阈值 —— 不同效果的密度差很多，
         绝对阈值卡的是密度，不是循环接没接上。
         比值判据放在 0.25：这条要抓的故障是「元素全飞光、画面空掉」，那时亮度会
         塌到接近 0。而好几个效果本身就有周期性的整体胀缩（触手隧道最明显，它的
         clock 项让整条隧道一起呼吸），采样窗口盖不满那个周期，比值在 0.4~1 之间
         正常起伏 —— 卡在 0.5 会偶发误报（实测三次里错两次）。 */
      expect(r.lit / r.warmLit, `${kind}: 跑完四圈半后画面塌了 —— 循环没接上`).toBeGreaterThan(0.25);
      expect(r.lit / r.total, `${kind}: 跑完四圈半后画面空了`).toBeGreaterThan(0.01);
      expect(r.spread, `${kind}: 元素全堆在同一个深度上了`).toBeGreaterThan(20);
    }
  });
});
