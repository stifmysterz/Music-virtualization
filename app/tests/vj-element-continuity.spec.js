const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');
const APP_DIR = path.join(__dirname, '..');

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app, win;
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

/* 页面内:逐帧推进(只算状态、不画),用 z 把相邻两帧的同一个元素配对。
   z 是槽位循环里唯一对物理元素连续的坐标。统计两类跳变:
     pops  —— 隧道中段凭空出现的元素(没有上一帧的对应者)
     flips —— 配上对的元素,色相在相邻两帧之间突变(> 0.15;正常漂移每帧只有零点零几,
               强调色切换是约 0.3–0.5 的跳变。不能按「偏红/偏青」分类:普通元素的色相会随位置漂移到那边去) */
function zTrack({ kind, frames, dt }) {
  seedBg3DBuilds(0x2717); vjDropCachedScene(kind); vjSpeedBassSmooth = 0; enableBg3D(kind);
  const s = bg3DScenes[kind];
  const pick = {
    vjCubeMatrix: () => {
      const mesh = s.scene.children.find(o => o.isInstancedMesh && o.count === 40*24);
      const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3(), out = [];
      for(let i=0;i<40;i++) { mesh.getMatrixAt(i*24, m); m.decompose(p,q,scale); out.push({z:p.z, quat:[q.x,q.y,q.z,q.w]}); }
      return out;
    },
    vjHoverCity: () => {
      const mesh = s.scene.children.find(o => o.isInstancedMesh && o.count === 34*2);
      const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3(), out = [];
      for(let i=0;i<34;i++) { mesh.getMatrixAt(i*2, m); m.decompose(p,q,scale); out.push({z:p.z, shape:scale.y}); }
      return out;
    },
    vjDerelictHall: () => {
      const mesh = s.scene.children.find(o => o.isInstancedMesh && o.count === 30);
      const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3(), out = [];
      for(let i=0;i<mesh.count;i++) { mesh.getMatrixAt(i,m); m.decompose(p,q,scale); out.push({z:p.z, quat:[q.x,q.y,q.z,q.w]}); }
      return out;
    },
    vjCollapsedGrid: () => {
      const mesh = s.scene.children.find(o => o.isInstancedMesh && o.count === 34*32);
      const m = new THREE.Matrix4(), out = [];
      for(let i=0;i<34;i++) { mesh.getMatrixAt(i*32,m); out.push({z:m.elements[14], shape:m.elements[13]}); }
      return out;
    },
    vjDustShaft: () => {
      const mesh = s.scene.children.find(o => o.isInstancedMesh && o.count === 58*7);
      const m = new THREE.Matrix4(), out = [];
      for(let i=0;i<58;i++) { mesh.getMatrixAt(i*7,m); out.push({z:m.elements[14], shape:m.elements[12]}); }
      return out;
    },
    // SpeedGates:上横梁(每扇门一根)
    vjSpeedGates: () => {
      const bars = s.scene.children.find(o => o.isInstancedMesh && o.count === 25*2);
      const m = new THREE.Matrix4(), c = new THREE.Color(), hsl = {}, out = [];
      for (let i = 0; i < bars.count; i += 2) { bars.getMatrixAt(i, m); bars.getColorAt(i, c); out.push({ z: m.elements[14], hue: c.getHSL(hsl).h }); }
      return out;
    },
    // NeonTubeRoom:方环(每个可见环取一个)
    vjNeonTubeRoom: () => {
      const rings = s.scene.children.find(o => o.isInstancedMesh && o.geometry.parameters?.width === 0.7);
      const m = new THREE.Matrix4(), c = new THREE.Color(), hsl = {}, seen = new Map();
      for (let i = 0; i < rings.count; i++) {
        rings.getMatrixAt(i, m);
        if (Math.abs(m.determinant()) < 1e-6) continue;
        const z = m.elements[14], key = Math.round(z * 10);
        if (!seen.has(key)) { rings.getColorAt(i, c); seen.set(key, { z, hue: c.getHSL(hsl).h }); }
      }
      return [...seen.values()];
    },
  }[kind];
  const stub = [bg3DRenderer, s.composer].filter(Boolean);
  const saved = stub.map(t => Object.getOwnPropertyDescriptor(t, 'render'));
  stub.forEach(t => { t.render = () => {}; });
  let pops = 0, flips = 0, pairs = 0;
  try {
    for (let i = 0; i < 10; i++) renderBg3D(0.5, 0.4, 0.3, dt);
    let prev = pick();
    for (let f = 0; f < frames; f++) {
      renderBg3D(0.5, 0.4, 0.3, dt);
      const cur = pick();
      for (const e of cur) {
        let best = null, bestD = 1.5;
        for (const p of prev) { const d = Math.abs(p.z - e.z); if (d < bestD) { bestD = d; best = p; } }
        if (!best) { if (e.z > -200 && e.z < 13) pops++; continue; }
        pairs++;
        if(Number.isFinite(e.hue)) {
          const dh = Math.abs(best.hue - e.hue);
          if (Math.min(dh, 1 - dh) > 0.15) flips++;
        }
        if(Number.isFinite(e.shape) && Math.abs(best.shape - e.shape) > 0.07) flips++;
        if(e.quat) {
          const dot = Math.abs(e.quat.reduce((sum,v,i) => sum + v*best.quat[i],0));
          if(2*Math.acos(Math.min(1,dot)) > 0.2) flips++;
        }
      }
      prev = cur;
    }
  } finally {
    stub.forEach((t, i) => { if (saved[i]) Object.defineProperty(t, 'render', saved[i]); else delete t.render; });
  }
  return { kind, pops, flips, pairs };
}

for (const kind of ['vjSpeedGates', 'vjNeonTubeRoom', 'vjCubeMatrix', 'vjHoverCity',
  'vjDerelictHall', 'vjCollapsedGrid', 'vjDustShaft']) {
  test(`${kind}: 按槽位编号取的外观不能在每次退格时跳变`, async () => {
    await withApp(`continuity-${kind}`, async win => {
      const r = await win.evaluate(zTrack, { kind, frames: 160, dt: 0.25 });
      console.log(JSON.stringify(r));
      expect(r.pairs, '没配上对,测试本身有问题').toBeGreaterThan(500);
      expect(r.pops, '隧道中段凭空出现的元素').toBe(0);
      expect(r.flips, '同一个元素的外观(色相、形状或朝向)在相邻两帧之间跳变了 —— 多半是按槽位编号取的外观').toBe(0);
    });
  });
}
