const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');
const ROOT = path.join(APP_DIR, '..');
const SOURCE = path.join(ROOT, 'src', 'three', 'background-catalog.json');
const TARGET = path.join(ROOT, '61.html');
const SYNC = path.join(APP_DIR, 'scripts', 'sync-bg3d-catalog.js');
const verify = (root = ROOT) => spawnSync(process.execPath, [SYNC, '--root', root], { encoding: 'utf8' });

test('3D 分类源数据、运行时顺序和 builder 注册完全一致', async () => {
  const config = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const check = verify();
  expect(check.status, check.stderr || check.stdout).toBe(0);
  const dir = newUserDataDir('bg3d-catalog-source'); let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const runtime = await win.evaluate(() => ({
      catalog: JSON.parse(JSON.stringify(BG3D_CATALOG)),
      missing: BG3D_ORDER.filter(kind => !BG3D_BUILDERS[kind]),
      vjLeaks: BG3D_ORDER.filter(kind => VJ_TUNNEL_KINDS.includes(kind))
    }));
    expect(runtime.catalog).toEqual(config.categories);
    expect(runtime.missing).toEqual([]);
    expect(runtime.vjLeaks).toEqual([]);
  } finally { await closeApp(app, win); try { cleanupUserDataDir(dir); } catch (e) {} }
});

test('3D 分类生成区块被手改后发布校验失败', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-bg3d-catalog-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'src', 'three'), { recursive: true });
    fs.copyFileSync(SOURCE, path.join(tempRoot, 'src', 'three', 'background-catalog.json'));
    fs.writeFileSync(path.join(tempRoot, '61.html'), fs.readFileSync(TARGET, 'utf8').replace('"particles"', '"brokenEffect"'));
    const stale = verify(tempRoot);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr + stale.stdout).toContain('61.html is stale');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
