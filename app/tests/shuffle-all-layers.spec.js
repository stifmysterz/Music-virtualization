const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 三层都要能自动轮换，而且都能用「⚡ 突变时切换」那一档。
 *
 * 原来只有 2D（Mode 菜单）和 3D（🌌 3D 菜单）有 Auto-Shuffle，VJ 只有 Random / Next；
 * 而「突变时切换」是 2D 独有的 —— 它不看时钟，比较最近 0.5 秒和最近 4 秒的低音平均值，
 * 差得够多就认为进了新段落（副歌 / drop / 突然安静）。
 *
 * 两件事必须守住：
 *   · 3D 和 VJ 驱动的是同一个 bg3DKind，同时开会互相抢画面 —— 所以两者互斥
 *   · 突变检测三层共用一份低音历史和一份冷却，一次段落变化只该触发一轮
 */

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app = null, win = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => {
      document.getElementById('intro')?.classList.add('hidden');
      const rp = document.getElementById('restorePrompt'); if (rp) rp.style.display = 'none';
      enableBg3D('vjLiquidGrid');
    });
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

test('三层都有 Auto-Shuffle，而且三个间隔下拉都带「突变时切换」', async () => {
  test.setTimeout(180_000);
  await withApp('shuffle-present', async (win) => {
    const res = await win.evaluate(() => {
      const opts = (id) => [...document.getElementById(id).options].map(o => o.value);
      return {
        toggles: ['micShuffleToggle', 'bg3DShuffleToggle', 'vjShuffleToggle'].map(id => !!document.getElementById(id)),
        mic: opts('micShuffleIntervalSel'),
        bg3d: opts('bg3DShuffleIntervalSel'),
        vj: opts('vjShuffleIntervalSel'),
        vjCustomRow: !!document.getElementById('vjShuffleCustomRow'),
      };
    });
    expect(res.toggles, '三层的开关不齐').toEqual([true, true, true]);
    for (const [name, list] of [['2D', res.mic], ['3D', res.bg3d], ['VJ', res.vj]]) {
      expect(list, `${name} 的间隔下拉少了「突变时切换」`).toContain('change');
      expect(list, `${name} 的间隔下拉少了自定义`).toContain('custom');
    }
    expect(res.vjCustomRow, 'VJ 少了自定义秒数那一行').toBe(true);
  });
});

test('3D 和 VJ 的轮换互斥 —— 它们驱动的是同一个背景', async () => {
  test.setTimeout(180_000);
  await withApp('shuffle-exclusive', async (win) => {
    const r = await win.evaluate(() => {
      const snap = () => ({
        bg3d: bg3DShuffleOn, vj: vjShuffleOn,
        bg3dTimer: !!bg3DShuffleTimer, vjTimer: !!vjShuffleTimer,
      });
      const out = [];
      setBg3DShuffle(true);  out.push(snap());   // 只有 3D 在转
      setVjShuffle(true);    out.push(snap());   // 开 VJ，3D 该被关掉
      setBg3DShuffle(true);  out.push(snap());   // 反过来也要成立
      setBg3DShuffle(false); out.push(snap());   // 都关掉
      return out;
    });
    expect(r[0], '开 3D 之后只有 3D 在转').toEqual({ bg3d: true, vj: false, bg3dTimer: true, vjTimer: false });
    expect(r[1], '开 VJ 没有把 3D 关掉').toEqual({ bg3d: false, vj: true, bg3dTimer: false, vjTimer: true });
    expect(r[2], '开 3D 没有把 VJ 关掉').toEqual({ bg3d: true, vj: false, bg3dTimer: true, vjTimer: false });
    expect(r[3], '关掉之后定时器没停').toEqual({ bg3d: false, vj: false, bg3dTimer: false, vjTimer: false });

    // 按钮上的字也要跟着走，不然菜单显示「开」但其实没在转
    const labels = await win.evaluate(() => {
      setVjShuffle(true);
      return {
        vj: document.getElementById('vjShuffleToggle').textContent,
        bg3d: document.getElementById('bg3DShuffleToggle').textContent,
      };
    });
    expect(labels.vj).toMatch(/On/);
    expect(labels.bg3d, '3D 被互斥关掉了，按钮还显示 On').toMatch(/Off/);
  });
});

test('选了「突变时切换」就不设定时器，改由渲染循环里的检测驱动', async () => {
  test.setTimeout(180_000);
  await withApp('shuffle-change-mode', async (win) => {
    const r = await win.evaluate(() => {
      const out = {};
      // 3D：先用定时档确认有定时器，再切到 change 档
      document.getElementById('bg3DShuffleIntervalSel').value = '4000';
      setBg3DShuffle(true);
      out.bg3dTimed = !!bg3DShuffleTimer;
      document.getElementById('bg3DShuffleIntervalSel').value = 'change';
      startBg3DShuffleTimer();
      out.bg3dChange = !!bg3DShuffleTimer;
      setBg3DShuffle(false);
      // VJ 同理
      document.getElementById('vjShuffleIntervalSel').value = '4000';
      setVjShuffle(true);
      out.vjTimed = !!vjShuffleTimer;
      document.getElementById('vjShuffleIntervalSel').value = 'change';
      startVjShuffleTimer();
      out.vjChange = !!vjShuffleTimer;
      setVjShuffle(false);
      return out;
    });
    expect(r.bg3dTimed, '3D 定时档应该有定时器').toBe(true);
    expect(r.bg3dChange, '3D 选了突变档还留着定时器 —— 会变成两个来源同时换').toBe(false);
    expect(r.vjTimed, 'VJ 定时档应该有定时器').toBe(true);
    expect(r.vjChange, 'VJ 选了突变档还留着定时器').toBe(false);
  });
});

