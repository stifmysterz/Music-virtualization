const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');
const ROOT = path.join(APP_DIR, '..');
const SOURCE = path.join(ROOT, 'src', 'config', 'mode-quality.json');
const TARGET = path.join(ROOT, '61.html');
const SYNC = path.join(APP_DIR, 'scripts', 'sync-mode-quality.js');

function verify(root = ROOT) {
  return spawnSync(process.execPath, [SYNC, '--root', root], { encoding: 'utf8' });
}

async function withApp(label, fn) {
  const dir = newUserDataDir(label); let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win);
  } finally { await closeApp(app, win); try { cleanupUserDataDir(dir); } catch (e) {} }
}

test('质量分级源数据、独立生成区块和运行时 2D 模式一致', async () => {
  const config = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const verification = verify();
  expect(verification.status, verification.stderr || verification.stdout).toBe(0);

  await withApp('mode-quality-source', async win => {
    const runtime = await win.evaluate(() => ({
      S: [...MODE_S_TIER], A: [...MODE_A_TIER], Legacy: [...MODE_LEGACY_TIER]
    }));
    expect(runtime).toEqual(config.tiers);
  });
});

test('同步校验会拒绝被手动改坏的单文件生成区块', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-mode-quality-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'src', 'config'), { recursive: true });
    fs.copyFileSync(SOURCE, path.join(tempRoot, 'src', 'config', 'mode-quality.json'));
    const sourceTarget = fs.readFileSync(TARGET, 'utf8');
    const blockStart = sourceTarget.indexOf('/* MODE_QUALITY_DATA:START */');
    const staleTarget = sourceTarget.slice(0, blockStart) +
      sourceTarget.slice(blockStart).replace("'laserBeam'", "'not-a-real-mode'");
    fs.writeFileSync(path.join(tempRoot, '61.html'), staleTarget);
    const result = verify(tempRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('61.html is stale');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
