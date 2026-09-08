const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');
const ROOT = path.join(APP_DIR, '..');
const SOURCE = path.join(ROOT, 'src', 'vj', 'tunnel-registry.json');
const TARGET = path.join(ROOT, '61.html');
const SYNC = path.join(APP_DIR, 'scripts', 'sync-vj-registry.js');
const verify = (root = ROOT) => spawnSync(process.execPath, [SYNC, '--root', root], { encoding: 'utf8' });

test('VJ 注册源数据、standalone 与运行时顺序完全一致', async () => {
  const config = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const result = verify();
  expect(result.status, result.stderr || result.stdout).toBe(0);
  const dir = newUserDataDir('vj-registry-source'); let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    expect(await win.evaluate(() => [...VJ_TUNNEL_KINDS])).toEqual(config.kinds);
    expect(config.kinds).toHaveLength(45);
  } finally { await closeApp(app, win); try { cleanupUserDataDir(dir); } catch (e) {} }
});

test('VJ 注册区块被手改后同步校验失败', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-vj-registry-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'src', 'vj'), { recursive: true });
    fs.copyFileSync(SOURCE, path.join(tempRoot, 'src', 'vj', 'tunnel-registry.json'));
    const current = fs.readFileSync(TARGET, 'utf8');
    const registryStart = current.indexOf('/* VJ_TUNNEL_REGISTRY:START */');
    const registryEnd = current.indexOf('/* VJ_TUNNEL_REGISTRY:END */');
    const registry = current.slice(registryStart, registryEnd).replace('"vjLiquidGrid"', '"vjBroken"');
    fs.writeFileSync(path.join(tempRoot, '61.html'), current.slice(0, registryStart) + registry + current.slice(registryEnd));
    const stale = verify(tempRoot);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr + stale.stdout).toContain('61.html is stale');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