test('突变检测真的会触发对应那一层，没开的层不受影响', async () => {
  test.setTimeout(180_000);
  await withApp('shuffle-sudden', async (win) => {
    const r = await win.evaluate(async () => {
      // 三层都设成突变档，但只把 VJ 打开 —— 另外两层不该被触发
      ['micShuffleIntervalSel', 'bg3DShuffleIntervalSel', 'vjShuffleIntervalSel']
        .forEach(id => { document.getElementById(id).value = 'change'; });
      micShuffleOn = false;
      setBg3DShuffle(false);
      setVjShuffle(true);
      enableBg3D('vjLiquidGrid');

      const before = bg3DKind;
      let vjFired = 0, modeFired = 0;
      // VJ 订阅者现在挂的是 runVjShuffleTick（会按 Source: 收藏/随机 挑池子，再调
      // randomVjTunnel），不再是 randomVjTunnel 本体 —— 认错函数引用的话这里永远数不到
      const realVj = runVjShuffleTick, realMode = runMicShuffleTick;
      // 直接数订阅者被调了几次，不去猜画面
      SUDDEN_CHANGE_SUBSCRIBERS.forEach(sub => {
        const f = sub.fire;
        sub.fire = () => { if (f === realVj) vjFired++; if (f === realMode) modeFired++; f(); };
      });

      /* 喂一段「安静 → 突然很响」的低音，模拟进副歌。
         检测要求长窗口先攒够 120 帧，短窗口 0.5 秒，差值 >0.3，冷却 4 秒。 */
      lastChangeShuffleAt = 0;
      let t = 100000;
      lastBass = 0.05;
      for (let i = 0; i < 260; i++) { checkSuddenChangeShuffle(t); t += 16.7; }
      lastBass = 0.95;
      for (let i = 0; i < 40; i++) { checkSuddenChangeShuffle(t); t += 16.7; }

      return { before, after: bg3DKind, vjFired, modeFired };
    });
    console.log(`  VJ 触发 ${r.vjFired} 次，2D 触发 ${r.modeFired} 次；隧道 ${r.before} → ${r.after}`);
    expect(r.vjFired, '低音突然拉高没有触发 VJ 轮换').toBeGreaterThan(0);
    expect(r.modeFired, '2D 的开关是关着的，不该被触发').toBe(0);
    expect(r.after, '触发了但隧道没换').not.toBe(r.before);
  });
});

test('一层都没开时不攒历史，开关关掉后不会残留触发', async () => {
  test.setTimeout(180_000);
  await withApp('shuffle-idle', async (win) => {
    const r = await win.evaluate(() => {
      micShuffleOn = false; setBg3DShuffle(false); setVjShuffle(false);
      let t = 200000;
      lastBass = 0.05;
      for (let i = 0; i < 200; i++) { checkSuddenChangeShuffle(t); t += 16.7; }
      const idleLen = changeLongHist.length;
      // 现在打开 VJ，历史要从头攒 —— 不能拿关着时的旧数据直接判定
      document.getElementById('vjShuffleIntervalSel').value = 'change';
      setVjShuffle(true);
      const afterArmLen = changeLongHist.length;
      setVjShuffle(false);
      return { idleLen, afterArmLen };
    });
    expect(r.idleLen, '没有任何一层开着还在攒低音历史').toBe(0);
    expect(r.afterArmLen, '刚打开就带着旧历史，会立刻误触发').toBe(0);
  });
});

test('切语言时 VJ 的开关和间隔选项跟着变', async () => {
  test.setTimeout(180_000);
  await withApp('shuffle-i18n', async (win) => {
    const r = await win.evaluate(() => {
      applyLanguage('zh');
      const zh = {
        btn: document.getElementById('vjShuffleToggle').textContent,
        change: [...document.getElementById('vjShuffleIntervalSel').options].find(o => o.value === 'change').textContent,
        unit: document.getElementById('vjShuffleCustomUnit').textContent,
      };
      applyLanguage('en');
      const en = {
        btn: document.getElementById('vjShuffleToggle').textContent,
        change: [...document.getElementById('vjShuffleIntervalSel').options].find(o => o.value === 'change').textContent,
        unit: document.getElementById('vjShuffleCustomUnit').textContent,
      };
      return { zh, en };
    });
    expect(r.zh.btn).toMatch(/自动轮换/);
    expect(r.zh.change).toMatch(/突变/);
    expect(r.zh.unit).toBe('秒');
    expect(r.en.btn).toMatch(/Auto-Shuffle/);
    expect(r.en.change).toMatch(/Sudden Change/);
    expect(r.en.unit).toBe('sec');
  });
});

test('Live Bar 的 🔀 仍然只管 2D，不碰 3D 和 VJ', async () => {
  test.setTimeout(180_000);
  await withApp('shuffle-livebar', async (win) => {
    const r = await win.evaluate(() => {
      micShuffleOn = false; setBg3DShuffle(false); setVjShuffle(false);
      document.getElementById('micShuffleIntervalSel').value = '32000';
      document.getElementById('liveShuffleBtn').click();
      return { mic: micShuffleOn, bg3d: bg3DShuffleOn, vj: vjShuffleOn };
    });
    expect(r.mic, 'Live Bar 的 🔀 没有打开 2D 的轮换').toBe(true);
    expect(r.bg3d, 'Live Bar 的 🔀 不该碰 3D').toBe(false);
    expect(r.vj, 'Live Bar 的 🔀 不该碰 VJ').toBe(false);
  });
});
