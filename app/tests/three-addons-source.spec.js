const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');
const ROOT = path.join(APP_DIR, '..');
const SOURCE = path.join(ROOT, 'src', 'three', 'addons-r149.js');
const TARGET = path.join(ROOT, '61.html');
const SYNC = path.join(APP_DIR, 'scripts', 'sync-three-addons.js');
const verify = (root = ROOT) => spawnSync(process.execPath, [SYNC, '--root', root], { encoding: 'utf8' });

test('r149 附加件源文件与 standalone 同步,漂移时校验失败', () => {
  const current = verify();
  expect(current.status, current.stderr || current.stdout).toBe(0);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-three-addons-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'src', 'three'), { recursive: true });
    fs.copyFileSync(SOURCE, path.join(tempRoot, 'src', 'three', 'addons-r149.js'));
    fs.writeFileSync(path.join(tempRoot, '61.html'),
      fs.readFileSync(TARGET, 'utf8').replace('this.needsSwap = true;', 'this.needsSwap = false;'));
    const stale = verify(tempRoot);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr + stale.stdout).toContain('61.html is stale');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('移植代码在应用里可用:圆角面数正确,SMAA 接在合成链中间能出图', async () => {
  const dir = newUserDataDir('three-addons');
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const r = await win.evaluate(async () => {
      document.getElementById('intro')?.classList.add('hidden');
      const A = THREE_R149_ADDONS;
      // RoundedBoxGeometry 是非索引几何(内部 toNonIndexed)
      const tris = s => { const g = new A.RoundedBoxGeometry(1.5, 1.5, 3.2, s, 0.22); return (g.index ? g.index.count : g.attributes.position.count) / 3; };
      await A.smaaReady;
      enableBg3D('vjChromeFlow');
      const s = bg3DScenes.vjChromeFlow, size = bg3DRenderer.getDrawingBufferSize(new THREE.Vector2());
      const p = new A.SMAAPass(size.x, size.y);
      s.composer.insertPass(p, s.composer.passes.findIndex(q => q.__bg3dAlpha));
      for (let i = 0; i < 3; i++) renderBg3D(0.5, 0.4, 0.3, 1);
      const gl = bg3DRenderer.getContext();
      return { keys: Object.keys(A).sort(), tris1: tris(1), tris2: tris(2), glErr: gl.getError(),
               needsSwap: p.needsSwap, imagesDecoded: A.smaaImages.area.complete && A.smaaImages.search.complete };
    });
    expect(r.keys).toEqual(['RoundedBoxGeometry', 'SMAAPass', 'smaaImages', 'smaaReady']);
    expect(r.tris1).toBe(108);
    expect(r.tris2).toBe(300);
    expect(r.glErr).toBe(0);
    expect(r.needsSwap, 'SMAA 后面还有 alpha pass,必须交换缓冲').toBe(true);
    expect(r.imagesDecoded).toBe(true);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
});
