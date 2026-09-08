const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');
const ROOT = path.join(APP_DIR, '..');
const SOURCE = path.join(ROOT, 'src', 'vj', 'premium-meta.json');
const TARGET = path.join(ROOT, '61.html');
const SYNC = path.join(APP_DIR, 'scripts', 'sync-vj-premium-meta.js');
const verify = (root = ROOT) => spawnSync(process.execPath, [SYNC, '--root', root], { encoding: 'utf8' });

test('Top 20 Premium 源资料与运行时完全一致', async () => {
  const config = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const check = verify();
  expect(check.status, check.stderr || check.stdout).toBe(0);
  const dir = newUserDataDir('vj-premium-meta-source'); let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const runtime = await win.evaluate(() => ({ meta: JSON.parse(JSON.stringify(VJ_PREMIUM_META)), kinds: [...VJ_PREMIUM_KINDS] }));
    expect(runtime.meta).toEqual(config.effects);
    expect(runtime.kinds).toEqual(Object.keys(config.effects));
  } finally { await closeApp(app, win); try { cleanupUserDataDir(dir); } catch (e) {} }
});

test('Premium 资料生成区块被手改后发布校验失败', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-vj-premium-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'src', 'vj'), { recursive: true });
    fs.copyFileSync(SOURCE, path.join(tempRoot, 'src', 'vj', 'premium-meta.json'));
    fs.writeFileSync(path.join(tempRoot, '61.html'), fs.readFileSync(TARGET, 'utf8').replace('"dolly-orbit"', '"broken-camera"'));
    const stale = verify(tempRoot);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr + stale.stdout).toContain('61.html is stale');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
