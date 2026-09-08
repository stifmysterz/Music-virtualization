const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');
const PREMIUM = [
  'vjLiquidGrid','vjNeonRibbon','vjPrismShards','vjChromeTube','vjChromeFlow',
  'vjMetalTwist','vjFractalWell','vjTentacleTunnel','vjBioMembrane','vjVoidNebula',
  'vjEventHorizon','vjDataBloom','vjNeonArches','vjHorizonVoyage','vjHyperCube',
  'vjCoasterRush','vjMercuryPool','vjLiquidSpine','vjWarpJump','vjSolarFlare'
];

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app, win;
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

test('Top 20 有完整且多样的 premium choreography metadata', async () => {
  await withApp('vj-premium-meta', async (win) => {
    const result = await win.evaluate(() => ({
      kinds: [...VJ_PREMIUM_KINDS],
      meta: JSON.parse(JSON.stringify(VJ_PREMIUM_META)),
      allVj: VJ_PREMIUM_KINDS.every(k => VJ_TUNNEL_KINDS.includes(k)),
      families: new Set(VJ_PREMIUM_KINDS.map(k => VJ_PREMIUM_META[k].family)).size,
      cameraStyles: new Set(VJ_PREMIUM_KINDS.map(k => VJ_PREMIUM_META[k].cameraStyle)).size,
    }));
    expect(result.kinds).toEqual(PREMIUM);
    expect(result.allVj).toBe(true);
    expect(result.families).toBeGreaterThanOrEqual(12);
    expect(result.cameraStyles).toBe(20);
    for (const kind of PREMIUM) {
      const m = result.meta[kind];
      expect([16, 32], `${kind} loopBeats`).toContain(m.loopBeats);
      expect(m.bass, `${kind} bass mapping`).toBeTruthy();
      expect(m.mid, `${kind} mid mapping`).toBeTruthy();
      expect(m.high, `${kind} high mapping`).toBeTruthy();
    }
  });
});

test('Premium rig 只增强选中的 20 个，不改变其余 VJ', async () => {
  await withApp('vj-premium-scope', async (win) => {
    const result = await win.evaluate((premium) => {
      document.getElementById('intro')?.classList.add('hidden');
      const summaries = [];
      for (const kind of premium) {
        enableBg3D(kind); renderBg3D(0.4, 0.5, 0.6, 1);
        const rig = bg3DScenes[kind].scene.userData.vjPremiumRig;
        summaries.push({kind, name:rig?.group.name, points:rig?.group.children[0].geometry.attributes.position.count,
          lights:rig?.group.children.filter(o => o.isLight).length, profile:JSON.stringify(rig?.profile)});
      }
      const ordinary = VJ_TUNNEL_KINDS.find(k => !premium.includes(k));
      enableBg3D(ordinary); renderBg3D(0.4, 0.5, 0.6, 1);
      return {summaries, ordinary, ordinaryHasRig:!!bg3DScenes[ordinary].scene.userData.vjPremiumRig};
    }, PREMIUM);
    expect(result.summaries).toHaveLength(20);
    for (const item of result.summaries) {
      expect(item.name, item.kind).toBe('vj-premium-depth-atmosphere');
      expect(item.points, item.kind).toBeGreaterThanOrEqual(32);
      expect(item.lights, item.kind).toBe(2);
    }
    expect(new Set(result.summaries.map(item => item.profile)).size).toBeGreaterThanOrEqual(15);
    expect(result.ordinaryHasRig, `${result.ordinary} 不应被 Premium Pass 改动`).toBe(false);
  });
});

test('低中高频分别驱动质量、镜头和灯光，而且闭合相位不累积漂移', async () => {
  await withApp('vj-premium-motion', async (win) => {
    const result = await win.evaluate(() => {
      enableBg3D('vjLiquidGrid'); renderBg3D(0,0,0,1);
      const s=bg3DScenes.vjLiquidGrid, rig=s.scene.userData.vjPremiumRig, st=rig.state;
      const sample=(beats,bass,mid,high)=>{
        st.beats=beats; st.bass=bass; st.mid=mid; st.high=high;
        applyVjPremiumPass('vjLiquidGrid',s,bass,mid,high,0);
        return {x:rig.group.position.x,y:rig.group.position.y,roll:rig.group.rotation.z,
          opacity:rig.mat.opacity,size:rig.mat.size,key:rig.key.intensity,rim:rig.rim.intensity};
      };
      return {start:sample(0,0,0,0), end:sample(16,0,0,0), bass:sample(4,1,0,0),
        mid:sample(4,0,1,0), high:sample(4,0,0,1)};
    });
    for (const key of ['x','y','roll','opacity','size','key','rim']) {
      expect(Math.abs(result.start[key]-result.end[key]), `${key} 在 loop seam 漂移`).toBeLessThan(1e-8);
    }
    expect(result.bass.key).toBeGreaterThan(result.start.key);
    expect(Math.abs(result.mid.roll)).toBeGreaterThan(Math.abs(result.start.roll));
    expect(result.high.opacity).toBeGreaterThan(result.start.opacity);
    expect(result.high.size).toBeGreaterThan(result.start.size);
  });
});
