const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app, win;
  try {
    app = await electron.launch({args:['.', `--user-data-dir=${dir}`], cwd:APP_DIR});
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

test('Music State Bus 提供所有视觉系统共用的完整字段', async () => {
  await withApp('music-state-shape', async win => {
    const result = await win.evaluate(() => {
      resetMusicState(); manualBPM=128;
      return {...updateMusicState(1000,0.7,0.5,0.3,1,true)};
    });
    for(const key of ['bass','mid','high','bassEnvelope','midEnvelope','highEnvelope','energy',
      'energyEnvelope','beat','onset','bpm','bpmSource','beatPhase','barPhase','phrasePhase',
      'dropProbability','now','deltaMs','frame']) expect(result).toHaveProperty(key);
    expect(result).toMatchObject({bass:0.7,mid:0.5,high:0.3,beat:1,onset:true,bpm:128,bpmSource:'manual'});
    for(const key of ['beatPhase','barPhase','phrasePhase','dropProbability']) {
      expect(result[key], key).toBeGreaterThanOrEqual(0); expect(result[key], key).toBeLessThanOrEqual(1);
    }
  });
});

test('三个频段包络分别平滑，原始频段仍保持兼容数值', async () => {
  await withApp('music-state-envelope', async win => {
    const result = await win.evaluate(() => {
      resetMusicState(); manualBPM=null;
      const attack={...updateMusicState(0,1,0.7,0.4,0,false)};
      const audible={...updateMusicState(16.7,1,0.7,0.4,0,true)};
      const release={...updateMusicState(33.4,0,0,0,0,true)};
      return {attack,audible,release};
    });
    expect(result.attack).toMatchObject({bass:0,mid:0,high:0});
    expect(result.audible).toMatchObject({bass:1,mid:0.7,high:0.4});
    expect(result.audible.bassEnvelope).toBeGreaterThan(0);
    expect(result.audible.bassEnvelope).toBeLessThan(1);
    expect(result.audible.highEnvelope).toBeGreaterThan(result.audible.midEnvelope);
    expect(result.release.bass).toBe(0);
    expect(result.release.bassEnvelope).toBeGreaterThan(0);
  });
});

test('BPM 的 beat/bar/phrase phase 共用同一时钟，onset 只在上升沿触发', async () => {
  await withApp('music-state-phase', async win => {
    const result = await win.evaluate(() => {
      resetMusicState(); manualBPM=120;
      const first={...updateMusicState(0,0.8,0.2,0.1,1,true)};
      const held={...updateMusicState(16.7,0.8,0.2,0.1,1,true)};
      for(let t=116.7;t<=516.7;t+=100) updateMusicState(t,0.3,0.2,0.1,0,true);
      const oneBeat={...musicState};
      return {first,held,oneBeat};
    });
    expect(result.first.onset).toBe(true);
    expect(result.held.onset).toBe(false);
    expect(result.oneBeat.beatPhase).toBeCloseTo(0.0334,2);
    expect(result.oneBeat.barPhase).toBeCloseTo((1+result.oneBeat.beatPhase)/4,3);
    expect(result.oneBeat.phrasePhase).toBeCloseTo((1+result.oneBeat.beatPhase)/16,3);
  });
});

test('主渲染循环把旧 bass/mid/high/beat 别名同步到 Music State', async () => {
  await withApp('music-state-compat', async win => {
    const result = await win.evaluate(async () => {
      freq=new Uint8Array(1024); wave=new Uint8Array(2048);
      analyser={frequencyBinCount:1024,fftSize:2048,
        getByteFrequencyData(a){for(let i=0;i<a.length;i++)a[i]=120;},
        getByteTimeDomainData(a){a.fill(128);}};
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      return {state:{...musicState}, aliases:{lastBass,lastMid,lastHigh,beat}};
    });
    expect(result.aliases.lastBass).toBe(result.state.bass);
    expect(result.aliases.lastMid).toBe(result.state.mid);
    expect(result.aliases.lastHigh).toBe(result.state.high);
    expect(result.aliases.beat).toBe(result.state.beat);
  });
});
