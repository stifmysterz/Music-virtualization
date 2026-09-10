const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');
const ROOT = path.join(APP_DIR, '..');
const TARGET = path.join(ROOT, '61.html');
const SYNC = path.join(APP_DIR, 'scripts', 'sync-bg3d-builders.js');
const CATALOG = path.join(ROOT, 'src', 'three', 'background-catalog.json');
const VJ_REGISTRY = path.join(ROOT, 'src', 'vj', 'tunnel-registry.json');
const verify = (root = ROOT) => spawnSync(process.execPath, [SYNC, '--root', root], { encoding: 'utf8' });

test('BG3D_BUILDERS 由 119 个普通 3D 与 46 个 VJ 源注册表完整生成', async () => {
  const regular = JSON.parse(fs.readFileSync(CATALOG, 'utf8')).categories.flatMap(group => group.kinds);
  const vj = JSON.parse(fs.readFileSync(VJ_REGISTRY, 'utf8')).kinds;
  const check = verify();
  expect(check.status, check.stderr || check.stdout).toBe(0);

  const dir = newUserDataDir('bg3d-builder-registry'); let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const runtime = await win.evaluate(() => ({
      keys: Object.keys(BG3D_BUILDERS),
      invalid: Object.entries(BG3D_BUILDERS).filter(([, builder]) => typeof builder !== 'function').map(([kind]) => kind),
      festivalName: BG3D_BUILDERS.festival.name
    }));
    expect(regular).toHaveLength(119);
    expect(vj).toHaveLength(46);
    expect(runtime.keys).toEqual([...regular, ...vj]);
    expect(runtime.invalid).toEqual([]);
    expect(runtime.festivalName).toBe('buildBg3DFestivalBuilding');
  } finally { await closeApp(app, win); try { cleanupUserDataDir(dir); } catch (e) {} }
});

test('生成后的 builder 接线被手改时发布校验失败', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-bg3d-builders-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'src', 'three'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'src', 'vj'), { recursive: true });
    fs.copyFileSync(CATALOG, path.join(tempRoot, 'src', 'three', 'background-catalog.json'));
    fs.copyFileSync(VJ_REGISTRY, path.join(tempRoot, 'src', 'vj', 'tunnel-registry.json'));
    fs.writeFileSync(path.join(tempRoot, '61.html'), fs.readFileSync(TARGET, 'utf8').replace('particles: buildBg3DParticles', 'particles: buildBg3DTunnel'));
    const stale = verify(tempRoot);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr + stale.stdout).toContain('61.html is stale');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
