const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

/* 鼓点检测 detectBeat()。
 *
 * beat 是全局共用的瞬态信号 —— logo 跳动、背景跳动、3D 相机的 zoom punch、以及所有
 * 吃 beat 的特效都靠它。原来的实现有三个毛病，合起来就是「跟不上每一粒 bass」：
 *
 *   1. 阈值是 e > avg*1.18，avg 是自己那段能量的滑动平均。密集或压缩过的曲子里
 *      平均值被自己的鼓点抬高，后面的鼓点过不了门槛，直接漏掉。
 *   2. 只要能量还在门槛之上，每一帧都会把 beat 重新设成 1 —— 一粒鼓点会被反复
 *      触发成一段持续的高电平，看起来是「一直亮着」而不是「一粒一粒」。
 *   3. beat *= 0.9 是按帧衰减的，所以尾巴长短取决于刷新率：120Hz 屏上衰减速度是
 *      60Hz 的两倍，同一首歌在不同机器上手感不一样。
 *
 * 改法：阈值改成 avg + k×标准差、加上升沿判定和不应期、衰减改成按真实时间。
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

/* 离线喂一段合成频谱给 detectBeat()，数它检出了几粒。
   完全不依赖真实音频和真实时间 —— 自己推进一个假的 now，所以结果是确定的。
   会被 toString() 送进页面 eval，不能引用模块作用域。 */
function runBeatSim(opts) {
  const { bpm, seconds, floorLevel, kickLevel, frameMs } = opts;
  freq = new Uint8Array(1024);
  wave = new Uint8Array(2048);
  manualBPM = null; bpmNextBeatAt = null;
  resetBeatDetector();   // 不应期/上一帧能量/上一帧时间都要清掉，否则两次仿真会互相污染

  const interval = 60000 / bpm;
  const totalFrames = Math.round(seconds * 1000 / frameMs);
  let now = 0, nextKick = interval, lastKickAt = null;
  let hits = 0, kicksEmitted = 0;
  let prevBeat = 0, wentLowSinceHit = true;
  const trace = [];

  for (let f = 0; f < totalFrames; f++) {
    now += frameMs;
    // 底噪：一直有能量（模拟压得很满的曲子，正是原来会漏拍的场景）
    let level = floorLevel;
    // 鼓点：一个 ~40ms 的短促冲击。
    // lastKickAt 必须由「真的发出了一粒」来推进 —— 早先的写法用
    // now-(nextKick-interval) 反推，第一帧就会算出一粒没被计数的鼓点，
    // 于是检出数永远比 kicksEmitted 多一，看起来像检测器重复触发。
    if (now >= nextKick) { lastKickAt = nextKick; nextKick += interval; kicksEmitted++; }
    if (lastKickAt !== null && now - lastKickAt >= 0 && now - lastKickAt < 40) level = kickLevel;

    for (let i = 2; i < 28; i++) freq[i] = level;
    detectBeat(now);

    if (beat > prevBeat + 0.25 && wentLowSinceHit) { hits++; wentLowSinceHit = false; }
    if (beat < 0.25) wentLowSinceHit = true;
    trace.push(+beat.toFixed(3));
    prevBeat = beat;
  }
  return { kicksEmitted, hits, trace };
}

test('密集底噪上，每一粒鼓点都检得到（原来会被自己的滑动平均淹掉）', async () => {
  await withApp('beat-1', async (win) => {
    // 压得很满的曲子：底噪 130、鼓点 152，只高出 17%。
    // 旧的固定倍率门槛是 avg*1.18 ≈ 153，刚好打不着 —— 整首歌一粒都检不出来。
    const res = await win.evaluate((fn) => eval('(' + fn + ')')({
      bpm: 128, seconds: 10, floorLevel: 130, kickLevel: 152, frameMs: 16.7
    }), runBeatSim.toString());

    // 10 秒 128BPM ≈ 21 拍，允许首尾各差一拍
    expect(res.kicksEmitted).toBeGreaterThan(18);
    expect(res.hits).toBeGreaterThanOrEqual(res.kicksEmitted - 1);
    expect(res.hits).toBeLessThanOrEqual(res.kicksEmitted + 1);
  });
});

test('一粒鼓点只触发一次，两粒之间 beat 会真的落下去', async () => {
  await withApp('beat-2', async (win) => {
    const res = await win.evaluate((fn) => eval('(' + fn + ')')({
      bpm: 100, seconds: 6, floorLevel: 90, kickLevel: 170, frameMs: 16.7
    }), runBeatSim.toString());

    // 不重复触发：每粒鼓点只该打一次。
    // 允许多一次 —— 仿真第一帧是「静音突然变成有声」，那是真瞬态，检出它是对的
    // （实测：9 粒鼓点 → 9 次触发，时间点正好落在 601/1202/1804…ms，外加 frame 0 的起振）。
    expect(res.hits).toBeLessThanOrEqual(res.kicksEmitted + 1);
    expect(res.hits).toBeGreaterThanOrEqual(res.kicksEmitted);
    // 两拍之间必须有明显的低谷，否则看起来是一直亮着而不是一粒一粒
    const low = res.trace.filter(v => v < 0.15).length;
    expect(low).toBeGreaterThan(res.trace.length * 0.3);
  });
});

