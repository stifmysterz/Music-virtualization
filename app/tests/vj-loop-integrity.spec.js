const fs = require('fs');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const ROOT = path.join(__dirname, '..', '..');
const APP_DIR = path.join(__dirname, '..');

test('46 个 VJ 都声明确定性 depth-wrap 循环契约', async () => {
  const dir = newUserDataDir('vj-loop-contract');
  let app, win;
  try {
    app = await electron.launch({args:['.', `--user-data-dir=${dir}`], cwd:APP_DIR});
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const result = await win.evaluate(() => ({kinds:[...VJ_TUNNEL_KINDS], meta:JSON.parse(JSON.stringify(VJ_LOOP_META))}));
    expect(Object.keys(result.meta)).toEqual(result.kinds);
    expect(result.kinds).toHaveLength(46);
    for (const kind of result.kinds) {
      expect(result.meta[kind]).toMatchObject({
        wrapDistance:220, seamlessStrategy:'deterministic-depth-wrap', deterministicRecycle:true
      });
      expect([8,16,32]).toContain(result.meta[kind].loopBeats);
    }
    expect(Object.values(result.meta).filter(m => m.qualityTier==='premium')).toHaveLength(20);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
});

test('VJ update 热路径不允许重新随机化回收元素', () => {
  const source = fs.readFileSync(path.join(ROOT, '61.html'), 'utf8');
  const starts = [...source.matchAll(/function buildBg3DVj[A-Za-z0-9]+\(\)\{/g)];
  expect(starts).toHaveLength(46);
  const offenders = [];
  starts.forEach((match, index) => {
    const block = source.slice(match.index, starts[index+1]?.index ?? source.indexOf('const BG3D_BUILDERS', match.index));
    const updateAt = block.indexOf('update(');
    if (updateAt < 0) offenders.push(`${match[0]} missing update`);
    else if (block.slice(updateAt).includes('Math.random()')) offenders.push(match[0].match(/buildBg3DVj\w+/)[0]);
  });
  expect(offenders, '这些 VJ 在 update/recycle 时重新抽随机数，会在循环接缝跳变').toEqual([]);
});

test('depth-wrap 与 BPM phase 在首尾的位置和速度连续', async () => {
  const dir = newUserDataDir('vj-loop-math');
  let app, win;
  try {
    app = await electron.launch({args:['.', `--user-data-dir=${dir}`], cwd:APP_DIR});
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const result = await win.evaluate(() => {
      const eps=1e-6, st={beats:0};
      const wrapStart=vjLoopZ(0,37), wrapEnd=vjLoopZ(VJ_LEN,37);
      const wrapVelStart=(vjLoopZ(eps,37)-vjLoopZ(0,37))/eps;
      const wrapVelEnd=(vjLoopZ(VJ_LEN+eps,37)-vjLoopZ(VJ_LEN,37))/eps;
      st.beats=0; const p0=vjPhase(st,0,16);
      st.beats=16; const p1=vjPhase(st,0,16);
      return {wrapStart,wrapEnd,wrapVelStart,wrapVelEnd,p0,p1};
    });
    expect(Math.abs(result.wrapStart-result.wrapEnd)).toBeLessThan(1e-8);
    expect(Math.abs(result.wrapVelStart-result.wrapVelEnd)).toBeLessThan(1e-6);
    expect(result.p0).toBe(0); expect(result.p1).toBe(0);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
});
