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

test('按档位切换精细度;尺寸准确、法线朝外、半径超过半边长时自动夹紧', async () => {
  await withApp('bevel-shape', async win => {
    const r = await win.evaluate(() => {
      const inspect = g => {
        g.computeBoundingBox();
        const size = g.boundingBox.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(4));
        const pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;
        const tris = idx ? idx.count / 3 : pos.count / 3;
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cr = new THREE.Vector3(), nv = new THREE.Vector3();
        let inward = 0, badNormal = 0, nan = 0;
        for (let t = 0; t < tris; t++) {
          const ii = [0, 1, 2].map(k => idx ? idx.getX(t * 3 + k) : t * 3 + k);
          a.fromBufferAttribute(pos, ii[0]); b.fromBufferAttribute(pos, ii[1]); c.fromBufferAttribute(pos, ii[2]);
          if ([a, b, c].some(v => !Number.isFinite(v.x + v.y + v.z))) { nan++; continue; }
          cr.subVectors(b, a).cross(c.clone().sub(a));
          if (cr.length() < 1e-9) continue;
          const centroid = a.clone().add(b).add(c).divideScalar(3);
          if (cr.dot(centroid) <= 0) inward++;
          for (const i of ii) { nv.fromBufferAttribute(nor, i); if (Math.abs(nv.length() - 1) > 1e-3 || nv.dot(centroid) <= 0) badNormal++; }
        }
        return { tris, size, inward, badNormal, nan };
      };
      const out = {};
      for (const tier of ['low', 'balanced', 'ultra']) {
        setVjQualityTier(tier);
        out[tier] = inspect(vjBevelBox(1.5, 1.5, 3.2, 0.22));
      }
      out.clamped = inspect(vjBevelBox(0.2, 0.2, 5, 0.5));
      return out;
    });
    expect(r.low).toEqual({ tris: 44, size: [1.5, 1.5, 3.2], inward: 0, badNormal: 0, nan: 0 });
    expect(r.balanced).toEqual({ tris: 108, size: [1.5, 1.5, 3.2], inward: 0, badNormal: 0, nan: 0 });
    expect(r.ultra).toEqual({ tris: 300, size: [1.5, 1.5, 3.2], inward: 0, badNormal: 0, nan: 0 });
    expect(r.clamped.size).toEqual([0.2, 0.2, 5]);
    expect(r.clamped.inward + r.clamped.badNormal + r.clamped.nan).toBe(0);
  });
});

test('同尺寸同档位共用一份;切档时清缓存并释放旧几何;场景回收不释放共享几何', async () => {
  await withApp('bevel-cache', async win => {
    const r = await win.evaluate(() => {
      setVjQualityTier('balanced');
      const g1 = vjBevelBox(1, 1, 2, 0.1), g2 = vjBevelBox(1, 1, 2, 0.1);
      let disposedOnTier = 0; g1.addEventListener('dispose', () => disposedOnTier++);
      // 场景回收:挂一个用共享几何的 mesh,回收后几何不能被 dispose
      const shared = vjBevelBox(2, 2, 2, 0.2);
      let disposedOnDrop = 0; shared.addEventListener('dispose', () => disposedOnDrop++);
      const scene = new THREE.Scene(); scene.add(new THREE.Mesh(shared, new THREE.MeshBasicMaterial()));
      bg3DScenes.__bevelTest = { scene, camera: new THREE.PerspectiveCamera(), composer: null };
      vjDropCachedScene('__bevelTest');
      const afterDrop = disposedOnDrop;
      setVjQualityTier('ultra');
      const g3 = vjBevelBox(1, 1, 2, 0.1);
      return { sameObject: g1 === g2, shared: g1.userData.vjShared === true, afterDrop, disposedOnTier, freshAfterTier: g3 !== g1 };
    });
    expect(r).toEqual({ sameObject: true, shared: true, afterDrop: 0, disposedOnTier: 1, freshAfterTier: true });
  });
});

/* 共享几何被一条隧道 rotateX/translate 之后,所有用同尺寸的隧道都跟着变,而且每次重建累加一次。 */
test('共享倒角几何不能被变换:会连带改坏所有用同尺寸的隧道', async () => {
  await withApp('bevel-guard', async win => {
    const r = await win.evaluate(() => {
      const g = vjBevelBox(1, 1, 2, 0.1);
      const before = Array.from(g.attributes.position.array.slice(0, 9));
      const attempts = {
        rotateX: () => g.rotateX(0.5), translate: () => g.translate(1, 0, 0), scale: () => g.scale(2, 2, 2),
        center: () => g.center(), applyMatrix4: () => g.applyMatrix4(new THREE.Matrix4().makeScale(2, 2, 2)),
        applyQuaternion: () => g.applyQuaternion(new THREE.Quaternion()),
      };
      const out = {};
      for (const [k, fn] of Object.entries(attempts)) {
        try { fn(); out[k] = 'ok'; } catch (e) { out[k] = /vjBevelBox/.test(e.message) ? 'threw' : 'other: ' + e.message; }
      }
      out.unchanged = before.every((v, i) => v === g.attributes.position.array[i]);
      g.computeBoundingBox();   // 只读操作照常能用
      out.readOk = !!g.boundingBox;
      return out;
    });
    expect(r).toEqual({ rotateX: 'threw', translate: 'threw', scale: 'threw', center: 'threw', applyMatrix4: 'threw',
                        applyQuaternion: 'threw', unchanged: true, readOk: true });
  });
});