test('快速连打不会糊成一坨（160BPM 双踩级别）', async () => {
  await withApp('beat-3', async (win) => {
    const res = await win.evaluate((fn) => eval('(' + fn + ')')({
      bpm: 320, seconds: 5, floorLevel: 100, kickLevel: 165, frameMs: 16.7
    }), runBeatSim.toString());

    // 320BPM = 每 187ms 一粒，在 ~110ms 不应期之上，应该粒粒分明
    expect(res.hits).toBeGreaterThanOrEqual(res.kicksEmitted - 2);
  });
});

test('衰减按真实时间走，不再取决于刷新率', async () => {
  await withApp('beat-4', async (win) => {
    const res = await win.evaluate((fn) => {
      const run = eval('(' + fn + ')');
      const at60 = run({ bpm: 120, seconds: 4, floorLevel: 90, kickLevel: 170, frameMs: 16.7 });
      const at120 = run({ bpm: 120, seconds: 4, floorLevel: 90, kickLevel: 170, frameMs: 8.35 });
      const avg = t => t.reduce((a, b) => a + b, 0) / t.length;
      return { hits60: at60.hits, hits120: at120.hits, avg60: avg(at60.trace), avg120: avg(at120.trace) };
    }, runBeatSim.toString());

    // 同一段音乐，60Hz 和 120Hz 下检出的拍数应该一样
    expect(Math.abs(res.hits60 - res.hits120)).toBeLessThanOrEqual(1);
    // 平均亮度也该接近 —— 原来按帧衰减时 120Hz 的尾巴只有一半长
    expect(Math.abs(res.avg60 - res.avg120)).toBeLessThan(0.06);
  });
});

test('手动 BPM 那条分支不受影响', async () => {
  await withApp('beat-5', async (win) => {
    const res = await win.evaluate(() => {
      freq = new Uint8Array(1024); wave = new Uint8Array(2048);
      for (let i = 2; i < 28; i++) freq[i] = 10;   // 几乎没有 bass，靠 BPM 网格自己打
      resetBeatDetector();
      manualBPM = 120; bpmNextBeatAt = null;
      let now = 0, hits = 0, prev = 0, low = true;
      for (let f = 0; f < 600; f++) {
        now += 16.7;
        detectBeat(now);
        if (beat > prev + 0.25 && low) { hits++; low = false; }
        if (beat < 0.25) low = true;
        prev = beat;
      }
      manualBPM = null; bpmNextBeatAt = null;
      return { hits, seconds: 600 * 16.7 / 1000 };
    });

    // 10 秒 120BPM = 20 拍
    expect(res.hits).toBeGreaterThanOrEqual(19);
    expect(res.hits).toBeLessThanOrEqual(21);
  });
});

test('logo 和背景的默认值改成跟着每一粒鼓点跳', async () => {
  await withApp('beat-6', async (win) => {
    const res = await win.evaluate(() => ({
      logoStyle: logos[0] ? logos[0].bounceStyle : null,
      logoOn: logos[0] ? logos[0].bounceOn : null,
      bgOn: bgBounceOn,
      bgStyle: bgBounceStyle
    }));

    expect(res.logoOn).toBe(true);
    expect(res.logoStyle).toBe('punch');       // 纯 beat 驱动，一粒一爆
    expect(res.bgOn).toBe(true);               // 原来默认是关的，背景根本不跳
    expect(res.bgStyle).toBe('basspunch');
  });
});

test('切换到麦克风时也会清掉检测器状态（不继承上一段音乐的能量历史）', async () => {
  await withApp('beat-7', async (win) => {
    const res = await win.evaluate(async () => {
      ensureCtx();
      // 用 AudioContext 自己造一条真的音频 MediaStream，省得去要真麦克风权限
      const dest = ctx.createMediaStreamDestination();
      const realGUM = navigator.mediaDevices.getUserMedia;
      navigator.mediaDevices.getUserMedia = async () => dest.stream;
      try {
        // 先污染：塞进一段「上一首歌」的能量历史和不应期时间戳
        energyHist = new Array(43).fill(200);
        beat = 0.9;
        const before = { hist: energyHist.slice(0, 3), beat };

        await startMic();

        const after = { hist: energyHist.slice(0, 3), beat, micActive };
        stopMic();
        return { before, after };
      } finally {
        navigator.mediaDevices.getUserMedia = realGUM;
      }
    });

    expect(res.before.hist).toEqual([200, 200, 200]);
    expect(res.after.micActive).toBe(true);
    // 新音源不该继承上一段的能量历史 —— 否则头 ~0.7 秒的阈值是拿错料算出来的
    expect(res.after.hist).toEqual([0, 0, 0]);
    expect(res.after.beat).toBe(0);
  });
});
